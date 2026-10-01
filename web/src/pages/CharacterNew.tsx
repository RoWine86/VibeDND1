// ─── Мастер создания персонажа (D&D 2024), 7 шагов ──────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Dices, Minus, Plus } from 'lucide-react';
import {
  ABILITIES, ABILITY_NAMES_RU, POINT_BUY_BUDGET, POINT_BUY_COSTS, STANDARD_ARRAY,
  abilityModifier, effectiveScores, firstLevelHp, modifierText, pointBuySpent,
  proficiencyBonus,
} from '@vibednd/shared';
import type {
  Ability, AbilityScores, Background, Character, CharacterClass, Item,
  SkillKey, Species, Spell,
} from '@vibednd/shared';
import { api } from '../api';
import '../styles/wizard.css';

const STEP_NAMES = ['Имя', 'Вид', 'Класс', 'Предыстория', 'Характеристики', 'Снаряжение', 'Итог'];

interface Refs {
  species: Species[];
  classes: CharacterClass[];
  backgrounds: Background[];
  spells: Spell[];
  items: Item[];
}

export default function CharacterNew() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Шаг 1
  const [name, setName] = useState('');
  const [playerName, setPlayerName] = useState('');
  // Шаг 2
  const [speciesId, setSpeciesId] = useState('');
  // Шаг 3
  const [classId, setClassId] = useState('');
  // Шаг 4
  const [backgroundId, setBackgroundId] = useState('');
  const [bonusPlus2, setBonusPlus2] = useState<Ability | ''>('');
  const [bonusPlus1, setBonusPlus1] = useState<Ability | ''>('');
  // Шаг 5
  const [scoreMode, setScoreMode] = useState<'array' | 'buy'>('array');
  const [assignments, setAssignments] = useState<Partial<Record<Ability, number>>>({});
  const [pointBuy, setPointBuy] = useState<AbilityScores>({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  // Шаг 6
  const [chosenSpells, setChosenSpells] = useState<string[]>([]);
  const [gearChoice, setGearChoice] = useState<'equipment' | 'gold'>('equipment');

  useEffect(() => {
    Promise.all([
      api.get<Species[]>('/entities/species'),
      api.get<CharacterClass[]>('/entities/class'),
      api.get<Background[]>('/entities/background'),
      api.get<Spell[]>('/entities/spell'),
      api.get<Item[]>('/entities/item'),
    ])
      .then(([species, classes, backgrounds, spells, items]) =>
        setRefs({ species, classes, backgrounds, spells, items }))
      .catch((e: Error) => setError(`Не удалось загрузить справочники: ${e.message}`));
  }, []);

  const cls = refs?.classes.find((c) => c.id === classId);
  const bg = refs?.backgrounds.find((b) => b.id === backgroundId);
  const sp = refs?.species.find((s) => s.id === speciesId);
  const isCaster = !!cls?.spellcastingAbility;

  const baseScores = useMemo<AbilityScores>(() => {
    if (scoreMode === 'buy') return pointBuy;
    const out: Record<Ability, number> = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    for (const ab of ABILITIES) out[ab] = assignments[ab] ?? 8;
    return out;
  }, [scoreMode, pointBuy, assignments]);

  const previewChar = useMemo<Character | null>(() => {
    if (!refs || !cls) return null;
    const backgroundBonuses = bgBonusObj();
    const maxHp = firstLevelHp(cls.hitDie, effectiveScores({
      abilityScores: baseScores, backgroundBonuses,
    } as Character).con);
    const slotsMax = cls.spellSlotsByLevel?.[1] ?? [];
    return {
      id: '',
      name: name.trim(),
      playerName: playerName.trim(),
      speciesId,
      backgroundId,
      classes: [{ classId, level: 1, hpRolls: [], chosenSpells }],
      abilityScores: baseScores,
      backgroundBonuses,
      skillProficiencies: (bg?.skillProficiencies ?? []) as SkillKey[],
      expertise: [],
      savingThrowProficiencies: cls.savingThrows,
      maxHp,
      currentHp: maxHp,
      tempHp: 0,
      hitDiceTotal: 1,
      hitDiceCurrent: 1,
      hitDieType: cls.hitDie,
      spellSlotsMax: slotsMax,
      spellSlotsCurrent: [...slotsMax],
      knownSpells: chosenSpells,
      preparedSpells: chosenSpells,
      conditions: [],
      attunedItemIds: [],
      inventory: buildInventory(),
      resources: [],
      attacks: buildAttacks(),
      deathSaves: { successes: 0, failures: 0 },
      inspiration: false,
      notes: '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, cls, bg, baseScores, bonusPlus2, bonusPlus1, name, playerName, speciesId, backgroundId, classId, chosenSpells, gearChoice]);

  function buildInventory(): Character['inventory'] {
    if (!refs || gearChoice !== 'equipment') return [];
    const inv: Character['inventory'] = [];
    const note = bg?.equipment.toLowerCase() ?? '';
    if (note.includes('кинжал')) inv.push({ itemId: 'dagger', quantity: 2, equipped: false });
    return inv;
  }

  function buildAttacks(): Character['attacks'] {
    if (!refs || !cls) return [];
    const attacks: Character['attacks'] = [];
    const prof = proficiencyBonus(1);
    const eff = effectiveScores({ abilityScores: baseScores, backgroundBonuses: bgBonusObj() } as Character);
    // Простое оружие из снаряжения предыстории (кинжал) — если есть в справочнике
    const dagger = refs.items.find((i) => i.id === 'dagger');
    if (dagger?.damageDice && gearChoice === 'equipment' && (bg?.equipment.toLowerCase().includes('кинжал'))) {
      const ab = dagger.weaponAbility ?? 'str';
      const mod = abilityModifier(eff[ab]);
      attacks.push({
        name: dagger.nameRu,
        attackBonus: prof + mod,
        damageDice: dagger.damageDice,
        damageBonus: mod,
        damageType: dagger.damageType ?? '',
      });
    }
    return attacks;
  }

  function bgBonusObj(): Partial<Record<Ability, number>> {
    const out: Partial<Record<Ability, number>> = {};
    if (bonusPlus2) out[bonusPlus2] = 2;
    if (bonusPlus1) out[bonusPlus1] = (out[bonusPlus1] ?? 0) + 1;
    return out;
  }

  // ── Валидация шага ──
  const stepValid = (s: number): boolean => {
    switch (s) {
      case 0: return name.trim().length > 0 && playerName.trim().length > 0;
      case 1: return !!speciesId;
      case 2: return !!classId;
      case 3:
        if (!backgroundId || !bg) return false;
        return !!bonusPlus2 && !!bonusPlus1 && bonusPlus2 !== bonusPlus1;
      case 4:
        if (scoreMode === 'array') {
          const used = ABILITIES.map((a) => assignments[a]).filter((v): v is number => v != null);
          return used.length === 6 && new Set(used).size === 6;
        }
        return pointBuySpent(pointBuy) <= POINT_BUY_BUDGET;
      case 5: return true; // снаряжение и заклинания опциональны
      default: return true;
    }
  };

  const spent = pointBuySpent(pointBuy);
  const left = POINT_BUY_BUDGET - spent;

  const availableSpells = useMemo(() => {
    if (!refs || !cls?.spellcastingAbility) return [];
    return refs.spells.filter((sp2) => sp2.classes.includes(cls.id) && sp2.level <= 1);
  }, [refs, cls]);

  const submit = async () => {
    if (!previewChar) return;
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = { ...previewChar };
      delete body.id; // id генерирует сервер
      await api.post<Character>('/characters', body);
      navigate('/characters');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  if (!refs) {
    return (
      <div className="wiz anim-fade-in">
        <h1>Новый персонаж</h1>
        {error
          ? <div className="error-box" style={{ marginTop: 14 }}>{error}</div>
          : <p className="muted" style={{ marginTop: 14 }}>Загрузка справочников…</p>}
      </div>
    );
  }

  const effScores = effectiveScores({
    abilityScores: baseScores, backgroundBonuses: bgBonusObj(),
  } as Character);
  const passivePerception =
    10 + abilityModifier(effScores.wis)
    + (bg?.skillProficiencies.includes('perception') ? proficiencyBonus(1) : 0);
  const hpPreview = cls ? firstLevelHp(cls.hitDie, effScores.con) : 0;
  const acPreview = 10 + abilityModifier(effScores.dex);

  return (
    <div className="wiz anim-fade-in">
      <h1 style={{ marginBottom: 16 }}>Новый персонаж</h1>

      <div className="wiz-steps">
        {STEP_NAMES.map((sn, i) => (
          <div
            key={sn}
            className={`wiz-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
          >
            <span className="num">{i < step ? <Check size={11} /> : i + 1}</span>
            {sn}
          </div>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="wiz-panel">
        {/* ── Шаг 1: имя и игрок ── */}
        {step === 0 && (
          <>
            <h2>Кто ваш герой?</h2>
            <p className="wiz-hint">Имя персонажа и имя игрока за столом.</p>
            <div className="form-row">
              <div className="form-field">
                <label>Имя персонажа</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например, Бриана Тенерос"
                  autoFocus
                />
              </div>
              <div className="form-field">
                <label>Игрок</label>
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Имя игрока"
                />
              </div>
            </div>
          </>
        )}

        {/* ── Шаг 2: вид ── */}
        {step === 1 && (
          <>
            <h2>Выберите вид</h2>
            <p className="wiz-hint">Вид определяет размер, скорость и особые черты.</p>
            <div className="pick-grid">
              {refs.species.map((s) => (
                <button
                  key={s.id}
                  className={`pick-card${speciesId === s.id ? ' selected' : ''}`}
                  onClick={() => setSpeciesId(s.id)}
                >
                  <span className="pick-title">{s.nameRu}</span>
                  <span className="pick-sub">
                    {s.nameEn} · Размер {s.size === 'S' ? 'Маленький' : 'Средний'} · Скорость {s.speed} фт
                  </span>
                  <span className="pick-desc">{s.traits.map((t) => t.name).join(' · ')}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Шаг 3: класс ── */}
        {step === 2 && (
          <>
            <h2>Выберите класс (1 уровень)</h2>
            <p className="wiz-hint">Класс определяет кость хитов, спасброски и умения.</p>
            <div className="pick-grid">
              {refs.classes.map((c) => (
                <button
                  key={c.id}
                  className={`pick-card${classId === c.id ? ' selected' : ''}`}
                  onClick={() => { setClassId(c.id); setChosenSpells([]); }}
                >
                  <span className="pick-title">{c.nameRu}</span>
                  <span className="pick-sub">
                    {c.nameEn} · Кость хитов к{c.hitDie}
                    {c.spellcastingAbility ? ` · Заклинатель (${ABILITY_NAMES_RU[c.spellcastingAbility]})` : ''}
                  </span>
                  <span className="pick-desc">
                    Спасброски: {c.savingThrows.map((a) => ABILITY_NAMES_RU[a]).join(', ')}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Шаг 4: предыстория ── */}
        {step === 3 && (
          <>
            <h2>Выберите предысторию</h2>
            <p className="wiz-hint">
              Предыстория даёт навыки, черту и бонусы +2/+1 к двум из её характеристик.
            </p>
            <div className="pick-grid" style={{ marginBottom: 18 }}>
              {refs.backgrounds.map((b) => (
                <button
                  key={b.id}
                  className={`pick-card${backgroundId === b.id ? ' selected' : ''}`}
                  onClick={() => { setBackgroundId(b.id); setBonusPlus2(''); setBonusPlus1(''); }}
                >
                  <span className="pick-title">{b.nameRu}</span>
                  <span className="pick-sub">
                    Черта: {b.feat} · Характеристики: {b.abilityScoreOptions.map((a) => ABILITY_NAMES_RU[a]).join('/')}
                  </span>
                  <span className="pick-desc">{b.description}</span>
                </button>
              ))}
            </div>
            {bg && (
              <>
                <h3 style={{ fontSize: 16, marginBottom: 10 }}>
                  Бонусы характеристик: +2 и +1 (разные характеристики)
                </h3>
                <div className="form-row">
                  <div className="form-field">
                    <label>+2 к характеристике</label>
                    <select
                      value={bonusPlus2}
                      onChange={(e) => setBonusPlus2(e.target.value as Ability | '')}
                    >
                      <option value="">Выберите…</option>
                      {bg.abilityScoreOptions.map((a) => (
                        <option key={a} value={a} disabled={a === bonusPlus1}>
                          {ABILITY_NAMES_RU[a]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>+1 к характеристике</label>
                    <select
                      value={bonusPlus1}
                      onChange={(e) => setBonusPlus1(e.target.value as Ability | '')}
                    >
                      <option value="">Выберите…</option>
                      {bg.abilityScoreOptions.map((a) => (
                        <option key={a} value={a} disabled={a === bonusPlus2}>
                          {ABILITY_NAMES_RU[a]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Шаг 5: характеристики ── */}
        {step === 4 && (
          <>
            <h2>Характеристики</h2>
            <p className="wiz-hint">
              Стандартный набор — готовые значения {STANDARD_ARRAY.join(', ')}.
              Покупка очками — {POINT_BUY_BUDGET} очков, значения от 8 до 15.
            </p>
            <div className="mode-switch">
              <button
                className={scoreMode === 'array' ? 'active' : ''}
                onClick={() => setScoreMode('array')}
              >
                Стандартный набор
              </button>
              <button
                className={scoreMode === 'buy' ? 'active' : ''}
                onClick={() => setScoreMode('buy')}
              >
                Покупка очками
              </button>
            </div>

            {scoreMode === 'buy' && (
              <div className={`points-left${left < 0 ? ' over' : ''}`}>
                <Dices size={16} />
                Осталось очков: <b>{left}</b>
                <span className="muted small">из {POINT_BUY_BUDGET}</span>
              </div>
            )}

            <div className="score-grid">
              {ABILITIES.map((ab) => {
                const score = baseScores[ab];
                const bonus = bgBonusObj()[ab] ?? 0;
                if (scoreMode === 'array') {
                  const usedByOthers = new Set(
                    ABILITIES.filter((x) => x !== ab)
                      .map((x) => assignments[x])
                      .filter((v): v is number => v != null),
                  );
                  return (
                    <div className="score-box" key={ab}>
                      <span className="score-name">{ABILITY_NAMES_RU[ab]}</span>
                      <select
                        value={assignments[ab] ?? ''}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [ab]: e.target.value === '' ? undefined : Number(e.target.value),
                          }))
                        }
                      >
                        <option value="">—</option>
                        {STANDARD_ARRAY.filter((v) => !usedByOthers.has(v)).map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                      <span className="score-val">
                        {assignments[ab] != null ? assignments[ab] + bonus : '—'}
                      </span>
                      {bonus > 0 && <span className="score-bonus">предыстория +{bonus}</span>}
                    </div>
                  );
                }
                return (
                  <div className="score-box" key={ab}>
                    <span className="score-name">{ABILITY_NAMES_RU[ab]}</span>
                    <div className="stepper">
                      <button
                        onClick={() =>
                          setPointBuy((p) => ({ ...p, [ab]: Math.max(8, p[ab] - 1) }))}
                        disabled={score <= 8}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="score-val">{score + bonus}</span>
                      <button
                        onClick={() =>
                          setPointBuy((p) => ({ ...p, [ab]: Math.min(15, p[ab] + 1) }))}
                        disabled={score >= 15 || left - ((POINT_BUY_COSTS[score + 1] ?? 0) - (POINT_BUY_COSTS[score] ?? 0)) < 0}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <span className="muted small">
                      база {score} · цена {POINT_BUY_COSTS[score] ?? 0}
                    </span>
                    {bonus > 0 && <span className="score-bonus">предыстория +{bonus}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Шаг 6: снаряжение и заклинания ── */}
        {step === 5 && (
          <>
            <h2>Снаряжение{isCaster ? ' и заклинания' : ''}</h2>
            {bg && (
              <>
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>Снаряжение предыстории «{bg.nameRu}»</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  <label className="check-line">
                    <input
                      type="radio"
                      name="gear"
                      checked={gearChoice === 'equipment'}
                      onChange={() => setGearChoice('equipment')}
                    />
                    <span className="cl-detail" style={{ color: 'var(--text)', fontSize: 14 }}>
                      {bg.equipment}
                    </span>
                  </label>
                  <label className="check-line">
                    <input
                      type="radio"
                      name="gear"
                      checked={gearChoice === 'gold'}
                      onChange={() => setGearChoice('gold')}
                    />
                    <span style={{ fontSize: 14 }}>Или эквивалент золотом</span>
                  </label>
                </div>
              </>
            )}
            {isCaster && cls && (
              <>
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>
                  Заговоры и заклинания 1 уровня ({chosenSpells.length} выбрано)
                </h3>
                <p className="wiz-hint">
                  Базовая характеристика заклинаний: {ABILITY_NAMES_RU[cls.spellcastingAbility!]}.
                </p>
                <div className="spell-list">
                  {availableSpells.map((sp2) => {
                    const on = chosenSpells.includes(sp2.id);
                    return (
                      <button
                        key={sp2.id}
                        className={`spell-row${on ? ' selected' : ''}`}
                        onClick={() =>
                          setChosenSpells((prev) =>
                            on ? prev.filter((x) => x !== sp2.id) : [...prev, sp2.id])
                        }
                      >
                        <span className="sname">{sp2.nameRu}</span>
                        <span className="smeta">
                          {sp2.level === 0 ? 'Заговор' : `${sp2.level} ур.`} · {sp2.castingTime}
                          {sp2.concentration ? ' · конц.' : ''}
                        </span>
                      </button>
                    );
                  })}
                  {availableSpells.length === 0 && (
                    <p className="muted small">Для этого класса в справочнике нет заклинаний.</p>
                  )}
                </div>
              </>
            )}
            {!isCaster && (
              <p className="muted small">
                Класс «{cls?.nameRu}» не использует заклинания — можно двигаться дальше.
              </p>
            )}
          </>
        )}

        {/* ── Шаг 7: итог ── */}
        {step === 6 && previewChar && (
          <>
            <h2>Итог</h2>
            <p className="wiz-hint">Проверьте героя перед сохранением в библиотеку.</p>
            <div className="summary-block">
              <h3>{name.trim() || 'Безымянный герой'}</h3>
              <div className="kv"><span>Игрок</span><span>{playerName.trim()}</span></div>
              <div className="kv"><span>Вид</span><span>{sp?.nameRu}</span></div>
              <div className="kv"><span>Класс</span><span>{cls?.nameRu} 1 ур.</span></div>
              <div className="kv"><span>Предыстория</span><span>{bg?.nameRu}</span></div>
            </div>
            <div className="summary-block">
              <h3>Боевые показатели</h3>
              <div className="kv"><span>Хиты (к{cls?.hitDie} + Телосложение)</span><span>{hpPreview}</span></div>
              <div className="kv"><span>КД (без доспеха)</span><span>{acPreview}</span></div>
              <div className="kv"><span>Пассивное восприятие</span><span>{passivePerception}</span></div>
              <div className="kv"><span>Инициатива</span><span>{modifierText(abilityModifier(effScores.dex))}</span></div>
            </div>
            <div className="summary-block">
              <h3>Характеристики (с бонусами предыстории)</h3>
              {ABILITIES.map((ab) => (
                <div className="kv" key={ab}>
                  <span>{ABILITY_NAMES_RU[ab]}</span>
                  <span>{effScores[ab]} ({modifierText(effScores[ab])})</span>
                </div>
              ))}
            </div>
            {chosenSpells.length > 0 && (
              <div className="summary-block">
                <h3>Заклинания</h3>
                <p className="small">
                  {chosenSpells
                    .map((id) => refs.spells.find((x) => x.id === id)?.nameRu ?? id)
                    .join(', ')}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="wiz-nav">
        <button onClick={() => (step === 0 ? navigate('/characters') : setStep(step - 1))}>
          <ArrowLeft size={15} /> {step === 0 ? 'Отмена' : 'Назад'}
        </button>
        {step < STEP_NAMES.length - 1 ? (
          <button
            className="primary"
            disabled={!stepValid(step)}
            onClick={() => setStep(step + 1)}
          >
            Далее <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className="primary"
            disabled={saving || !stepValid(0) || !previewChar}
            onClick={() => void submit()}
          >
            <Check size={15} /> {saving ? 'Сохранение…' : 'Создать персонажа'}
          </button>
        )}
      </div>
    </div>
  );
}
