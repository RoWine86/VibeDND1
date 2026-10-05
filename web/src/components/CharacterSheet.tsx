// ─── Переиспользуемая карточка персонажа ────────────────────────────────────
// Пропсы: { character, onPatch?, readonly? }. Без onPatch всё read-only.

import { useEffect, useRef, useState } from 'react';
import {
  Dices, Heart, Minus, Moon, Plus, Shield, Sparkles, Sun, Swords, Trash2,
  Zap,
} from 'lucide-react';
import {
  ABILITIES, ABILITY_NAMES_RU, CONDITION_NAMES_RU, SKILL_ABILITY, SKILL_NAMES_RU,
  abilityModifier, canEquip, characterLevel, effectiveScores, formatFormula, modifierText,
  signedText, proficiencyBonus, rollDice, isProficientWith, usedHands,
} from '@vibednd/shared';
import type {
  Ability, Character, CharacterClass, ClassResource, ConditionKey, Item,
  SkillKey, Species, Spell,
} from '@vibednd/shared';
import { api } from '../api';
import SpellCard from './SpellCard';
import CoinPurse from './CoinPurse';
import '../styles/character.css';

export interface CharacterSheetProps {
  character: Character;
  onPatch?: (patch: Partial<Character>) => void;
  /**
   * Отдых через WS-сессию (ROADMAP, шаг 2): сервер применяет отдых
   * авторитетно и рассылает его всем (доска видит). Если не задан — кнопки
   * отдыхают локально через onPatch (страница редактирования вне сессии).
   */
  onRest?: (kind: 'short' | 'long') => void;
  readonly?: boolean;
}

interface RollResult {
  key: number;
  label: string;
  total: number;
  detail: string;
}

const SKILL_KEYS = Object.keys(SKILL_NAMES_RU) as SkillKey[];
const CONDITION_KEYS = Object.keys(CONDITION_NAMES_RU) as ConditionKey[];

export default function CharacterSheet({ character, onPatch, onRest, readonly }: CharacterSheetProps) {
  const editable = !!onPatch && !readonly;
  const patch = (p: Partial<Character>) => onPatch?.(p);

  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [hpDelta, setHpDelta] = useState('');
  const [roll, setRoll] = useState<RollResult | null>(null);
  const [hpPulseKey, setHpPulseKey] = useState(0);
  const [invItemId, setInvItemId] = useState('');
  const [invQty, setInvQty] = useState(1);
  const [viewSpell, setViewSpell] = useState<Spell | null>(null);
  const prevHp = useRef(character.currentHp);

  useEffect(() => {
    Promise.all([
      api.get<CharacterClass[]>('/entities/class'),
      api.get<Species[]>('/entities/species'),
      api.get<Spell[]>('/entities/spell'),
      api.get<Item[]>('/entities/item'),
    ]).then(([c, s, sp, it]) => {
      setClasses(c); setSpecies(s); setSpells(sp); setItems(it);
    }).catch(() => { /* справочники недоступны — карточка всё равно рендерится */ });
  }, []);

  useEffect(() => {
    if (prevHp.current !== character.currentHp) {
      prevHp.current = character.currentHp;
      setHpPulseKey((k) => k + 1);
    }
  }, [character.currentHp]);

  const level = characterLevel(character);
  const prof = proficiencyBonus(level);
  const scores = effectiveScores(character);
  const clsById = new Map(classes.map((c) => [c.id, c]));
  const speciesObj = species.find((s) => s.id === character.speciesId);
  const spellById = new Map(spells.map((s) => [s.id, s]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const spellcastingClass = character.classes
    .map((c) => clsById.get(c.classId))
    .find((c) => c?.spellcastingAbility);
  const spellAbility = spellcastingClass?.spellcastingAbility;

  // ── Производные ──
  const dexMod = abilityModifier(scores.dex);
  const equippedArmor = character.inventory
    .filter((e) => e.equipped)
    .map((e) => itemById.get(e.itemId))
    .filter((i): i is Item => !!i && i.category === 'armor' && (i.armorClassBase ?? 0) > 2);
  const hasShield = character.inventory.some((e) => {
    const it = itemById.get(e.itemId);
    return e.equipped && !!it && (it.isShield ?? it.id === 'shield');
  });
  let armorClass = 10 + dexMod;
  const armor = equippedArmor[0];
  if (armor?.armorClassBase != null) {
    const dexPart = armor.addDexToAC
      ? Math.min(dexMod, armor.maxDexBonus ?? dexMod)
      : 0;
    armorClass = armor.armorClassBase + dexPart;
  }
  if (hasShield) armorClass += 2;

  const initiative = dexMod;
  const speed = speciesObj?.speed ?? 30;
  const passivePerception =
    10 + abilityModifier(scores[SKILL_ABILITY.perception])
    + (character.skillProficiencies.includes('perception') ? prof : 0);

  const classLabel = character.classes
    .map((c) => `${clsById.get(c.classId)?.nameRu ?? c.classId} ${c.level}`)
    .join(' / ') || '—';

  const allSpellIds = Array.from(new Set([...character.knownSpells, ...character.preparedSpells]));
  const concentratingSpell = character.concentratingOn
    ? spellById.get(character.concentratingOn)
    : undefined;

  // ── Броски ──
  const doRoll = (label: string, dice: string, bonus: number) => {
    const r = rollDice(formatFormula(dice, bonus));
    setRoll({
      key: Date.now(),
      label,
      total: r.total,
      detail: `[${r.rolls.join(', ')}]${r.modifier ? ` ${r.modifier > 0 ? '+' : '−'}${Math.abs(r.modifier)}` : ''}`,
    });
  };

  // ── HP ──
  const applyDamage = (amount: number) => {
    if (amount <= 0) return;
    let temp = character.tempHp;
    let cur = character.currentHp;
    const absorbed = Math.min(temp, amount);
    temp -= absorbed;
    cur = Math.max(0, cur - (amount - absorbed));
    patch({ tempHp: temp, currentHp: cur });
  };
  const applyHealing = (amount: number) => {
    if (amount <= 0) return;
    patch({ currentHp: Math.min(character.maxHp, character.currentHp + amount) });
  };

  // ── Отдых ──
  const shortRest = () => {
    if (!editable) return;
    // в сессии отдых применяет сервер (WS) и рассылает всем; вне сессии —
    // локально через onPatch (страница редактирования персонажа)
    if (onRest) {
      onRest('short');
      return;
    }
    const conMod = abilityModifier(scores.con);
    let heal = 0;
    let used = 0;
    if (character.hitDiceCurrent > 0 && character.currentHp < character.maxHp) {
      used = 1;
      heal = Math.max(1, rollDice(`1d${character.hitDieType}`).total + conMod);
    }
    patch({
      hitDiceCurrent: character.hitDiceCurrent - used,
      currentHp: Math.min(character.maxHp, character.currentHp + heal),
      resources: character.resources.map((r) =>
        r.resetOn === 'short' ? { ...r, current: r.max } : r),
    });
    if (used > 0) {
      setRoll({
        key: Date.now(),
        label: 'Кость хитов (короткий отдых)',
        total: heal,
        detail: `1к${character.hitDieType} ${signedText(conMod)}`,
      });
    }
  };
  const longRest = () => {
    if (!editable) return;
    if (onRest) {
      onRest('long');
      return;
    }
    patch({
      currentHp: character.maxHp,
      tempHp: 0,
      hitDiceCurrent: character.hitDiceTotal,
      spellSlotsCurrent: [...character.spellSlotsMax],
      resources: character.resources.map((r) => ({ ...r, current: r.max })),
      deathSaves: { successes: 0, failures: 0 },
    });
  };

  // ── Навыки и спасброски ──
  const skillBonus = (sk: SkillKey) => {
    const base = abilityModifier(scores[SKILL_ABILITY[sk]]);
    if (character.expertise.includes(sk)) return base + prof * 2;
    if (character.skillProficiencies.includes(sk)) return base + prof;
    return base;
  };
  const saveBonus = (ab: Ability) =>
    abilityModifier(scores[ab]) + (character.savingThrowProficiencies.includes(ab) ? prof : 0);

  // ── Ячейки заклинаний ──
  const toggleSlot = (lvlIdx: number, pipIdx: number) => {
    if (!editable) return;
    const current = [...character.spellSlotsCurrent];
    const cur = current[lvlIdx] ?? 0;
    // Клик по заполненной ячейке тратит её (и все правее), по пустой — восстанавливает
    current[lvlIdx] = pipIdx < cur ? pipIdx : Math.min(character.spellSlotsMax[lvlIdx] ?? 0, pipIdx + 1);
    patch({ spellSlotsCurrent: current });
  };

  // ── Снаряжение ──
  const addItem = () => {
    if (!editable || !invItemId) return;
    const existing = character.inventory.find((e) => e.itemId === invItemId);
    const inventory = existing
      ? character.inventory.map((e) =>
          e.itemId === invItemId ? { ...e, quantity: e.quantity + invQty } : e)
      : [...character.inventory, { itemId: invItemId, quantity: invQty, equipped: false }];
    patch({ inventory });
    setInvItemId('');
    setInvQty(1);
  };

  const attunedItems = character.attunedItemIds
    .map((id) => itemById.get(id))
    .filter((i): i is Item => !!i);

  // Настраиваться можно только на экипированные предметы, требующие настройки
  const attunableItems = character.inventory
    .filter((e) => e.equipped)
    .map((e) => itemById.get(e.itemId))
    .filter((i): i is Item => !!i && !!i.requiresAttunement);

  const hpPct = character.maxHp > 0 ? (character.currentHp / character.maxHp) * 100 : 0;
  const hpState = hpPct <= 25 ? 'crit' : hpPct <= 50 ? 'hurt' : '';

  return (
    <div className="anim-fade-in">
      {/* ── Шапка ── */}
      <div className="sheet-head">
        <div className="sheet-portrait">
          {character.portraitPath
            ? <img src={character.portraitPath} alt={character.name} />
            : <Shield size={36} />}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>
            {character.name}
            {editable ? (
              <button
                className={`insp-badge${character.inspiration ? ' on' : ''}`}
                onClick={() => patch({ inspiration: !character.inspiration })}
                title="Героическое вдохновение"
              >
                <Sparkles size={13} /> Вдохновение
              </button>
            ) : (
              character.inspiration && (
                <span className="insp-badge on"><Sparkles size={13} /> Вдохновение</span>
              )
            )}
          </h1>
          <div className="sh-sub">
            Игрок: {character.playerName || '—'} · {speciesObj?.nameRu ?? '—'} · {classLabel}
            {' '}· Уровень {level} · БМ {signedText(prof)}
          </div>
        </div>
      </div>

      {/* ── Характеристики ── */}
      <div className="stats-grid">
        {ABILITIES.map((ab) => (
          <div className="stat-box" key={ab}>
            <div className="st-name">{ABILITY_NAMES_RU[ab]}</div>
            <div className="st-mod">{modifierText(scores[ab])}</div>
            <div className="st-score">{scores[ab]}</div>
            <button
              className="st-roll"
              onClick={() => doRoll(`Проверка: ${ABILITY_NAMES_RU[ab]}`, '1d20', abilityModifier(scores[ab]))}
              title="Проверка характеристики"
            >
              <Dices size={11} /> к20
            </button>
          </div>
        ))}
      </div>

      {/* ── Производные ── */}
      <div className="derived-row">
        <div className="derived-box">
          <div className="db-label">КД</div>
          <div className="db-value">{armorClass}</div>
        </div>
        <div className="derived-box">
          <div className="db-label">Инициатива</div>
          <div className="db-value">{signedText(initiative)}</div>
        </div>
        <div className="derived-box">
          <div className="db-label">Скорость</div>
          <div className="db-value">{speed} фт</div>
        </div>
        <div className="derived-box">
          <div className="db-label">Кость хитов</div>
          <div className="db-value">{character.hitDiceCurrent}/{character.hitDiceTotal} к{character.hitDieType}</div>
        </div>
        <div className="derived-box">
          <div className="db-label">Пасс. восприятие</div>
          <div className="db-value">{passivePerception}</div>
        </div>
        {spellAbility && (
          <div className="derived-box">
            <div className="db-label">СЛ заклинаний</div>
            <div className="db-value">
              {8 + prof + abilityModifier(scores[spellAbility])}
            </div>
          </div>
        )}
      </div>

      {/* ── Ожидающий подтверждения бросок хитов ── */}
      {character.pendingHpGain && (
        <div className="sheet-section pending-hp">
          <h3><Dices size={15} /> Бросок хитов: {character.pendingHpGain.roll}</h3>
          <p className="small" style={{ margin: '0 0 6px' }}>
            Повышение уровня: {clsById.get(character.pendingHpGain.classId)?.nameRu ?? character.pendingHpGain.classId},
            уровень {character.pendingHpGain.level} — <b>ожидает подтверждения мастера</b>.
            Прирост хитов будет применён после подтверждения.
          </p>
        </div>
      )}

      {/* ── HP ── */}
      <div className="sheet-section">
        <h3><Heart size={15} /> Хиты</h3>
        <div className="hp-block">
          <div key={hpPulseKey} className={`hp-main${hpPulseKey > 0 ? ' anim-pulse-hp' : ''}`}>
            <div className="hp-nums">
              <span className={`hp-cur ${hpState}`}>{character.currentHp}</span>
              <span className="hp-max"> / {character.maxHp}</span>
            </div>
            <div className={`hp-bar ${hpState}`}>
              <div style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }} />
            </div>
            {editable && (
              <div className="hp-btns">
                <input
                  type="number"
                  min={0}
                  value={hpDelta}
                  placeholder="число"
                  onChange={(e) => setHpDelta(e.target.value)}
                />
                <button onClick={() => { applyHealing(Number(hpDelta) || 1); setHpDelta(''); }}>
                  <Plus size={14} /> Лечение
                </button>
                <button className="danger" onClick={() => { applyDamage(Number(hpDelta) || 1); setHpDelta(''); }}>
                  <Minus size={14} /> Урон
                </button>
              </div>
            )}
          </div>
          <div className="hp-temp">
            Временные хиты: <b>{character.tempHp}</b>
            {editable && (
              <>
                <button onClick={() => patch({ tempHp: Math.max(0, character.tempHp - 1) })}><Minus size={12} /></button>
                <button onClick={() => patch({ tempHp: character.tempHp + 1 })}><Plus size={12} /></button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Отдых ── */}
      {editable && (
        <div className="rest-bar">
          <button onClick={shortRest} disabled={character.hitDiceCurrent <= 0}>
            <Sun size={15} /> Короткий отдых
          </button>
          <button onClick={longRest}>
            <Moon size={15} /> Длинный отдых
          </button>
          {character.hitDiceCurrent <= 0 && (
            <span className="muted small" style={{ alignSelf: 'center' }}>
              Кости хитов закончились — восстановятся после длинного отдыха
            </span>
          )}
        </div>
      )}

      {/* ── Спасброски и навыки ── */}
      <div className="sheet-section">
        <h3><Dices size={15} /> Спасброски и навыки</h3>
        <div className="two-col">
          <div className="check-list">
            {ABILITIES.map((ab) => {
              const profSt = character.savingThrowProficiencies.includes(ab);
              return (
                <button
                  key={ab}
                  className={`check-item${profSt ? ' prof' : ''}`}
                  onClick={() => doRoll(`Спасбросок: ${ABILITY_NAMES_RU[ab]}`, '1d20', saveBonus(ab))}
                >
                  <span className="dot" />
                  <span className="ci-name">{ABILITY_NAMES_RU[ab]}</span>
                  <span className="ci-bonus">{signedText(saveBonus(ab))}</span>
                </button>
              );
            })}
          </div>
          <div className="check-list">
            {SKILL_KEYS.map((sk) => {
              const profSk = character.skillProficiencies.includes(sk);
              const exp = character.expertise.includes(sk);
              return (
                <button
                  key={sk}
                  className={`check-item${profSk ? ' prof' : ''}`}
                  onClick={() => doRoll(`Проверка: ${SKILL_NAMES_RU[sk]}`, '1d20', skillBonus(sk))}
                  title={exp ? 'Компетентность: двойной бонус мастерства' : ABILITY_NAMES_RU[SKILL_ABILITY[sk]]}
                >
                  <span className="dot" />
                  <span className="ci-name">{SKILL_NAMES_RU[sk]}{exp ? ' ★' : ''}</span>
                  <span className="ci-bonus">{signedText(skillBonus(sk))}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Атаки ── */}
      {character.attacks.length > 0 && (
        <div className="sheet-section">
          <h3><Swords size={15} /> Атаки</h3>
          {character.attacks.map((atk, i) => (
            <div className="atk-row" key={`${atk.name}-${i}`}>
              <span className="atk-name">{atk.name}</span>
              <span className="atk-meta">
                {formatFormula(atk.damageDice, atk.damageBonus)} {atk.damageType}
              </span>
              <button onClick={() => doRoll(`Атака: ${atk.name}`, '1d20', atk.attackBonus)}>
                <Dices size={13} /> {signedText(atk.attackBonus)}
              </button>
              <button onClick={() => doRoll(`Урон: ${atk.name}`, atk.damageDice, atk.damageBonus)}>
                <Zap size={13} /> Урон
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Заклинания ── */}
      {(allSpellIds.length > 0 || character.spellSlotsMax.some((n) => n > 0)) && (
        <div className="sheet-section">
          <h3><Sparkles size={15} /> Заклинания</h3>
          {character.spellSlotsMax.map((max, idx) => {
            if (max <= 0) return null;
            const cur = character.spellSlotsCurrent[idx] ?? 0;
            return (
              <div className="slot-row" key={idx}>
                <span className="slot-lvl">Ячейки {idx + 1} ур.</span>
                <span className="slot-pips">
                  {Array.from({ length: max }, (_, p) => (
                    <button
                      key={p}
                      className={`slot-pip${p < cur ? ' full' : ''}`}
                      disabled={!editable}
                      onClick={() => toggleSlot(idx, p)}
                      title={p < cur ? 'Потратить ячейку' : 'Восстановить ячейку'}
                    />
                  ))}
                </span>
                <span className="muted small">{cur}/{max}</span>
              </div>
            );
          })}
          {concentratingSpell && (
            <div className="muted small" style={{ margin: '6px 0' }}>
              Концентрация: {concentratingSpell.nameRu}
              {editable && (
                <button
                  style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                  onClick={() => patch({ concentratingOn: undefined })}
                >
                  Сбросить
                </button>
              )}
            </div>
          )}
          <div className="spell-tags">
            {allSpellIds.map((id) => {
              const sp = spellById.get(id);
              const isConc = character.concentratingOn === id;
              return (
                <span key={id} className={`spell-tag${isConc ? ' conc' : ''}`}>
                  {sp ? (
                    <button className="st-name" title="Показать заклинание" onClick={() => setViewSpell(sp)}>
                      {sp.nameRu}
                    </button>
                  ) : (
                    id
                  )}
                  {sp && <span className="st-lvl">{sp.level === 0 ? 'заговор' : `${sp.level} ур.`}</span>}
                  {editable && sp?.concentration && !isConc && (
                    <button
                      title="Начать концентрацию"
                      style={{ color: 'var(--gold)' }}
                      onClick={() => patch({ concentratingOn: id })}
                    >
                      <Zap size={12} />
                    </button>
                  )}
                  {editable && (
                    <button
                      title="Убрать заклинание"
                      onClick={() => patch({
                        knownSpells: character.knownSpells.filter((s) => s !== id),
                        preparedSpells: character.preparedSpells.filter((s) => s !== id),
                        concentratingOn: character.concentratingOn === id ? undefined : character.concentratingOn,
                      })}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ресурсы класса ── */}
      {character.resources.length > 0 && (
        <div className="sheet-section">
          <h3><Zap size={15} /> Ресурсы класса</h3>
          {character.resources.map((r: ClassResource) => (
            <div className="res-row" key={r.id}>
              <span className="res-name">{r.name}</span>
              <span className="res-val">{r.current}/{r.max}</span>
              {editable && (
                <>
                  <button onClick={() => patch({
                    resources: character.resources.map((x) =>
                      x.id === r.id ? { ...x, current: Math.max(0, x.current - 1) } : x),
                  })}><Minus size={12} /></button>
                  <button onClick={() => patch({
                    resources: character.resources.map((x) =>
                      x.id === r.id ? { ...x, current: Math.min(x.max, x.current + 1) } : x),
                  })}><Plus size={12} /></button>
                </>
              )}
              <span className="res-reset">
                {r.resetOn === 'short' ? 'короткий отдых' : 'длинный отдых'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Состояния ── */}
      <div className="sheet-section">
        <h3>Состояния</h3>
        <div className="cond-grid">
          {CONDITION_KEYS.map((ck) => {
            const on = character.conditions.includes(ck);
            if (!editable) return on
              ? <span key={ck} className="cond-chip on">{CONDITION_NAMES_RU[ck]}</span>
              : null;
            return (
              <button
                key={ck}
                className={`cond-chip${on ? ' on' : ''}`}
                onClick={() => patch({
                  conditions: on
                    ? character.conditions.filter((c) => c !== ck)
                    : [...character.conditions, ck],
                })}
              >
                {CONDITION_NAMES_RU[ck]}
              </button>
            );
          })}
          {!editable && character.conditions.length === 0 && (
            <span className="muted small">Состояний нет</span>
          )}
        </div>
      </div>

      {/* ── Настройка на магические предметы (3 слота) ── */}
      <div className="sheet-section">
        <h3><Sparkles size={15} /> Настройка на магические предметы ({character.attunedItemIds.length}/3)</h3>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Персонаж может быть настроен не более чем на 3 магических предмета. Настроиться
          можно только на экипированный предмет, требующий настройки.
        </p>
        <div className="attune-slots">
          {[0, 1, 2].map((slot) => {
            const item = attunedItems[slot];
            return (
              <div key={slot} className={`attune-slot${item ? ' filled' : ''}`}>
                {item ? (
                  <>
                    <Sparkles size={12} /> {item.nameRu}
                    {editable && (
                      <button
                        title="Снять настройку"
                        style={{ marginLeft: 8, padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--hp-red)' }}
                        onClick={() => patch({
                          attunedItemIds: character.attunedItemIds.filter((id) => id !== item.id),
                        })}
                      >
                        <Trash2 size={12} /> Снять
                      </button>
                    )}
                  </>
                ) : (
                  'Пустой слот'
                )}
              </div>
            );
          })}
        </div>
        {editable && character.attunedItemIds.length < 3 && (
          attunableItems.length > 0 ? (
            <div className="inv-add">
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && !character.attunedItemIds.includes(id)) {
                    patch({ attunedItemIds: [...character.attunedItemIds, id] });
                  }
                }}
              >
                <option value="">Настроиться на экипированный предмет…</option>
                {attunableItems
                  .filter((i) => !character.attunedItemIds.includes(i.id))
                  .map((i) => <option key={i.id} value={i.id}>{i.nameRu}</option>)}
              </select>
            </div>
          ) : (
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              Нет экипированных предметов, требующих настройки.
            </p>
          )
        )}
      </div>

      {/* ── Кошелёк ── */}
      <div className="sheet-section">
        <h3>Кошелёк</h3>
        <CoinPurse
          coins={character.coins}
          editable={editable}
          onChange={(coins) => patch({ coins })}
        />
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          1 пм = 10 зм = 100 см = 1000 мм. Монеты ничего не весят.
        </p>
      </div>

      {/* ── Снаряжение ── */}
      <div className="sheet-section">
        <h3>Снаряжение</h3>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Руки заняты: {usedHands(character.inventory, itemById)}/2 (одноручное оружие и щит — по руке, двуручное — обе).
        </p>
        {character.inventory.length === 0 && <p className="muted small">Пусто</p>}
        {character.inventory.map((entry) => {
          const item = itemById.get(entry.itemId);
          const needsProf = !!item && (item.category === 'weapon' || item.category === 'armor');
          const proficient = !needsProf || !item
            ? true
            : isProficientWith(character, item, clsById);
          // Блокировка: нет владения ИЛИ не хватает рук/слота брони
          const equipCheck = !entry.equipped && item
            ? canEquip(item, character.inventory, itemById)
            : { ok: true } as const;
          const profBlocked = !entry.equipped && needsProf && !proficient;
          const equipBlocked = profBlocked || !equipCheck.ok;
          const blockedTitle = profBlocked
            ? 'Нельзя экипировать: нет владения этим предметом'
            : !equipCheck.ok
              ? equipCheck.reason
              : undefined;
          return (
            <div className="inv-row" key={entry.itemId}>
              <span className="inv-name">{item?.nameRu ?? entry.itemId}</span>
              {item?.requiresAttunement && (
                <span className={`inv-eq${character.attunedItemIds.includes(item.id) ? '' : ' dim'}`}>
                  {character.attunedItemIds.includes(item.id) ? 'настроен' : 'требует настройки'}
                </span>
              )}
              {entry.equipped && <span className="inv-eq">экипировано</span>}
              {needsProf && !proficient && (
                <span className="inv-noprof" title="У классов персонажа нет владения этим предметом">
                  нет владения
                </span>
              )}
              <span className="inv-qty">×{entry.quantity}</span>
              {editable && (
                <>
                  <button
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    disabled={equipBlocked}
                    title={blockedTitle}
                    onClick={() => patch({
                      inventory: character.inventory.map((e) =>
                        e.itemId === entry.itemId ? { ...e, equipped: !e.equipped } : e),
                    })}
                  >
                    {entry.equipped ? 'Снять' : 'Экипировать'}
                  </button>
                  <button
                    style={{ padding: '2px 8px', fontSize: 12, color: 'var(--hp-red)' }}
                    onClick={() => patch({
                      inventory: character.inventory
                        .map((e) => e.itemId === entry.itemId
                          ? { ...e, quantity: e.quantity - 1 }
                          : e)
                        .filter((e) => e.quantity > 0),
                    })}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          );
        })}
        {editable && (
          <div className="inv-add">
            <select value={invItemId} onChange={(e) => setInvItemId(e.target.value)}>
              <option value="">Добавить предмет…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.nameRu}</option>)}
            </select>
            <input
              type="number"
              min={1}
              value={invQty}
              onChange={(e) => setInvQty(Math.max(1, Number(e.target.value) || 1))}
            />
            <button onClick={addItem} disabled={!invItemId}><Plus size={14} /></button>
          </div>
        )}
      </div>

      {/* ── Спасброски от смерти ── */}
      <div className="sheet-section">
        <h3>Спасброски от смерти</h3>
        <div className="death-pips">
          <span className="dp-group">
            <span className="muted small">Успехи:</span>
            {[0, 1, 2].map((i) => (
              <button
                key={`s${i}`}
                className={`death-pip${i < character.deathSaves.successes ? ' ok' : ''}`}
                disabled={!editable}
                onClick={() => patch({
                  deathSaves: { ...character.deathSaves, successes: i < character.deathSaves.successes ? i : i + 1 },
                })}
              />
            ))}
          </span>
          <span className="dp-group">
            <span className="muted small">Провалы:</span>
            {[0, 1, 2].map((i) => (
              <button
                key={`f${i}`}
                className={`death-pip${i < character.deathSaves.failures ? ' fail' : ''}`}
                disabled={!editable}
                onClick={() => patch({
                  deathSaves: { ...character.deathSaves, failures: i < character.deathSaves.failures ? i : i + 1 },
                })}
              />
            ))}
          </span>
          {editable && (character.deathSaves.successes > 0 || character.deathSaves.failures > 0) && (
            <button
              style={{ padding: '3px 10px', fontSize: 12 }}
              onClick={() => patch({ deathSaves: { successes: 0, failures: 0 } })}
            >
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* ── Результат броска ── */}
      {roll && (
        <div key={roll.key} className="roll-result anim-dice-pop">
          <Dices size={18} />
          <span className="rr-label">{roll.label}</span>
          <span className="rr-total">{roll.total}</span>
          <span className="rr-detail">{roll.detail}</span>
        </div>
      )}

      {/* ── Заметки ── */}
      {(character.notes || editable) && (
        <div className="sheet-section" style={{ marginTop: 14 }}>
          <h3>Заметки</h3>
          {editable ? (
            <textarea
              rows={3}
              style={{ width: '100%' }}
              value={character.notes}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          ) : (
            <p className="small">{character.notes}</p>
          )}
        </div>
      )}

      {/* Умения классов (справочно) */}
      {character.classes.length > 0 && classes.length > 0 && (
        <div className="sheet-section" style={{ marginTop: 14 }}>
          <h3>Умения класса</h3>
          {character.classes.map((cl) => {
            const cls = clsById.get(cl.classId);
            if (!cls) return null;
            const feats = cls.features.filter((f) => f.level <= cl.level);
            return (
              <div key={cl.classId} style={{ marginBottom: 8 }}>
                <div className="small" style={{ color: 'var(--gold-bright)', fontWeight: 600 }}>
                  {cls.nameRu}
                </div>
                <ul className="small muted" style={{ paddingLeft: 18 }}>
                  {feats.map((f) => (
                    <li key={`${f.level}-${f.name}`}>
                      <FeatureLine level={f.level} name={f.name} description={f.description} />
                    </li>
                  ))}
                  {feats.length === 0 && <li>Нет данных об умениях</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {viewSpell && <SpellCard spell={viewSpell} onClose={() => setViewSpell(null)} />}
    </div>
  );
}

// ─── Умение класса: название + раскрытие описания по клику ──────────────────

function FeatureLine({ level, name, description }: { level: number; name: string; description: string }) {
  const [open, setOpen] = useState(false);
  const hasDesc = description.trim().length > 0;
  return (
    <>
      {hasDesc ? (
        <button className="feature-toggle" onClick={() => setOpen((v) => !v)}>
          {level} ур. — {name} <span className="feature-caret">{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <>{level} ур. — {name}</>
      )}
      {open && hasDesc && (
        <div className="feature-desc anim-fade-in">{description}</div>
      )}
    </>
  );
}
