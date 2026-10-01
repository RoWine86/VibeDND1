// ─── Движок правил D&D 2024 (5.5e): модификаторы, кости, производные ────────

import type { Ability, AbilityScores, Character } from './types';

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function modifierText(score: number): string {
  const m = abilityModifier(score);
  return m >= 0 ? `+${m}` : `${m}`;
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
