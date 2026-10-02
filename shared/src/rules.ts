// ─── Движок правил D&D 2024 (5.5e): модификаторы, кости, производные ────────

import type {
  Ability, AbilityScores, ArmorProficiency, Character, CharacterClass, Item,
  WeaponCategory,
} from './types';

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
