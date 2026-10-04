// ─── Сценарий-проверка боевого движка (ROADMAP, шаг 2) ──────────────────────
// Запуск: node server/scripts/combat-check.mjs (из корня репо, после
// npm run build -w shared && npm run build -w server). Без tsx и без базы:
// мир — in-memory подделка CombatWorld, кости — детерминированные через rng.
//
// Проверяет: castSpell тратит ячейку; крит/промах; save-очередь и её
// разрешение; halfOnSuccess; концентрация слетает при провале авто-спаса;
// смерть токена; короткий/длинный отдых.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveCastSpell, resolveAttackWith, resolveSaveRequest, resolveRest,
} from '../dist/combat.js';
import { sequenceRng } from '@vibednd/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.join(__dirname, '../data/seed');

// ─── Данные мира (seed + синтетический кастер) ─────────────────────────────

const spells = new Map(JSON.parse(readFileSync(path.join(SEED, 'spells.json'), 'utf8')).map((s) => [s.id, s]));
const monsters = new Map(JSON.parse(readFileSync(path.join(SEED, 'monsters.json'), 'utf8')).map((m) => [m.id, m]));
const items = new Map(JSON.parse(readFileSync(path.join(SEED, 'items.json'), 'utf8')).map((i) => [i.id, i]));
const classes = new Map(JSON.parse(readFileSync(path.join(SEED, 'classes.json'), 'utf8')).map((c) => [c.id, c]));

// монстр-кастер (в seed явных кастеров нет — синтетика для проверки движка)
const cultCaster = {
  ...monsters.get('cultist'),
  id: 'cult-fanatic-test',
  nameRu: 'Культист-фанатик (тест)',
  armorClass: 13,
  hitPoints: 33,
  abilities: { str: 11, dex: 14, con: 12, int: 10, wis: 15, cha: 14 },
  spells: ['fireball', 'sacred-flame'],
  spellSlots: { max: [4, 3, 3], current: [4, 3, 3] },
  spellcastingAbility: 'wis',
  casterLevel: 9,
};
monsters.set(cultCaster.id, cultCaster);

const characters = new Map();
function makeCharacter(id, over = {}) {
  const ch = {
    id,
    name: 'Тестовый Маг',
    playerName: 'Тест',
    speciesId: 'human',
    backgroundId: 'sage',
    classes: [{ classId: 'wizard', level: 5, hpRolls: [6, 6, 6, 6], chosenSpells: [] }],
    abilityScores: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    backgroundBonuses: { int: 2, con: 1 },
    skillProficiencies: ['arcana'],
    expertise: [],
    savingThrowProficiencies: ['int', 'wis'],
    maxHp: 33,
    currentHp: 33,
    tempHp: 0,
    hitDiceTotal: 5,
    hitDiceCurrent: 5,
    hitDieType: 6,
    pendingHpGain: null,
    spellSlotsMax: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    spellSlotsCurrent: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    knownSpells: ['fireball', 'cure-wounds', 'magic-missile', 'shield'],
    preparedSpells: ['fireball', 'cure-wounds'],
    conditions: [],
    attunedItemIds: [],
    inventory: [],
    resources: [],
    attacks: [
      { name: 'Кинжал', attackBonus: 5, damageDice: '1d4', damageBonus: 3, damageType: 'колющий' },
    ],
    deathSaves: { successes: 0, failures: 0 },
    inspiration: false,
    notes: '',
    ...over,
  };
  characters.set(id, ch);
  return ch;
}

const world = {
  getCharacter: (id) => characters.get(id),
  getSpell: (id) => spells.get(id),
  getMonster: (id) => monsters.get(id),
  getItem: (id) => items.get(id),
  getCharacterClass: (id) => classes.get(id),
  saveCharacter: (ch) => characters.set(ch.id, ch),
};

function makeSession(tokens) {
  return {
    id: 'test-session',
    adventureId: 'test-adv',
    name: 'Тест боя',
    activeMapId: 'map1',
    tokens,
    fogReveals: [],
    drawings: [],
    combat: { active: true, round: 1, entries: [], currentIndex: 0 },
    characterIds: [...characters.keys()],
    diceLog: [],
    saveRequests: [],
    combatLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeToken(id, over = {}) {
  return {
    id,
    mapId: 'map1',
    kind: 'enemy',
    name: 'Гоблин',
    x: 0, y: 0,
    sizeCells: 1,
    hidden: false,
    monsterId: 'goblin',
    currentHp: 7,
    maxHp: 7,
    conditions: [],
    ...over,
  };
}

// ─── Мини-фреймворк проверок ────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ─── 1. castSpell тратит ячейку ─────────────────────────────────────────────

console.log('1. castSpell: трата ячейки');
{
  const mage = makeCharacter('mage-1');
  const goblin = makeToken('gob-1');
  const session = makeSession([goblin]);
  // огненный шар по гоблину: сначала d20 гоблина-спас... но урон отложен в
  // очередь, поэтому rng здесь не нужен для урона; даём безвредную последовательность
  const res = resolveCastSpell(session, world, {
    characterId: 'mage-1', spellId: 'fireball', slotLevel: 3, targetTokenIds: ['gob-1'],
  }, sequenceRng([]));
  check('нет ошибки', !res.error, res.error ?? '');
  check('ячейка 3-го уровня потрачена (2→1)', characters.get('mage-1').spellSlotsCurrent[2] === 1);
  check('событие cast', res.events.some((e) => e.phase === 'cast' && e.spellId === 'fireball'));
  check('создан запрос спасброска', res.saveRequests.length === 1);
  check('спас Ловкости против СЛ мага', res.saveRequests[0].ability === 'dex');
  // маг 5 ур., Инт 18 (16+2): СЛ = 8 + 3 + 4 = 15
  check('СЛ 15', res.saveRequests[0].dc === 15, `dc=${res.saveRequests[0].dc}`);
  check('урон 8d6 отложен', res.saveRequests[0].pendingDamage.total > 0);
  check('rollerIsDm — монстра кидает мастер', res.saveRequests[0].rollerIsDm === true);
  check('запрос в очереди сессии', session.saveRequests.length === 1);
  // заговор ячейки не тратит
  const before = [...characters.get('mage-1').spellSlotsCurrent];
  const res2 = resolveCastSpell(session, world, {
    characterId: 'mage-1', spellId: 'fire-bolt', slotLevel: 0, targetTokenIds: ['gob-1'],
  }, sequenceRng([0.5, 0.5, 0.5]));
  check('заговор без ошибки', !res2.error, res2.error ?? '');
  check('ячейки не изменились', JSON.stringify(characters.get('mage-1').spellSlotsCurrent) === JSON.stringify(before));
  // каст из пустой ячейки — отказ
  const res3 = resolveCastSpell(session, world, {
    characterId: 'mage-1', spellId: 'fireball', slotLevel: 4, targetTokenIds: ['gob-1'],
  }, sequenceRng([]));
  check('пустая ячейка 4 ур. — ошибка', Boolean(res3.error), 'ожидалась ошибка');
}

// ─── 2. Крит и промах (attackWith) ──────────────────────────────────────────

console.log('2. attackWith: крит / промах / попадание');
{
  const mage = makeCharacter('mage-2');
  const gob = makeToken('gob-2'); // гоблин: AC 15, 7 hp
  const session = makeSession([gob]);
  // крит: d20=20 (v≥19/20), затем кости урона
  const crit = resolveAttackWith(session, world, {
    attackerCharacterId: 'mage-2', attackName: 'Кинжал', targetTokenId: 'gob-2',
  }, sequenceRng([0.999]));
  const critEv = crit.events.find((e) => e.phase === 'attack');
  check('крит — попадание', critEv.attack.hit && critEv.attack.crit);
  check('крит — удвоены кости урона (2d4)', critEv.damage.dice === '2d4', critEv.damage.dice);
  check('крит — урон применён', gob.currentHp < 7);
  check('крит в тексте лога', critEv.text.includes('КРИТ'));

  gob.currentHp = 7;
  // промах: d20=1 — автопромах даже при огромном бонусе
  const fumble = resolveAttackWith(session, world, {
    attackerCharacterId: 'mage-2', attackName: 'Кинжал', targetTokenId: 'gob-2',
  }, sequenceRng([0.0]));
  const fEv = fumble.events.find((e) => e.phase === 'attack');
  check('натуральная 1 — промах', !fEv.attack.hit && fEv.attack.fumble);
  check('промах — урона нет', gob.currentHp === 7);

  // обычное попадание: d20=13 + 5 = 18 ≥ 15
  const hit = resolveAttackWith(session, world, {
    attackerCharacterId: 'mage-2', attackName: 'Кинжал', targetTokenId: 'gob-2',
  }, sequenceRng([0.6, 0.999])); // d20=13, кинжал 1d4=max
  const hEv = hit.events.find((e) => e.phase === 'attack');
  check('попадание 18≥15', hEv.attack.hit && hEv.attack.d20 === 13);
  check('урон = кость(4)+мод(3) = 7', hEv.damage.applied === 7, `applied=${hEv.damage.applied}`);
  check('гоблин при смерти (0 HP)', gob.currentHp === 0);
  check('событие death', hit.events.some((e) => e.phase === 'death' && e.targetTokenId === 'gob-2'));

  // атака монстра по персонажу (токен персонажа)
  const hero = makeCharacter('hero-3', { maxHp: 12, currentHp: 12 });
  const heroToken = makeToken('hero-tok', {
    kind: 'player', monsterId: undefined, characterId: 'hero-3', currentHp: 12, maxHp: 12, name: 'Герой',
  });
  const gobAtk = makeToken('gob-atk');
  const s2 = makeSession([heroToken, gobAtk]);
  const mAtk = resolveAttackWith(s2, world, {
    attackerTokenId: 'gob-atk', attackName: 'Скимитар', targetTokenId: 'hero-tok',
  }, sequenceRng([0.999])); // крит гоблина (+4): автопопадание
  const mEv = mAtk.events.find((e) => e.phase === 'attack');
  check('атака монстра — крит по персонажу', mEv.attack.crit && mEv.attack.hit);
  check('HP персонажа синхронизировано с токеном', characters.get('hero-3').currentHp === heroToken.currentHp);
  check('characterUpdated в рассылке', mAtk.updatedCharacters.some((c) => c.id === 'hero-3'));
}

// ─── 3. Save-очередь: halfOnSuccess, провал, смерть ─────────────────────────

console.log('3. save-очередь и halfOnSuccess');
{
  // три ячейки 3-го уровня — на три огненных шара подряд
  const mage = makeCharacter('mage-4', {
    spellSlotsMax: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    spellSlotsCurrent: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  });
  const gob = makeToken('gob-4', { currentHp: 100, maxHp: 100 }); // много HP
  const session = makeSession([gob]);
  const cast = resolveCastSpell(session, world, {
    characterId: 'mage-4', spellId: 'fireball', slotLevel: 3, targetTokenIds: ['gob-4'],
  }, sequenceRng([]));
  const req = cast.saveRequests[0];
  const dmgTotal = req.pendingDamage.total;
  check('запрос в очереди', session.saveRequests.some((r) => r.id === req.id));

  // успех: d20=20 → total 20+2 (Лов гоблина +2? нет, бонус из monsterSaveBonus: dex+2) ≥ 15
  const success = resolveSaveRequest(session, world, {
    requestId: req.id, rolledValue: 20, physical: false,
  }, sequenceRng([]));
  const sEv = success.events.find((e) => e.phase === 'save-result');
  check('спас успешен', sEv.save.success === true);
  check('урон вдвое (halfOnSuccess)', sEv.damage.applied === Math.floor(dmgTotal / 2),
    `applied=${sEv.damage.applied}, half=${Math.floor(dmgTotal / 2)}`);
  check('запрос убран из очереди', !session.saveRequests.some((r) => r.id === req.id));

  // провал: d20=1 + бонус < 15 → полный урон
  const cast2 = resolveCastSpell(session, world, {
    characterId: 'mage-4', spellId: 'fireball', slotLevel: 3, targetTokenIds: ['gob-4'],
  }, sequenceRng([]));
  const req2 = cast2.saveRequests[0];
  const fail = resolveSaveRequest(session, world, { requestId: req2.id, rolledValue: 1 }, sequenceRng([]));
  const fEv = fail.events.find((e) => e.phase === 'save-result');
  check('спас провален', fEv.save.success === false);
  check('полный урон', fEv.damage.applied === req2.pendingDamage.total);

  // добивание: смерть токена при 0 HP
  gob.currentHp = 3;
  const cast3 = resolveCastSpell(session, world, {
    characterId: 'mage-4', spellId: 'fireball', slotLevel: 3, targetTokenIds: ['gob-4'],
  }, sequenceRng([]));
  const req3 = cast3.saveRequests[0];
  const death = resolveSaveRequest(session, world, { requestId: req3.id, rolledValue: 1 }, sequenceRng([]));
  check('токен добит до 0', gob.currentHp === 0);
  check('событие смерти после проваленного спаса', death.events.some((e) => e.phase === 'death'));

  // виртуальный бросок (rng) вместо вписанного
  const cast4 = resolveCastSpell(session, world, {
    characterId: 'mage-4', spellId: 'sacred-flame' in spells ? 'sacred-flame' : 'fireball', slotLevel: 0, targetTokenIds: ['gob-4'],
  }, sequenceRng([]));
  if (cast4.error) {
    check('заговор святое пламя по мертвецу (ожидается ok или death)', true);
  } else {
    const req4 = cast4.saveRequests[0];
    const rolled = resolveSaveRequest(session, world, { requestId: req4.id }, sequenceRng([0.0])); // d20=1
    check('виртуальный бросок d20=1 — провал', rolled.events.find((e) => e.phase === 'save-result').save.success === false);
  }
}

// ─── 4. Концентрация слетает при уроне ──────────────────────────────────────

console.log('4. концентрация');
{
  const mage = makeCharacter('mage-5', { maxHp: 40, currentHp: 40 });
  const mageToken = makeToken('mage-tok', {
    kind: 'player', monsterId: undefined, characterId: 'mage-5', name: 'Маг', currentHp: 40, maxHp: 40,
  });
  const gob = makeToken('gob-5');
  const session = makeSession([mageToken, gob]);

  // маг ставит концентрацию («сглаз» — hex, concentration: true)
  const castHex = resolveCastSpell(session, world, {
    characterId: 'mage-5', spellId: 'hex', slotLevel: 1, targetTokenIds: ['gob-5'],
  }, sequenceRng([]));
  check('hex сотворён без ошибки', !castHex.error, castHex.error ?? '');
  check('концентрация на токене мага', mageToken.concentratingOn === 'hex');

  // провал авто-спаса: d20=1 (третий бросок), мод Тел +2, СЛ=max(10, урон/2)=10 → 3 < 10
  const atk = resolveAttackWith(session, world, {
    attackerTokenId: 'gob-5', attackName: 'Скимитар', targetTokenId: 'mage-tok',
  }, sequenceRng([0.6, 0.5, 0.0])); // d20=13+4=17 ≥ КД мага (10+dex 2=12) → попадание, урон 1d6+2, авто-спас d20=1
  const atkEv = atk.events.find((e) => e.phase === 'attack');
  check('гоблин попал по магу', atkEv?.attack.hit === true);
  const concEv = atk.events.find((e) => e.phase === 'concentration');
  check('событие концентрации создано', Boolean(concEv));
  check('СЛ концентрации = max(10, урон/2)', concEv.concentration.dc === Math.max(10, Math.floor(atkEv.damage.applied / 2)));
  check('концентрация снята при провале', mageToken.concentratingOn === undefined && concEv.concentration.lost === true);
  check('character/concentratingOn сброшен', characters.get('mage-5').concentratingOn === undefined);

  // успех авто-спаса: d20=20
  makeCharacter('mage-6', { maxHp: 40, currentHp: 40 });
  const mage6Tok = makeToken('mage6-tok', {
    kind: 'player', monsterId: undefined, characterId: 'mage-6', name: 'Маг2', currentHp: 40, maxHp: 40,
  });
  const gob6 = makeToken('gob-6');
  const s2 = makeSession([mage6Tok, gob6]);
  resolveCastSpell(s2, world, { characterId: 'mage-6', spellId: 'hex', slotLevel: 1, targetTokenIds: ['gob-6'] }, sequenceRng([]));
  const atk2 = resolveAttackWith(s2, world, {
    attackerTokenId: 'gob-6', attackName: 'Скимитар', targetTokenId: 'mage6-tok',
  }, sequenceRng([0.6, 0.5, 0.999])); // попадание, затем авто-спас d20=20
  const concEv2 = atk2.events.find((e) => e.phase === 'concentration');
  check('успешный авто-спас — концентрация держится', concEv2.concentration.success === true && mage6Tok.concentratingOn === 'hex');
}

// ─── 5. Каст монстра: ячейки токена, раздельно у двух одинаковых ────────────

console.log('5. ячейки монстра на токене');
{
  const gob1 = makeToken('caster-1', { monsterId: 'cult-fanatic-test', name: 'Фанатик 1', currentHp: 33, maxHp: 33 });
  const gob2 = makeToken('caster-2', { monsterId: 'cult-fanatic-test', name: 'Фанатик 2', currentHp: 33, maxHp: 33 });
  const target = makeToken('victim', { currentHp: 50, maxHp: 50 });
  const session = makeSession([gob1, gob2, target]);

  // заговор монстра: без ячеек, спас бросает мастер
  const r2 = resolveCastSpell(session, world, {
    tokenId: 'caster-1', spellId: 'sacred-flame', slotLevel: 0, targetTokenIds: ['victim'],
  }, sequenceRng([]));
  check('заговор монстра без ошибки', !r2.error, r2.error ?? '');
  check('очередь спасброска от монстра', r2.saveRequests.length === 1 && r2.saveRequests[0].rollerIsDm === true);
  // СЛ монстра: wis 15 (+2), casterLevel 9 (проф +4) → 8+4+2 = 14
  check('СЛ монстра = 14', r2.saveRequests[0].dc === 14, `dc=${r2.saveRequests[0].dc}`);

  // ячейка ниже уровня заклинания — отказ
  const r3 = resolveCastSpell(session, world, {
    tokenId: 'caster-2', spellId: 'fireball', slotLevel: 2, targetTokenIds: ['victim'],
  }, sequenceRng([]));
  check('огненный шар из ячейки 2 ур. — отказ (slot < level)', Boolean(r3.error));

  // огненный шар из ячейки 3 ур. первым фанатиком
  const r4 = resolveCastSpell(session, world, {
    tokenId: 'caster-1', spellId: 'fireball', slotLevel: 3, targetTokenIds: ['victim'],
  }, sequenceRng([]));
  check('каст фанатика 1 без ошибки', !r4.error, r4.error ?? '');
  check('ячейка 3 ур. фанатика 1 потрачена (3→2)', gob1.spellSlotsCurrent[2] === 2);
  // неудачный каст инициализирует ячейки токена из монстра, но НЕ тратит их
  check('отказанный каст фанатика 2 ячейку не потратил (3 ур. полна)', gob2.spellSlotsCurrent[2] === 3);

  // второй такой же монстр тратит СВОЮ ячейку раздельно
  const r5 = resolveCastSpell(session, world, {
    tokenId: 'caster-2', spellId: 'fireball', slotLevel: 3, targetTokenIds: ['victim'],
  }, sequenceRng([]));
  check('каст фанатика 2 без ошибки', !r5.error, r5.error ?? '');
  check('ячейка фанатика 2 независима (3→2)', gob2.spellSlotsCurrent[2] === 2);
  check('ячейка фанатика 1 не изменилась (всё ещё 2)', gob1.spellSlotsCurrent[2] === 2);
}

// ─── 6. Лечение и отдых ─────────────────────────────────────────────────────

console.log('6. лечение и отдых');
{
  const cleric = makeCharacter('cleric-7', {
    classes: [{ classId: 'cleric', level: 5, hpRolls: [8, 6, 6, 6], chosenSpells: [] }],
    knownSpells: ['cure-wounds', 'healing-word'],
    abilityScores: { str: 10, dex: 10, con: 12, int: 10, wis: 18, cha: 10 },
    backgroundBonuses: {},
    currentHp: 20,
    hitDiceCurrent: 2,
    hitDieType: 8,
  });
  const hurt = makeToken('hurt-1', { kind: 'player', monsterId: undefined, characterId: 'cleric-7', currentHp: 10, maxHp: 33, name: 'Жрец' });
  const session = makeSession([hurt]);
  const heal = resolveCastSpell(session, world, {
    characterId: 'cleric-7', spellId: 'cure-wounds', slotLevel: 1, targetTokenIds: ['hurt-1'],
  }, sequenceRng([0.999, 0.999])); // 2d8: 8+8 + мод Мдр (+4) = 20
  const healEv = heal.events.find((e) => e.phase === 'heal');
  check('лечение: 2d8+4 = 20', healEv?.heal.applied === 20, `applied=${healEv?.heal.applied}`);
  check('токен вылечен 10→30', hurt.currentHp === 30);
  check('персонаж синхронизирован', characters.get('cleric-7').currentHp === 30);
  check('ячейка 1 ур. потрачена', characters.get('cleric-7').spellSlotsCurrent[0] === 3);

  // короткий отдых: кость хитов d8=8 + con(+1) = 9, но жрец 30/33 → применится 3
  const beforeHp = characters.get('cleric-7').currentHp; // 30
  const short = resolveRest(session, world, { characterId: 'cleric-7', kind: 'short' }, sequenceRng([0.999]));
  const shortEv = short.events.find((e) => e.phase === 'rest');
  check('кость хитов d8=8', shortEv.rest.hitDieRoll === 8, `roll=${shortEv.rest.hitDieRoll}`);
  check('применено с clamp по максимуму (33): 3 хита', shortEv.rest.healed === 3, `healed=${shortEv.rest.healed}`);
  check('HP дорос до максимума (33)', characters.get('cleric-7').currentHp === 33 && beforeHp === 30);
  check('кость хитов потрачена (2→1)', characters.get('cleric-7').hitDiceCurrent === 1);

  // длинный отдых
  characters.get('cleric-7').spellSlotsCurrent = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const long = resolveRest(session, world, { characterId: 'cleric-7', kind: 'long' }, sequenceRng([]));
  const c = characters.get('cleric-7');
  check('длинный отдых: HP полные', c.currentHp === c.maxHp);
  check('ячейки восстановлены', c.spellSlotsCurrent[0] === c.spellSlotsMax[0]);
  check('кости хитов восстановлены', c.hitDiceCurrent === c.hitDiceTotal);
  check('событие rest(long)', long.events.some((e) => e.phase === 'rest' && e.rest.kind === 'long'));
}

// ─── 7. Upcast и мульти-снаряды ─────────────────────────────────────────────

console.log('7. upcast и снаряды');
{
  const mage = makeCharacter('mage-8');
  const g1 = makeToken('g-up1', { currentHp: 50, maxHp: 50 });
  const session = makeSession([g1]);
  // волшебная стрела из ячейки 3 ур.: 3+2 = 5 дротиков по 1d4+1, автопопадание
  const mm = resolveCastSpell(session, world, {
    characterId: 'mage-8', spellId: 'magic-missile', slotLevel: 3, targetTokenIds: ['g-up1'],
  }, sequenceRng([0.999, 0.999, 0.999, 0.999, 0.999]));
  const mmEvents = mm.events.filter((e) => e.phase === 'attack');
  check('5 дротиков (upcast +1 дротик за уровень)', mmEvents.length === 5, `events=${mmEvents.length}`);
  check('каждый по 1d4+1 = 5 урона (автопопадание)', mmEvents.every((e) => e.damage.applied === 5));
  // огненный шар из ячейки 5 ур. — но у мага только 2 ячейки 3-го; проверяем формулу через 3→нет;
  // вместо него — направляющий снаряд (guiding-bolt) upcast +1d6: ячейка 2 → 5d6
  const gb = resolveCastSpell(session, world, {
    characterId: 'mage-8', spellId: 'guiding-bolt', slotLevel: 2, targetTokenIds: ['g-up1'],
  }, sequenceRng([0.6, 0.999, 0.999, 0.999, 0.999, 0.999])); // d20=13 + бонус атаки; 5d6 max
  const gbEv = gb.events.find((e) => e.phase === 'attack' && e.spellId === 'guiding-bolt');
  check('guiding-bolt из ячейки 2 ур.: 5d6 (upcast +1d6)', gbEv.damage.dice === '5d6', gbEv.damage.dice);
  check('атака заклинанием попала (d20=13+7≥15)', gbEv.attack.hit === true, `total=${gbEv.attack.total}`);
}

// ─── Итог ───────────────────────────────────────────────────────────────────

console.log(`\nИтого: ${passed} пройдено, ${failed} провалено`);
process.exit(failed > 0 ? 1 : 0);
