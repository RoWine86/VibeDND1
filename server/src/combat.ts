// ─── Серверная оркестрация боя (ROADMAP, шаг 2) ─────────────────────────────
// Связывает состояние сессии + движок правил (shared/rules) + хранилище.
// Функции мутируют переданную SessionState (токены, combatLog, saveRequests)
// и возвращают списки для рассылки; ws.ts лишь транслирует их клиентам и
// пишет снапшот в SQLite. Мир (db-доступоры) и rng внедрены — это позволяет
// прогонять сценарии-проверки на node без tsx и с детерминированными костями.
//
// Решения ROADMAP (шаг 2): мгновенная резолюция без подтверждения мастера;
// урон применяется сервером автоматически (clamp 0..maxHp); криты 20/1;
// спасброски монстров кидает мастер через очередь, персонажа — владелец
// (мастер может вписать за игрока); авто-спас концентрации при любом уроне;
// смерть (0 HP) — отдельное событие; ячейки монстра живут на токене сессии.

import { randomUUID } from 'node:crypto';
import type {
  Ability, Character, CharacterClass, CombatEvent, Item, LiveToken, Monster,
  SaveRequest, SessionState, Spell,
} from '@vibednd/shared';
import {
  abilityModifier, canCastFromSlot, characterArmorClass, characterLevel,
  characterSaveBonus, characterSpellcasting, concentrationDC, defaultRng,
  effectiveScores, isProficientWith, monsterSaveBonus, proficiencyBonus,
  resolveAttack, resolveSaveAgainstDamage, rollDie, rollDamageFormula,
  shortRestHeal, spendSpellSlot, spellDamageFormula, spellProjectileCount,
  spellSaveDC, spellAttackBonus,
  type Rng,
} from '@vibednd/shared';

const COMBAT_LOG_LIMIT = 200;

/** Доступ к хранилищу, внедряемый вызывающим кодом (ws.ts → db). */
export interface CombatWorld {
  getCharacter(id: string): Character | undefined;
  getSpell(id: string): Spell | undefined;
  getMonster(id: string): Monster | undefined;
  getItem(id: string): Item | undefined;
  getCharacterClass(id: string): CharacterClass | undefined;
  saveCharacter(ch: Character): void;
}

/** Всё, что оркестратор просит ws.ts разослать после применения мутаций. */
export interface CombatResult {
  events: CombatEvent[];         // broadcast combatEvent (фильтр по hidden — в ws)
  saveRequests: SaveRequest[];   // новые запросы спасбросков (адресно)
  updatedCharacters: Character[];// broadcast characterUpdated
  updatedTokens: LiveToken[];    // broadcast tokenUpsert
  error?: string;                // если задано — отправить error, остальное игнорировать
}

function emptyResult(): CombatResult {
  return { events: [], saveRequests: [], updatedCharacters: [], updatedTokens: [] };
}

function err(message: string): CombatResult {
  return { ...emptyResult(), error: message };
}

// ─── Помощники состояния ────────────────────────────────────────────────────

function findToken(session: SessionState, id?: string): LiveToken | undefined {
  if (!id) return undefined;
  return session.tokens.find((t) => t.id === id);
}

function ensureLog(session: SessionState): CombatEvent[] {
  if (!session.combatLog) session.combatLog = [];
  return session.combatLog;
}

function ensureQueue(session: SessionState): SaveRequest[] {
  if (!session.saveRequests) session.saveRequests = [];
  return session.saveRequests;
}

function pushEvent(session: SessionState, res: CombatResult, ev: Omit<CombatEvent, 'id' | 'timestamp'>): CombatEvent {
  const full: CombatEvent = { id: randomUUID(), timestamp: Date.now(), ...ev };
  const log = ensureLog(session);
  log.push(full);
  if (log.length > COMBAT_LOG_LIMIT) log.splice(0, log.length - COMBAT_LOG_LIMIT);
  res.events.push(full);
  return full;
}

function classesById(world: CombatWorld, ids: string[]): Map<string, CharacterClass> {
  const map = new Map<string, CharacterClass>();
  for (const id of ids) {
    const c = world.getCharacterClass(id);
    if (c) map.set(id, c);
  }
  return map;
}

/** КД цели-токена: из привязанного персонажа (по инвентарю) или монстра. */
function tokenArmorClass(session: SessionState, world: CombatWorld, token: LiveToken): number {
  if (token.characterId) {
    const ch = world.getCharacter(token.characterId);
    if (ch) {
      const items = new Map<string, Item>();
      for (const e of ch.inventory) {
        const it = world.getItem(e.itemId);
        if (it) items.set(it.id, it);
      }
      return characterArmorClass(ch, items);
    }
  }
  if (token.monsterId) {
    const mon = world.getMonster(token.monsterId);
    if (mon) return mon.armorClass;
  }
  return 10;
}

/** Бонус спасброска токена (концентрация/спас от заклинания). */
function tokenSaveBonus(world: CombatWorld, token: LiveToken, ability: Ability): number {
  if (token.characterId) {
    const ch = world.getCharacter(token.characterId);
    if (ch) return characterSaveBonus(ch, ability);
  }
  if (token.monsterId) {
    const mon = world.getMonster(token.monsterId);
    if (mon) return monsterSaveBonus(mon, ability);
  }
  return 0;
}

// ─── Источник заклинания/атаки ──────────────────────────────────────────────

interface CasterInfo {
  name: string;
  tokenId?: string;
  characterId?: string;
  ability: Ability;
  /** модификатор заклинательной характеристики (лечение, урон). */
  abilityMod: number;
  dc: number;
  attackBonus: number;
  slotsCurrent: number[];
  /** применить трату ячейки к источнику (персонаж в базе / токен сессии). */
  spendSlot(slotLevel: number): void;
}

/**
 * Собирает данные кастующего: персонаж (по characterId) или токен монстра
 * (по tokenId). Ячейки монстра живут на токене; максимум — из Monster.spellSlots.
 */
function resolveCaster(
  session: SessionState,
  world: CombatWorld,
  res: CombatResult,
  p: { characterId?: string; tokenId?: string },
): CasterInfo | { error: string } {
  if (p.characterId) {
    const ch = world.getCharacter(p.characterId);
    if (!ch) return { error: 'Персонаж не найден' };
    const clsIds = ch.classes.map((c) => c.classId);
    const sc = characterSpellcasting(ch, classesById(world, clsIds));
    if (!sc) return { error: 'Персонаж не является заклинателем' };
    return {
      name: ch.name,
      characterId: ch.id,
      ability: sc.ability,
      abilityMod: abilityModifier(effectiveScores(ch)[sc.ability]),
      dc: sc.dc,
      attackBonus: sc.attackBonus,
      slotsCurrent: ch.spellSlotsCurrent,
      spendSlot(slotLevel) {
        ch.spellSlotsCurrent = spendSpellSlot(ch.spellSlotsCurrent, slotLevel);
        world.saveCharacter(ch);
        res.updatedCharacters.push(ch);
      },
    };
  }
  if (p.tokenId) {
    const token = findToken(session, p.tokenId);
    if (!token) return { error: 'Токен не найден' };
    const mon = token.monsterId ? world.getMonster(token.monsterId) : undefined;
    const ability: Ability = mon?.spellcastingAbility ?? 'int';
    const casterLevel = mon?.casterLevel ?? 1;
    const score = mon?.abilities[ability] ?? 10;
    // инициализируем ячейки токена из монстра, если ещё не заданы
    if (!token.spellSlotsMax) token.spellSlotsMax = mon?.spellSlots?.max ? [...mon.spellSlots.max] : [];
    if (!token.spellSlotsCurrent) token.spellSlotsCurrent = [...token.spellSlotsMax];
    const tokenSlots = token.spellSlotsCurrent;
    res.updatedTokens.push(token);
    return {
      name: token.name,
      tokenId: token.id,
      ability,
      abilityMod: abilityModifier(score),
      dc: spellSaveDC(score, casterLevel),
      attackBonus: spellAttackBonus(score, casterLevel),
      slotsCurrent: tokenSlots,
      spendSlot(slotLevel) {
        token.spellSlotsCurrent = spendSpellSlot(token.spellSlotsCurrent ?? [], slotLevel);
        if (!res.updatedTokens.includes(token)) res.updatedTokens.push(token);
      },
    };
  }
  return { error: 'Не указан источник заклинания' };
}

// ─── Концентрация ───────────────────────────────────────────────────────────

/**
 * Авто-спас концентрации после получения урона. Снимает концентрацию при
 * провале и пишет событие. Ничего не делает, если цель не концентрируется.
 */
function concentrationCheck(
  session: SessionState,
  world: CombatWorld,
  res: CombatResult,
  token: LiveToken,
  damage: number,
  rng: Rng,
): void {
  if (!token.concentratingOn) return;
  const spell = world.getSpell(token.concentratingOn);
  const spellName = spell?.nameRu ?? token.concentratingOn;
  const dc = concentrationDC(damage);

  let bonus: number;
  let ch: Character | undefined;
  if (token.characterId) {
    ch = world.getCharacter(token.characterId);
    bonus = ch ? characterSaveBonus(ch, 'con') : tokenSaveBonus(world, token, 'con');
  } else {
    bonus = tokenSaveBonus(world, token, 'con');
  }
  const d20 = rollDie(20, rng);
  const success = d20 + bonus >= dc;

  if (!success) {
    token.concentratingOn = undefined;
    if (!res.updatedTokens.includes(token)) res.updatedTokens.push(token);
    // концентрация персонажа хранится и в его записи — снимаем синхронно
    if (token.characterId && ch) {
      ch.concentratingOn = undefined;
      world.saveCharacter(ch);
      res.updatedCharacters.push(ch);
    }
  }
  pushEvent(session, res, {
    phase: 'concentration',
    sourceName: token.name,
    sourceTokenId: token.id,
    sourceCharacterId: token.characterId,
    concentration: { spellId: spell?.id, spellName, dc, d20, bonus, success, lost: !success },
    text: success
      ? `${token.name} удержал концентрацию (${d20}${signed(bonus)} ≥ СЛ ${dc})`
      : `${token.name} потерял концентрацию: «${spellName}» (${d20}${signed(bonus)} < СЛ ${dc})`,
  });
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

// ─── Применение урона / лечения к токену ────────────────────────────────────

/**
 * Списывает урон с токена (clamp 0..maxHp), синхронизирует персонажа,
 * проверяет концентрацию и смерть. Возвращает фактически снятые хиты.
 */
function applyDamageToToken(
  session: SessionState,
  world: CombatWorld,
  res: CombatResult,
  token: LiveToken,
  amount: number,
  rng: Rng,
): number {
  if (amount <= 0) return 0;
  const before = token.currentHp;
  token.currentHp = Math.max(0, Math.min(token.maxHp || token.currentHp, token.currentHp - amount));
  const applied = before - token.currentHp;
  if (!res.updatedTokens.includes(token)) res.updatedTokens.push(token);

  // синхронизация с привязанным персонажем
  if (token.characterId) {
    const ch = world.getCharacter(token.characterId);
    if (ch) {
      ch.currentHp = token.currentHp;
      world.saveCharacter(ch);
      res.updatedCharacters.push(ch);
    }
  }
  // авто-спас концентрации
  if (applied > 0) concentrationCheck(session, world, res, token, applied, rng);
  return applied;
}

function healToken(
  world: CombatWorld,
  res: CombatResult,
  token: LiveToken,
  amount: number,
): number {
  if (amount <= 0) return 0;
  const before = token.currentHp;
  token.currentHp = Math.min(token.maxHp || token.currentHp, token.currentHp + amount);
  const applied = token.currentHp - before;
  if (!res.updatedTokens.includes(token)) res.updatedTokens.push(token);
  if (token.characterId) {
    const ch = world.getCharacter(token.characterId);
    if (ch) {
      ch.currentHp = token.currentHp;
      world.saveCharacter(ch);
      res.updatedCharacters.push(ch);
    }
  }
  return applied;
}

/**
 * Смерть токена (0 хитов) — отдельное событие. applied — сколько хитов
 * снято текущим ударом: по уже лежащему телу (applied === 0) событие не
 * дублируется.
 */
function deathCheck(session: SessionState, res: CombatResult, token: LiveToken, applied: number): void {
  if (applied <= 0 || token.currentHp > 0 || token.maxHp <= 0) return;
  pushEvent(session, res, {
    phase: 'death',
    sourceName: token.name,
    targetName: token.name,
    targetTokenId: token.id,
    targetCharacterId: token.characterId,
    text: `☠ ${token.name} падает без сознания (0 хитов)`,
  });
}

// ─── Каст заклинания ────────────────────────────────────────────────────────

export interface CastSpellParams {
  characterId?: string;
  tokenId?: string;
  spellId: string;
  slotLevel: number;
  targetTokenIds: string[];
}

export function resolveCastSpell(
  session: SessionState,
  world: CombatWorld,
  params: CastSpellParams,
  rng: Rng = defaultRng,
): CombatResult {
  const res = emptyResult();
  const spell = world.getSpell(params.spellId);
  if (!spell) return err('Заклинание не найдено');

  const casterOrErr = resolveCaster(session, world, res, params);
  if ('error' in casterOrErr) return err(casterOrErr.error);
  const caster = casterOrErr;

  // заговоры — без ячеек; иначе проверяем и тратим ячейку нужного уровня
  const slotLevel = spell.level === 0 ? 0 : params.slotLevel;
  const check = canCastFromSlot(spell, slotLevel, caster.slotsCurrent);
  if (!check.ok) return err(check.reason ?? 'Нельзя сотворить заклинание');
  if (slotLevel > 0) caster.spendSlot(slotLevel);

  // событие каста
  pushEvent(session, res, {
    phase: 'cast',
    sourceName: caster.name,
    sourceTokenId: caster.tokenId,
    sourceCharacterId: caster.characterId,
    spellId: spell.id,
    spellName: spell.nameRu,
    school: spell.school,
    slotLevel: slotLevel || undefined,
    text: `${caster.name} творит «${spell.nameRu}»${slotLevel ? ` (ячейка ${slotLevel} ур.)` : ''}`,
  });

  // концентрация: ставим на источник (персонаж/токен), снимая прежнюю
  if (spell.concentration) {
    if (caster.tokenId) {
      const t = findToken(session, caster.tokenId);
      if (t) {
        t.concentratingOn = spell.id;
        if (!res.updatedTokens.includes(t)) res.updatedTokens.push(t);
      }
    } else if (caster.characterId) {
      const ch = world.getCharacter(caster.characterId);
      if (ch) {
        ch.concentratingOn = spell.id;
        world.saveCharacter(ch);
        res.updatedCharacters.push(ch);
        // зеркалим на токен персонажа, если есть
        const t = session.tokens.find((tk) => tk.characterId === ch.id);
        if (t) {
          t.concentratingOn = spell.id;
          if (!res.updatedTokens.includes(t)) res.updatedTokens.push(t);
        }
      }
    }
  }

  // ── Лечение ──
  if (spell.heals && spell.damageDice) {
    const mod = Math.max(0, caster.abilityMod);
    const formula = spellDamageFormula(spell, slotLevel) ?? spell.damageDice;
    for (const tid of targetsOrSelf(session, caster, params.targetTokenIds)) {
      const token = findToken(session, tid);
      if (!token) continue;
      const rolled = rollDamageFormula(formula, false, rng);
      const amount = rolled.total + mod;
      const applied = healToken(world, res, token, amount);
      pushEvent(session, res, {
        phase: 'heal',
        sourceName: caster.name,
        sourceTokenId: caster.tokenId,
        sourceCharacterId: caster.characterId,
        targetName: token.name,
        targetTokenId: token.id,
        targetCharacterId: token.characterId,
        spellId: spell.id,
        spellName: spell.nameRu,
        heal: { dice: rolled.dice, rolls: rolled.rolls, bonus: mod, total: rolled.total, applied },
        text: `${caster.name} лечит ${token.name} на ${applied} (${rolled.dice}${signed(mod)})`,
      });
    }
    return res;
  }

  // ── Урон/спас или атака ──
  const targets = params.targetTokenIds
    .map((id) => findToken(session, id))
    .filter((t): t is LiveToken => Boolean(t));
  if (targets.length === 0) {
    // служебное/бафф без целей — просто событие каста
    return res;
  }

  if (spell.effectType === 'attack') {
    const projectiles = spellProjectileCount(spell, slotLevel);
    const formula = spellDamageFormula(spell, slotLevel) ?? spell.damageDice ?? '1d1';
    for (const target of targets) {
      const ac = tokenArmorClass(session, world, target);
      for (let i = 0; i < projectiles; i++) {
        if (spell.autoHit) {
          const dmg = rollDamageFormula(formula, false, rng);
          const applied = applyDamageToToken(session, world, res, target, dmg.total, rng);
          pushEvent(session, res, {
            phase: 'attack',
            sourceName: caster.name,
            sourceTokenId: caster.tokenId,
            sourceCharacterId: caster.characterId,
            targetName: target.name,
            targetTokenId: target.id,
            targetCharacterId: target.characterId,
            spellId: spell.id,
            spellName: spell.nameRu,
            school: spell.school,
            attack: { d20: 0, bonus: 0, total: 0, ac, hit: true, crit: false, fumble: false },
            damage: { dice: dmg.dice, rolls: dmg.rolls, bonus: dmg.bonus, total: dmg.total, halved: false, applied, damageType: spell.damageType },
            text: `${caster.name} → ${target.name}: автопопадание, ${applied} урона${spell.damageType ? ` (${spell.damageType})` : ''}`,
          });
          deathCheck(session, res, target, applied);
        } else {
          const atk = resolveAttack(caster.attackBonus, ac, formula, spell.damageType, rng);
          const applied = atk.roll.hit
            ? applyDamageToToken(session, world, res, target, atk.damage.total, rng)
            : 0;
          pushEvent(session, res, {
            phase: 'attack',
            sourceName: caster.name,
            sourceTokenId: caster.tokenId,
            sourceCharacterId: caster.characterId,
            targetName: target.name,
            targetTokenId: target.id,
            targetCharacterId: target.characterId,
            spellId: spell.id,
            spellName: spell.nameRu,
            school: spell.school,
            attack: atk.roll,
            damage: atk.roll.hit
              ? { dice: atk.damage.dice, rolls: atk.damage.rolls, bonus: atk.damage.bonus, total: atk.damage.total, halved: false, applied, damageType: spell.damageType }
              : undefined,
            text: attackText(caster.name, target.name, atk.roll, atk.roll.hit ? applied : 0, spell.damageType, atk.roll.hit),
          });
          if (atk.roll.hit) deathCheck(session, res, target, applied);
        }
      }
    }
    return res;
  }

  if (spell.effectType === 'save' && spell.saveAbility) {
    const formula = spellDamageFormula(spell, slotLevel) ?? spell.damageDice;
    for (const target of targets) {
      const bonus = tokenSaveBonus(world, target, spell.saveAbility);
      const rollerIsDm = !target.characterId; // монстров кидает мастер
      if (formula) {
        // урон откладывается до результата спасброска
        const dmg = rollDamageFormula(formula, false, rng);
        const req: SaveRequest = {
          id: randomUUID(),
          createdAt: Date.now(),
          ability: spell.saveAbility,
          dc: caster.dc,
          bonus,
          halfOnSuccess: Boolean(spell.halfOnSuccess),
          tokenId: target.id,
          characterId: target.characterId,
          rollerName: target.name,
          rollerIsDm,
          pendingDamage: { dice: dmg.dice, rolls: dmg.rolls, total: dmg.total, damageType: spell.damageType },
          sourceName: caster.name,
          sourceTokenId: caster.tokenId,
          sourceCharacterId: caster.characterId,
          spellId: spell.id,
          spellName: spell.nameRu,
        };
        ensureQueue(session).push(req);
        res.saveRequests.push(req);
        pushEvent(session, res, {
          phase: 'save-request',
          sourceName: caster.name,
          sourceTokenId: caster.tokenId,
          sourceCharacterId: caster.characterId,
          targetName: target.name,
          targetTokenId: target.id,
          targetCharacterId: target.characterId,
          spellId: spell.id,
          spellName: spell.nameRu,
          save: { requestId: req.id, ability: spell.saveAbility, dc: caster.dc, bonus },
          text: `${target.name}: спасбросок ${abilityRu(spell.saveAbility)} (СЛ ${caster.dc}) от «${spell.nameRu}»`,
        });
      } else {
        // спас без урона (усыпление, огонь фей, удержание): успех/провал сразу
        const d20 = rollDie(20, rng);
        const success = d20 + bonus >= caster.dc;
        pushEvent(session, res, {
          phase: 'save-result',
          sourceName: caster.name,
          targetName: target.name,
          targetTokenId: target.id,
          targetCharacterId: target.characterId,
          spellId: spell.id,
          spellName: spell.nameRu,
          save: { ability: spell.saveAbility, dc: caster.dc, bonus, d20, total: d20 + bonus, success },
          text: `${target.name}: спас ${abilityRu(spell.saveAbility)} ${d20}${signed(bonus)} ${success ? 'успех' : 'провал'} (СЛ ${caster.dc})`,
        });
      }
    }
    return res;
  }

  // utility без урона/лечения — только событие каста
  return res;
}

/** Цели лечения: указанные токены, иначе токен/персонаж источника. */
function targetsOrSelf(session: SessionState, caster: CasterInfo, requested: string[]): string[] {
  if (requested.length > 0) return requested;
  if (caster.tokenId) return [caster.tokenId];
  const self = session.tokens.find((t) => t.characterId === caster.characterId);
  return self ? [self.id] : [];
}

function abilityRu(ab: Ability): string {
  const map: Record<Ability, string> = {
    str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы',
  };
  return map[ab];
}

function attackText(
  sourceName: string, targetName: string,
  roll: { d20: number; hit: boolean; crit: boolean; fumble: boolean },
  applied: number, damageType?: string, hit?: boolean,
): string {
  if (roll.crit) return `${sourceName} → ${targetName}: КРИТ! ${applied} урона${damageType ? ` (${damageType})` : ''}`;
  if (roll.fumble) return `${sourceName} → ${targetName}: критический промах (1)`;
  if (roll.hit) return `${sourceName} → ${targetName}: попадание, ${applied} урона${damageType ? ` (${damageType})` : ''}`;
  void hit;
  return `${sourceName} → ${targetName}: промах`;
}

// ─── Атака оружием/действием ────────────────────────────────────────────────

export interface AttackWithParams {
  attackerTokenId?: string;
  attackerCharacterId?: string;
  attackName?: string;
  weaponItemId?: string;
  targetTokenId: string;
}

interface AttackProfile {
  name: string;
  attackBonus: number;
  damageDice: string;
  damageBonus: number;
  damageType?: string;
  sourceName: string;
  sourceTokenId?: string;
  sourceCharacterId?: string;
}

export function resolveAttackWith(
  session: SessionState,
  world: CombatWorld,
  params: AttackWithParams,
  rng: Rng = defaultRng,
): CombatResult {
  const res = emptyResult();
  const target = findToken(session, params.targetTokenId);
  if (!target) return err('Цель не найдена');

  const profile = buildAttackProfile(session, world, params);
  if (!profile) return err('Не найдена атака у источника');

  const ac = tokenArmorClass(session, world, target);
  const formula = `${profile.damageDice}${profile.damageBonus ? signed(profile.damageBonus) : ''}`;
  const atk = resolveAttack(profile.attackBonus, ac, formula, profile.damageType, rng);
  const applied = atk.roll.hit ? applyDamageToToken(session, world, res, target, atk.damage.total, rng) : 0;

  pushEvent(session, res, {
    phase: 'attack',
    sourceName: profile.sourceName,
    sourceTokenId: profile.sourceTokenId,
    sourceCharacterId: profile.sourceCharacterId,
    attackName: profile.name,
    targetName: target.name,
    targetTokenId: target.id,
    targetCharacterId: target.characterId,
    attack: atk.roll,
    damage: atk.roll.hit
      ? { dice: atk.damage.dice, rolls: atk.damage.rolls, bonus: atk.damage.bonus, total: atk.damage.total, halved: false, applied, damageType: profile.damageType }
      : undefined,
    text: attackText(profile.sourceName, target.name, atk.roll, applied, profile.damageType),
  });
  if (atk.roll.hit) deathCheck(session, res, target, applied);
  return res;
}

function buildAttackProfile(
  session: SessionState,
  world: CombatWorld,
  params: AttackWithParams,
): AttackProfile | null {
  // монстр (токен)
  if (params.attackerTokenId) {
    const token = findToken(session, params.attackerTokenId);
    if (!token) return null;
    const mon = token.monsterId ? world.getMonster(token.monsterId) : undefined;
    const atk = mon?.attacks.find((a) => a.name === params.attackName) ?? mon?.attacks[0];
    if (!atk) return null;
    return {
      name: atk.name,
      attackBonus: atk.attackBonus,
      damageDice: atk.damageDice,
      damageBonus: atk.damageBonus,
      damageType: atk.damageType,
      sourceName: token.name,
      sourceTokenId: token.id,
    };
  }
  // персонаж
  if (params.attackerCharacterId) {
    const ch = world.getCharacter(params.attackerCharacterId);
    if (!ch) return null;
    if (params.weaponItemId) {
      const item = world.getItem(params.weaponItemId);
      if (item?.damageDice) {
        const scores = effectiveScores(ch);
        const ab: Ability = item.weaponAbility ?? 'str';
        const mod = abilityModifier(scores[ab]);
        const prof = isProficientWith(ch, item, classesById(world, ch.classes.map((c) => c.classId)))
          ? proficiencyBonus(characterLevel(ch))
          : 0;
        const token = session.tokens.find((t) => t.characterId === ch.id);
        return {
          name: item.nameRu,
          attackBonus: prof + mod,
          damageDice: item.damageDice,
          damageBonus: mod,
          damageType: item.damageType,
          sourceName: ch.name,
          sourceTokenId: token?.id,
          sourceCharacterId: ch.id,
        };
      }
    }
    const atk = ch.attacks.find((a) => a.name === params.attackName) ?? ch.attacks[0];
    if (!atk) return null;
    const token = session.tokens.find((t) => t.characterId === ch.id);
    return {
      name: atk.name,
      attackBonus: atk.attackBonus,
      damageDice: atk.damageDice,
      damageBonus: atk.damageBonus,
      damageType: atk.damageType,
      sourceName: ch.name,
      sourceTokenId: token?.id,
      sourceCharacterId: ch.id,
    };
  }
  return null;
}

// ─── Спасброски (очередь) ───────────────────────────────────────────────────

export interface ResolveSaveParams {
  requestId: string;
  /** вписанный физический результат (d20). Если undefined — сервер кинет сам. */
  rolledValue?: number;
  /** результат вписан с физического кубика (для лога/анимаций). */
  physical?: boolean;
}

/**
 * Разрешает запрос спасброска из очереди: применяет отложенный урон с учётом
 * halfOnSuccess, снимает запрос, пишет событие и проверяет смерть/концентрацию.
 */
export function resolveSaveRequest(
  session: SessionState,
  world: CombatWorld,
  params: ResolveSaveParams,
  rng: Rng = defaultRng,
): CombatResult {
  const res = emptyResult();
  const queue = ensureQueue(session);
  const idx = queue.findIndex((r) => r.id === params.requestId);
  if (idx === -1) return err('Запрос спасброска не найден');
  const req = queue[idx]!;
  queue.splice(idx, 1);

  const d20 = params.rolledValue != null
    ? Math.min(20, Math.max(1, Math.round(params.rolledValue)))
    : rollDie(20, rng);
  const outcome = resolveSaveAgainstDamage(d20, req.bonus, req.dc, req.pendingDamage.total, req.halfOnSuccess);

  const token = findToken(session, req.tokenId);
  let applied = 0;
  if (token) {
    applied = applyDamageToToken(session, world, res, token, outcome.applied, rng);
  }

  pushEvent(session, res, {
    phase: 'save-result',
    sourceName: req.sourceName,
    sourceTokenId: req.sourceTokenId,
    sourceCharacterId: req.sourceCharacterId,
    targetName: req.rollerName,
    targetTokenId: req.tokenId,
    targetCharacterId: req.characterId,
    spellId: req.spellId,
    spellName: req.spellName,
    save: {
      requestId: req.id,
      ability: req.ability,
      dc: req.dc,
      bonus: req.bonus,
      d20,
      total: outcome.total,
      success: outcome.success,
      physical: params.physical,
    },
    damage: {
      dice: req.pendingDamage.dice,
      rolls: req.pendingDamage.rolls,
      bonus: 0,
      total: req.pendingDamage.total,
      halved: req.halfOnSuccess && outcome.success,
      applied,
      damageType: req.pendingDamage.damageType,
    },
    text: saveResultText(req, d20, outcome.success, applied),
  });
  if (token) deathCheck(session, res, token, applied);
  return res;
}

function saveResultText(
  req: SaveRequest, d20: number, success: boolean, applied: number,
): string {
  const half = req.halfOnSuccess;
  if (success) {
    return half
      ? `${req.rollerName}: спас ${abilityRu(req.ability)} (${d20}${signed(req.bonus)} ≥ СЛ ${req.dc}), ${applied} урона (половина)`
      : `${req.rollerName}: спас ${abilityRu(req.ability)} (${d20}${signed(req.bonus)} ≥ СЛ ${req.dc}), урона нет`;
  }
  return `${req.rollerName}: провалил спас ${abilityRu(req.ability)} (${d20}${signed(req.bonus)} < СЛ ${req.dc}), ${applied} урона`;
}

// ─── Отдых ──────────────────────────────────────────────────────────────────

export interface RestParams {
  characterId: string;
  kind: 'short' | 'long';
}

export function resolveRest(
  session: SessionState,
  world: CombatWorld,
  params: RestParams,
  rng: Rng = defaultRng,
): CombatResult {
  const res = emptyResult();
  const ch = world.getCharacter(params.characterId);
  if (!ch) return err('Персонаж не найден');

  if (params.kind === 'long') {
    ch.currentHp = ch.maxHp;
    ch.tempHp = 0;
    ch.hitDiceCurrent = ch.hitDiceTotal;
    ch.spellSlotsCurrent = [...ch.spellSlotsMax];
    ch.resources = ch.resources.map((r) => ({ ...r, current: r.max }));
    ch.deathSaves = { successes: 0, failures: 0 };
    world.saveCharacter(ch);
    res.updatedCharacters.push(ch);
    pushEvent(session, res, {
      phase: 'rest',
      sourceName: ch.name,
      sourceCharacterId: ch.id,
      rest: { kind: 'long' },
      text: `${ch.name}: длинный отдых — силы полностью восстановлены`,
    });
    mirrorCharacterToToken(session, res, ch);
    return res;
  }

  // короткий отдых
  const { healed, hitDieRoll, hitDiceSpent } = shortRestHeal(ch, rng);
  const hpBefore = ch.currentHp;
  ch.hitDiceCurrent = Math.max(0, ch.hitDiceCurrent - hitDiceSpent);
  ch.currentHp = Math.min(ch.maxHp, ch.currentHp + healed);
  const actualHealed = ch.currentHp - hpBefore;
  ch.resources = ch.resources.map((r) => (r.resetOn === 'short' ? { ...r, current: r.max } : r));
  world.saveCharacter(ch);
  res.updatedCharacters.push(ch);
  pushEvent(session, res, {
    phase: 'rest',
    sourceName: ch.name,
    sourceCharacterId: ch.id,
    rest: { kind: 'short', healed: actualHealed, hitDieRoll },
    text: actualHealed > 0
      ? `${ch.name}: короткий отдых, восстановлено ${actualHealed} хитов (1к${ch.hitDieType}=${hitDieRoll})`
      : `${ch.name}: короткий отдых`,
  });
  mirrorCharacterToToken(session, res, ch);
  return res;
}

function mirrorCharacterToToken(session: SessionState, res: CombatResult, ch: Character): void {
  const token = session.tokens.find((t) => t.characterId === ch.id);
  if (!token) return;
  token.currentHp = ch.currentHp;
  token.maxHp = ch.maxHp;
  if (!res.updatedTokens.includes(token)) res.updatedTokens.push(token);
}
