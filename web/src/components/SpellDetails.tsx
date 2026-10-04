// ─── Красивый просмотр заклинания ────────────────────────────────────────────
// Переиспользуемый блок: библиотека сущностей, лист персонажа, визарды
// создания/повышения уровня, телефонный экран игрока.

import type { Spell, SpellSchool } from '@vibednd/shared';

export const SPELL_SCHOOL_NAMES_RU: Record<SpellSchool, string> = {
  abjuration: 'Ограждение',
  conjuration: 'Вызов',
  divination: 'Прорицание',
  enchantment: 'Очарование',
  evocation: 'Воплощение',
  illusion: 'Иллюзия',
  necromancy: 'Некромантия',
  transmutation: 'Преобразование',
};

export const spellLevelText = (lvl: number) => (lvl === 0 ? 'Заговор' : `${lvl} уровень`);
export const spellLevelShort = (lvl: number) => (lvl === 0 ? 'заговор' : `${lvl} ур.`);

const EFFECT_TYPE_RU: Record<NonNullable<Spell['effectType']>, string> = {
  attack: 'Атака заклинанием',
  save: 'Спасбросок',
  utility: 'Служебное',
};

/** Краткая сводка оцифровки боевого движка (что бросаем, какой урон). */
export function spellCombatSummary(spell: Spell): string | null {
  const bits: string[] = [];
  if (spell.heals && spell.damageDice) bits.push(`Лечение ${spell.damageDice}`);
  else if (spell.damageDice) {
    bits.push(`${spell.damageDice}${spell.damageType ? ` ${spell.damageType}` : ''}`.trim());
  }
  if (spell.effectType === 'attack') bits.push(spell.autoHit ? 'автопопадание' : 'атака заклинанием');
  if (spell.effectType === 'save' && spell.saveAbility) {
    const AB_RU: Record<string, string> = {
      str: 'Сил', dex: 'Лов', con: 'Тел', int: 'Инт', wis: 'Мдр', cha: 'Хар',
    };
    bits.push(`спас ${AB_RU[spell.saveAbility] ?? spell.saveAbility}${spell.halfOnSuccess ? ' (половина)' : ''}`);
  }
  if (spell.upcast) bits.push(`upcast: ${spell.upcast.perSlotLevel}`);
  if (bits.length === 0) return spell.effectType ? EFFECT_TYPE_RU[spell.effectType] : null;
  return bits.join(' · ');
}

export default function SpellDetails({
  spell,
  classNames,
  showHeader = true,
}: {
  spell: Spell;
  classNames?: string[];
  showHeader?: boolean;
}) {
  const flags = [
    spell.concentration ? 'Концентрация' : '',
    spell.ritual ? 'Ритуал' : '',
  ].filter(Boolean);
  const combatSummary = spellCombatSummary(spell);
  return (
    <div className="spell-view">
      {showHeader && (
        <div className="spell-view-head">
          <div className="spell-view-name">{spell.nameRu}</div>
          {spell.nameEn && <div className="spell-view-en">{spell.nameEn}</div>}
          <div className="spell-view-sub">
            {spellLevelText(spell.level)} · {SPELL_SCHOOL_NAMES_RU[spell.school]}
          </div>
        </div>
      )}
      <div className="spell-view-kv">
        <span className="k">Время</span>
        <span>{spell.castingTime || '—'}</span>
        <span className="k">Дистанция</span>
        <span>{spell.range || '—'}</span>
        <span className="k">Компоненты</span>
        <span>{spell.components || '—'}</span>
        <span className="k">Длительность</span>
        <span>{spell.duration || '—'}</span>
      </div>
      {flags.length > 0 && (
        <div className="spell-view-badges">
          {flags.map((f) => (
            <span key={f} className="spell-badge">{f}</span>
          ))}
        </div>
      )}
      {combatSummary && (
        <div className="spell-view-combat">{combatSummary}</div>
      )}
      {spell.description && <p className="spell-view-desc">{spell.description}</p>}
      {classNames && classNames.length > 0 && (
        <div className="spell-view-classes">Доступно классам: {classNames.join(', ')}</div>
      )}
    </div>
  );
}
