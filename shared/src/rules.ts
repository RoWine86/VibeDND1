// ─── Движок правил D&D 2024 (5.5e): модификаторы, кости, производные ────────

import type {
  Ability, AbilityScores, ArmorProficiency, Character, CharacterClass,
  Coins, CombatAttackRoll, Cost, Currency, Item, Monster, Spell, WeaponCategory,
} from './types.js';
import { characterLevel, COIN_VALUE_IN_CP, CURRENCIES, zeroCoins } from './types.js';

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function modifierText(score: number): string {
  const m = abilityModifier(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

// Форматирует уже готовый модификатор/бонус со знаком (в отличие от modifierText,
// которая принимает ЗНАЧЕНИЕ характеристики).
export function signedText(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function proficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

export function effectiveScores(ch: Character): AbilityScores {
  const out = { ...ch.abilityScores };
  for (const [ab, bonus] of Object.entries(ch.backgroundBonuses)) {
    const key = ab as Ability;
    out[key] = (out[key] ?? 10) + (bonus ?? 0);
  }
  return out;
}

// ─── Кости ──────────────────────────────────────────────────────────────────

export interface DiceRoll {
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
}

const DICE_RE = /^(\d+)?d(\d+)([+-]\d+)?$/;

export function rollDice(formula: string): DiceRoll {
  const m = DICE_RE.exec(formula.replace(/\s/g, ''));
  if (!m) throw new Error(`Некорректная формула костей: ${formula}`);
  const count = Number(m[1] ?? 1);
  const sides = Number(m[2]);
  const modifier = Number(m[3] ?? 0);
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
    throw new Error(`Некорректная формула костей: ${formula}`);
  }
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { formula, rolls, modifier, total };
}

export function formatFormula(dice: string, bonus: number): string {
  if (bonus === 0) return dice;
  return `${dice}${bonus > 0 ? '+' : ''}${bonus}`;
}

// ─── Производные персонажа ──────────────────────────────────────────────────

/** Standard array по правилам 2024 */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/** Point buy: 27 очков, стоимость значения */
export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};
export const POINT_BUY_BUDGET = 27;

export function pointBuySpent(scores: AbilityScores): number {
  return Object.values(scores).reduce((sum, v) => sum + (POINT_BUY_COSTS[v] ?? 0), 0);
}

/** HP первого уровня: максимум кости хитов + мод. Телосложения */
export function firstLevelHp(hitDie: number, conScore: number): number {
  return hitDie + abilityModifier(conScore);
}

/** HP при повышении: бросок (или среднее, округлённое вверх) + мод. Телосложения */
export function averageHpGain(hitDie: number, conScore: number): number {
  return Math.floor(hitDie / 2) + 1 + abilityModifier(conScore);
}

/** СЛ заклинаний и бонус атаки заклинанием */
export function spellSaveDC(spellcastingScore: number, level: number): number {
  return 8 + proficiencyBonus(level) + abilityModifier(spellcastingScore);
}

export function spellAttackBonus(spellcastingScore: number, level: number): number {
  return proficiencyBonus(level) + abilityModifier(spellcastingScore);
}

/** Проверка концентрации: СЛ = max(10, половина урона) */
export function concentrationDC(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

/** Название класса (рус.) для строки «3 ур.» в карточках. */
export function classNameRu(classId: string, classesById?: Map<string, CharacterClass>): string {
  const cls = classesById?.get(classId);
  if (cls) return cls.nameRu;
  return classId.charAt(0).toUpperCase() + classId.slice(1);
}

// ─── Владение оружием и бронёй (D&D 2024) ───────────────────────────────────

/** Владение по классам из книги правил — используется, когда у записи класса
 *  нет явных полей weaponProficiencies/armorProficiencies. */
const CLASS_PROFICIENCIES: Record<string, {
  weapons: { categories: WeaponCategory[]; itemIds: string[] };
  armor: ArmorProficiency[];
}> = {
  barbarian: { weapons: { categories: ['simple', 'martial'], itemIds: [] }, armor: ['light', 'medium', 'shield'] },
  bard:      { weapons: { categories: ['simple'], itemIds: [] }, armor: ['light'] },
  cleric:    { weapons: { categories: ['simple'], itemIds: [] }, armor: ['light', 'medium', 'shield'] },
  druid:     { weapons: { categories: ['simple'], itemIds: [] }, armor: ['light', 'medium', 'shield'] }, // неметаллическая броня
  fighter:   { weapons: { categories: ['simple', 'martial'], itemIds: [] }, armor: ['light', 'medium', 'heavy', 'shield'] },
  monk:      { weapons: { categories: ['simple'], itemIds: ['shortsword'] }, armor: [] },
  paladin:   { weapons: { categories: ['simple', 'martial'], itemIds: [] }, armor: ['light', 'medium', 'heavy', 'shield'] },
  ranger:    { weapons: { categories: ['simple', 'martial'], itemIds: [] }, armor: ['light', 'medium', 'shield'] },
  rogue:     { weapons: { categories: ['simple'], itemIds: ['rapier', 'shortsword', 'longsword'] }, armor: ['light'] },
  sorcerer:  { weapons: { categories: ['simple'], itemIds: [] }, armor: [] },
  warlock:   { weapons: { categories: ['simple'], itemIds: [] }, armor: ['light'] },
  wizard:    { weapons: { categories: ['simple'], itemIds: [] }, armor: [] },
};

/** Простое оружие — по id записей справочника (запасная классификация,
 *  если у предмета не задан weaponCategory). */
const SIMPLE_WEAPON_IDS = new Set([
  'club', 'dagger', 'greatclub', 'handaxe', 'javelin', 'light-hammer', 'mace',
  'quarterstaff', 'sickle', 'spear', 'light-crossbow', 'dart', 'shortbow',
  'sling',
]);

const ALL_WEAPON_CATS: WeaponCategory[] = ['simple', 'martial'];
const ALL_ARMOR_TYPES: ArmorProficiency[] = ['light', 'medium', 'heavy', 'shield'];

/** Категория оружия предмета (simple/martial). */
export function weaponCategoryOf(item: Item): WeaponCategory {
  if (item.weaponCategory) return item.weaponCategory;
  return SIMPLE_WEAPON_IDS.has(item.id) ? 'simple' : 'martial';
}

/** Тип брони предмета: light/medium/heavy/shield или null (не броня). */
export function armorTypeOf(item: Item): ArmorProficiency | null {
  if (item.category !== 'armor') return null;
  if (item.isShield ?? item.id === 'shield') return 'shield';
  if (item.armorType) return item.armorType;
  const base = item.armorClassBase ?? 0;
  if (base <= 0) return null; // мантии и прочее без КД — не броня
  if (base <= 12) return 'light';
  if (base <= 14) return 'medium';
  return 'heavy';
}

/** Оружие со свойством «двуручное» — занимает обе руки. */
export function isTwoHanded(item: Item): boolean {
  return (item.properties ?? []).some((p) => /двуруч|two-?handed/i.test(p));
}

/** Щит — по типу брони. */
export function isShieldItem(item: Item): boolean {
  return armorTypeOf(item) === 'shield';
}

/** Наручная броня (не щит) — носится одна. */
export function isBodyArmor(item: Item): boolean {
  const t = armorTypeOf(item);
  return t !== null && t !== 'shield';
}

export interface EquipCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Можно ли экипировать предмет при текущем инвентаре (D&D: две руки,
 * одна наручная броня, один щит).
 */
export function canEquip(
  item: Item,
  inventory: { itemId: string; equipped: boolean }[],
  itemById: Map<string, Item>,
): EquipCheck {
  // Надеваемое: оружие, броня, щиты и магические предметы.
  const wearable = item.category === 'weapon' || item.category === 'armor' || item.magic === true;
  if (!wearable) return { ok: true };

  const equipped = inventory
    .filter((e) => e.equipped && e.itemId !== item.id)
    .map((e) => itemById.get(e.itemId))
    .filter((i): i is Item => !!i);

  // Наручная броня — строго одна
  if (isBodyArmor(item) && equipped.some(isBodyArmor)) {
    return { ok: false, reason: 'Уже надета другая броня' };
  }
  // Щит — один
  if (isShieldItem(item) && equipped.some(isShieldItem)) {
    return { ok: false, reason: 'Уже экипирован другой щит' };
  }

  // Руки: одноручное оружие и щит занимают по одной, двуручное — обе
  const handCost = (i: Item): number =>
    i.category === 'weapon' ? (isTwoHanded(i) ? 2 : 1) : isShieldItem(i) ? 1 : 0;
  const usedHands = equipped.reduce((sum, i) => sum + handCost(i), 0);
  const cost = handCost(item);
  if (cost > 0 && usedHands + cost > 2) {
    return {
      ok: false,
      reason: 'Не хватает рук: сначала снимите лишнее оружие или щит',
    };
  }
  return { ok: true };
}

/** Сколько рук сейчас занято экипировкой (для отображения). */
export function usedHands(
  inventory: { itemId: string; equipped: boolean }[],
  itemById: Map<string, Item>,
): number {
  return inventory
    .filter((e) => e.equipped)
    .map((e) => itemById.get(e.itemId))
    .filter((i): i is Item => !!i)
    .reduce((sum, i) => {
      if (i.category === 'weapon') return sum + (isTwoHanded(i) ? 2 : 1);
      if (isShieldItem(i)) return sum + 1;
      return sum;
    }, 0);
}

function classWeaponProfs(cls: CharacterClass | undefined): { categories: WeaponCategory[]; itemIds: string[] } {
  if (cls?.weaponProficiencies) return cls.weaponProficiencies;
  const def = cls ? CLASS_PROFICIENCIES[cls.id] : undefined;
  // Класс неизвестен и явного поля нет — не блокируем экипировку
  return def?.weapons ?? { categories: ALL_WEAPON_CATS, itemIds: [] };
}

function classArmorProfs(cls: CharacterClass | undefined): ArmorProficiency[] {
  if (cls?.armorProficiencies) return cls.armorProficiencies;
  const def = cls ? CLASS_PROFICIENCIES[cls.id] : undefined;
  return def?.armor ?? ALL_ARMOR_TYPES;
}

/** Владеет ли персонаж предметом (по классам персонажа).
 *  Оружие: по категории или по конкретному предмету. Броня/щит: по типу.
 *  Не оружие и не броня — владение не требуется. */
export function isProficientWith(
  character: Pick<Character, 'classes'>,
  item: Item,
  classesById: Map<string, CharacterClass>,
): boolean {
  if (item.category === 'weapon') {
    return character.classes.some((cl) => {
      const profs = classWeaponProfs(classesById.get(cl.classId));
      return profs.itemIds.includes(item.id) || profs.categories.includes(weaponCategoryOf(item));
    });
  }
  const armorType = armorTypeOf(item);
  if (armorType) {
    return character.classes.some((cl) =>
      classArmorProfs(classesById.get(cl.classId)).includes(armorType));
  }
  return true;
}


// ─── Боевой движок (ROADMAP, шаг 2) ─────────────────────────────────────────
// Все броски делает сервер. Функции чистые и принимают rng — сценарии-проверки
// воспроизводят конкретные исходы (крит, промах, успех/провал спасброска).

/** Генератор случайного числа в [0, 1). */
export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/** rng с заданной последовательностью; после её исчерпания — Math.random. */
export function sequenceRng(values: number[]): Rng {
  let i = 0;
  return () => (i < values.length ? values[i++]! : Math.random());
}

/** Одна кость d{sides}. */
export function rollDie(sides: number, rng: Rng = defaultRng): number {
  const v = Math.min(0.999999, Math.max(0, rng()));
  return 1 + Math.floor(v * sides);
}

// ─── Урон ───────────────────────────────────────────────────────────────────

export interface DamageRollResult {
  dice: string;   // фактическое число костей: "16d6" на крите
  rolls: number[];
  bonus: number;
  total: number;
}

/**
 * Бросок урона/лечения по формуле "2d6+3". На крите удваивается ЧИСЛО костей;
 * модификатор не удваивается (правила 2024).
 */
export function rollDamageFormula(
  formula: string,
  crit = false,
  rng: Rng = defaultRng,
): DamageRollResult {
  const m = DICE_RE.exec(formula.replace(/\s/g, ''));
  if (!m) throw new Error(`Некорректная формула урона: ${formula}`);
  const count = Number(m[1] ?? 1);
  const sides = Number(m[2]);
  const bonus = Number(m[3] ?? 0);
  const dieCount = crit ? count * 2 : count;
  const rolls = Array.from({ length: dieCount }, () => rollDie(sides, rng));
  const total = Math.max(0, rolls.reduce((a, b) => a + b, 0) + bonus);
  return { dice: `${dieCount}d${sides}`, rolls, bonus, total };
}

// ─── Атака ──────────────────────────────────────────────────────────────────

export interface AttackResolution {
  roll: CombatAttackRoll;
  damage: DamageRollResult;
  damageType?: string;
}

/**
 * Бросок атаки: d20 + бонус против КД. Натуральная 20 — автопопадание и
 * двойные кости урона, натуральная 1 — автопромах (у обеих сторон).
 * При промахе damage.total === 0 (кости всё же видны в логе).
 */
export function resolveAttack(
  attackBonus: number,
  targetAc: number,
  damageFormula: string,
  damageType?: string,
  rng: Rng = defaultRng,
): AttackResolution {
  const d20 = rollDie(20, rng);
  const crit = d20 === 20;
  const fumble = d20 === 1;
  const total = d20 + attackBonus;
  const hit = crit || (!fumble && total >= targetAc);
  const damage = rollDamageFormula(damageFormula, crit, rng);
  return {
    roll: { d20, bonus: attackBonus, total, ac: targetAc, hit, crit, fumble },
    damage: hit ? damage : { ...damage, total: 0 },
    damageType,
  };
}

// ─── Спасброски ─────────────────────────────────────────────────────────────

export interface SaveOutcome {
  total: number;
  success: boolean;
  applied: number;
}

/**
 * Разрешение спасброска против урона: успех при total >= dc. При успехе —
 * половина урона (округление вниз), если halfOnSuccess, иначе урона нет.
 */
export function resolveSaveAgainstDamage(
  d20: number,
  bonus: number,
  dc: number,
  damageTotal: number,
  halfOnSuccess: boolean,
): SaveOutcome {
  const total = d20 + bonus;
  const success = total >= dc;
  if (!success) return { total, success, applied: damageTotal };
  return {
    total,
    success,
    applied: halfOnSuccess ? Math.floor(damageTotal / 2) : 0,
  };
}

/** Бонус спасброска персонажа: мод характеристики + владение. */
export function characterSaveBonus(character: Character, ability: Ability): number {
  const mod = abilityModifier(effectiveScores(character)[ability]);
  const prof = proficiencyBonus(characterLevel(character));
  return mod + (character.savingThrowProficiencies.includes(ability) ? prof : 0);
}

/** Бонус спасброска монстра: явный из savingThrows либо мод характеристики. */
export function monsterSaveBonus(monster: Monster, ability: Ability): number {
  const explicit = monster.savingThrows?.[ability];
  if (typeof explicit === 'number') return explicit;
  return abilityModifier(monster.abilities[ability] ?? 10);
}

/**
 * Авто-спас концентрации при получении урона: СЛ = max(10, половина урона).
 * Провал — концентрация снимается (решение ROADMAP, шаг 2).
 */
export function resolveConcentrationSave(
  character: Character,
  damage: number,
  rng: Rng = defaultRng,
): { dc: number; d20: number; bonus: number; success: boolean } {
  const dc = concentrationDC(damage);
  const bonus = characterSaveBonus(character, 'con');
  const d20 = rollDie(20, rng);
  return { dc, d20, bonus, success: d20 + bonus >= dc };
}

// ─── КД персонажа ───────────────────────────────────────────────────────────

/** КД персонажа: надетая броня + щит (+2) + Ловкость по правилам брони. */
export function characterArmorClass(
  character: Character,
  itemById: Map<string, Item>,
): number {
  const dexMod = abilityModifier(effectiveScores(character).dex);
  const equipped = character.inventory
    .filter((e) => e.equipped)
    .map((e) => itemById.get(e.itemId))
    .filter((i): i is Item => Boolean(i));

  const bodyArmor = equipped.find((i) => {
    const t = armorTypeOf(i);
    return t !== null && t !== 'shield';
  });
  let ac = 10 + dexMod;
  if (bodyArmor?.armorClassBase != null) {
    const dexPart = bodyArmor.addDexToAC
      ? Math.min(dexMod, bodyArmor.maxDexBonus ?? dexMod)
      : 0;
    ac = bodyArmor.armorClassBase + dexPart;
  }
  if (equipped.some(isShieldItem)) ac += 2;
  return ac;
}

// ─── Заклинательные характеристики ──────────────────────────────────────────

export interface SpellcastingInfo {
  ability: Ability;
  score: number;
  dc: number;
  attackBonus: number;
  classId: string;
}

/** Заклинательная характеристика персонажа — первый класс с spellcastingAbility. */
export function characterSpellcasting(
  character: Character,
  classesById: Map<string, CharacterClass>,
): SpellcastingInfo | null {
  const cls = character.classes
    .map((c) => classesById.get(c.classId))
    .find((c): c is CharacterClass => Boolean(c?.spellcastingAbility));
  if (!cls?.spellcastingAbility) return null;
  const level = characterLevel(character);
  const score = effectiveScores(character)[cls.spellcastingAbility];
  return {
    ability: cls.spellcastingAbility,
    score,
    dc: spellSaveDC(score, level),
    attackBonus: spellAttackBonus(score, level),
    classId: cls.id,
  };
}

// ─── Ячейки заклинаний ──────────────────────────────────────────────────────

export interface SlotCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Можно ли сотворить заклинание из ячейки slotLevel. Заговоры (level 0)
 * кастуются без ячеек — это правило движка, а не поле данных.
 */
export function canCastFromSlot(
  spell: Pick<Spell, 'level'>,
  slotLevel: number,
  slotsCurrent: number[],
): SlotCheck {
  if (spell.level === 0) return { ok: true };
  if (slotLevel < 1 || slotLevel > 9) return { ok: false, reason: 'Некорректный уровень ячейки' };
  if (slotLevel < spell.level) {
    return { ok: false, reason: `Ячейка ${slotLevel}-го уровня ниже уровня заклинания` };
  }
  if ((slotsCurrent[slotLevel - 1] ?? 0) < 1) {
    return { ok: false, reason: `Нет свободных ячеек ${slotLevel}-го уровня` };
  }
  return { ok: true };
}

/** Трата одной ячейки slotLevel; возвращает новый массив (чистая функция). */
export function spendSpellSlot(slotsCurrent: number[], slotLevel: number): number[] {
  if (slotLevel < 1) return [...slotsCurrent];
  const next = [...slotsCurrent];
  const idx = slotLevel - 1;
  next[idx] = Math.max(0, (next[idx] ?? 0) - 1);
  return next;
}

// ─── Upcast ─────────────────────────────────────────────────────────────────

const UPCAST_DICE_RE = /^\+(\d*)d(\d+)$/i;

/**
 * Костяная прибавка upcast'а за уровень ячейки выше базового.
 * null, если upcast не костяной («+1 цель», «+1 луч», «+1 дротик») —
 * такие эффекты разрешает вызывающий код, движок урона их не суммирует.
 */
export function upcastExtraDice(
  spell: Pick<Spell, 'level' | 'upcast'>,
  slotLevel: number,
): { count: number; sides: number } | null {
  const per = spell.upcast?.perSlotLevel;
  if (!per) return null;
  const m = UPCAST_DICE_RE.exec(per.trim());
  if (!m) return null;
  const levelsAbove = slotLevel - spell.level;
  if (levelsAbove <= 0) return null;
  const perLevel = m[1] ? Number(m[1]) : 1;
  return { count: perLevel * levelsAbove, sides: Number(m[2]) };
}

/**
 * Итоговая формула костей заклинания с учётом upcast'а: "8d6" + 2 уровня
 * сверху по "+1d6" → "10d6". Если стороны не совпадают с базовыми —
 * возвращается базовая формула (движок не смешивает разные кости).
 */
export function spellDamageFormula(
  spell: Pick<Spell, 'level' | 'damageDice' | 'upcast'>,
  slotLevel: number,
): string | null {
  const base = spell.damageDice;
  if (!base) return null;
  const bm = DICE_RE.exec(base.replace(/\s/g, ''));
  if (!bm) return base;
  const extra = upcastExtraDice(spell, slotLevel);
  if (!extra) return base;

  const baseCount = Number(bm[1] ?? 1);
  const baseSides = Number(bm[2]);
  const baseMod = Number(bm[3] ?? 0);
  if (extra.sides !== baseSides) return base;

  const count = baseCount + extra.count;
  const mod = baseMod ? (baseMod > 0 ? `+${baseMod}` : `${baseMod}`) : '';
  return `${count}d${baseSides}${mod}`;
}

// ─── Отдых ──────────────────────────────────────────────────────────────────

/**
 * Короткий отдых: одна кость хитов + мод Телосложения (минимум 1).
 * Восстановление ресурсов (resetOn 'short') применяет вызывающий код.
 */
export function shortRestHeal(
  character: Character,
  rng: Rng = defaultRng,
): { healed: number; hitDieRoll: number; hitDiceSpent: number } {
  if (character.hitDiceCurrent <= 0 || character.currentHp >= character.maxHp) {
    return { healed: 0, hitDieRoll: 0, hitDiceSpent: 0 };
  }
  const conMod = abilityModifier(effectiveScores(character).con);
  const hitDieRoll = rollDie(character.hitDieType, rng);
  return { healed: Math.max(1, hitDieRoll + conMod), hitDieRoll, hitDiceSpent: 1 };
}

/**
 * Число дротиков/лучей при касте из ячейки slotLevel. Базовое значение —
 * spell.projectiles (по умолчанию 1); upcast «+1 дротик»/«+1 луч» добавляет
 * по одному за каждый уровень ячейки выше базового. Прочие upcast'ы
 * («+1 цель», костяные) на число снарядов не влияют.
 */
export function spellProjectileCount(
  spell: Pick<Spell, 'level' | 'projectiles' | 'upcast'>,
  slotLevel: number,
): number {
  const base = spell.projectiles ?? 1;
  const per = spell.upcast?.perSlotLevel?.trim() ?? '';
  const levelsAbove = slotLevel - spell.level;
  if (levelsAbove <= 0) return base;
  if (!/\+1\s*(дротик|луч|снаряд)/i.test(per)) return base;
  return base + levelsAbove;
}

// ─── Валюта: кошелёк, конверсия, оплата (ROADMAP, шаг 6) ────────────────────
// Номиналы: 1 пм = 10 зм = 100 см = 1000 мм (COIN_VALUE_IN_CP в types.ts).
// Монеты ничего не весят (решение ROADMAP).

/** Стоимость в меди (мм) — единая единица для сравнения и конверсии. */
export function coinsToCp(coins: Coins): number {
  return CURRENCIES.reduce((sum, c) => sum + (coins[c] ?? 0) * COIN_VALUE_IN_CP[c], 0);
}

/** Стоимость цены (Cost) в меди. */
export function costToCp(cost: Cost): number {
  return cost.amount * COIN_VALUE_IN_CP[cost.currency];
}

/** Хватает ли кошелька на цену. */
export function canAfford(coins: Coins, cost: Cost): boolean {
  return coinsToCp(coins) >= costToCp(cost);
}

/** Положить монеты в кошелёк (чистая функция). */
export function addCoins(coins: Coins, add: Partial<Coins>): Coins {
  const out = { ...zeroCoins(), ...coins };
  for (const c of CURRENCIES) {
    out[c] = Math.max(0, Math.round((out[c] ?? 0) + (add[c] ?? 0)));
  }
  return out;
}

/**
 * Разложить сумму меди по номиналам без мелочи крупнее нужной:
 * максимально крупные монеты (сдача «наоборот» не создаётся).
 */
function cpToCoins(cp: number): Coins {
  let rest = Math.max(0, Math.round(cp));
  const out = zeroCoins();
  for (const c of ['pp', 'gp', 'sp', 'cp'] as Currency[]) {
    const v = COIN_VALUE_IN_CP[c];
    out[c] = Math.floor(rest / v);
    rest -= out[c] * v;
  }
  return out;
}

export interface PayResult {
  ok: boolean;
  coins: Coins;
  /** Сколько всего меди списано (0 при отказе). */
  paidCp: number;
  reason?: string;
}

/**
 * Заплатить цену из кошелька. Если мелких монет не хватает — автоматический
 * размен крупных: нужная сумма берётся из кошелька в меди эквиваленте,
 * остаток размена возвращается мелочью. Пример: 15 зм из «2 пм» → списывается
 * 1 пм + размен второго: 15 зм = 1500 мм, было 2000 мм → осталось 500 мм.
 */
export function pay(coins: Coins, cost: Cost): PayResult {
  const need = costToCp(cost);
  const have = coinsToCp(coins);
  if (have < need) {
    return { ok: false, coins, paidCp: 0, reason: 'Недостаточно денег' };
  }
  // простая стратегия: сначала забираем мелкие номиналы снизу вверх,
  // нехватку добираем разменом ближайшей крупной монеты
  const out = { ...zeroCoins(), ...coins };
  let remaining = need;
  for (const c of ['cp', 'sp', 'gp', 'pp'] as Currency[]) {
    if (remaining <= 0) break;
    const v = COIN_VALUE_IN_CP[c];
    const take = Math.min(out[c], Math.floor(remaining / v));
    out[c] -= take;
    remaining -= take * v;
  }
  if (remaining > 0) {
    // размен: ищем самую мелкую монету крупнее остатка
    for (const c of ['sp', 'gp', 'pp'] as Currency[]) {
      const v = COIN_VALUE_IN_CP[c];
      if (remaining > 0 && out[c] > 0 && v > remaining) {
        out[c] -= 1;
        remaining -= v; // уйдёт в минус — сдача
        // сдача мелочью ниже номинала разменянной монеты
        const change = -remaining;
        const changeCoins = cpToCoins(change);
        // размен pp даёт gp/sp/cp и т.д. — cpToCoins вернёт pp если сдача ≥1000,
        // но сдача всегда < v ≤ 1000, поэтому pp в сдаче не появится
        for (const cc of CURRENCIES) out[cc] += changeCoins[cc];
        remaining = 0;
        break;
      }
    }
  }
  if (remaining > 0) {
    // не должно случиться (have >= need), но страховка
    return { ok: false, coins, paidCp: 0, reason: 'Недостаточно денег' };
  }
  return { ok: true, coins: out, paidCp: need };
}

/** Начислить цену (продажа, лут) — сумма раскладывается по крупным номиналам. */
export function earn(coins: Coins, amount: Cost): Coins {
  return cpToCoins(coinsToCp(coins) + costToCp(amount));
}

/** Формат цены строкой по-русски: «15 зм». */
export function costText(cost?: Cost): string {
  if (!cost) return '—';
  const ru: Record<Currency, string> = { cp: 'мм', sp: 'см', gp: 'зм', pp: 'пм' };
  return `${cost.amount} ${ru[cost.currency]}`;
}

/**
 * Разобрать строку цены «15 зм» / «5 мм» / «—» в Cost | undefined.
 * Для миграции seed и старых записей предметов.
 */
export function parseCost(text: string | undefined): Cost | undefined {
  if (!text) return undefined;
  const m = /^\s*(\d+)\s*(мм|см|зм|пм)\s*$/.exec(text);
  if (!m) return undefined;
  const map: Record<string, Currency> = { 'мм': 'cp', 'см': 'sp', 'зм': 'gp', 'пм': 'pp' };
  return { amount: Number(m[1]), currency: map[m[2]!]! };
}

/** Стартовое золото класса: бросок костей × множитель (PHB 2024). */
export function rollStartingGold(cls: Pick<CharacterClass, 'startingGold'>, rng: Rng = defaultRng): number {
  const sg = cls.startingGold;
  if (!sg) return 0;
  const m = DICE_RE.exec(sg.dice.replace(/\s/g, ''));
  if (!m) return 0;
  const count = Number(m[1] ?? 1);
  const sides = Number(m[2]);
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(sides, rng);
  return total * sg.multiply;
}
