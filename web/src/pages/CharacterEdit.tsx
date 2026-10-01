// ─── Редактирование персонажа + загрузка портрета + визард повышения уровня ─

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpCircle, Camera, Check, Dices,
} from 'lucide-react';
import {
  ABILITY_NAMES_RU, abilityModifier, averageHpGain, characterLevel, effectiveScores,
  modifierText, rollDice,
} from '@vibednd/shared';
import type { Character, CharacterClass, Spell } from '@vibednd/shared';
import { api } from '../api';
import CharacterSheet from '../components/CharacterSheet';
import '../styles/wizard.css';
import '../styles/character.css';

export default function CharacterEdit() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [character, setCharacter] = useState<Character | null>(null);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Визард повышения уровня
  const [luOpen, setLuOpen] = useState(searchParams.get('levelup') === '1');
  const [luClassId, setLuClassId] = useState('');
  const [luHpMode, setLuHpMode] = useState<'roll' | 'avg'>('avg');
  const [luRoll, setLuRoll] = useState<number | null>(null);
  const [luSpells, setLuSpells] = useState<string[]>([]);

  // Автосохранение с задержкой после любого изменения (только после загрузки)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSaveRef = useRef(true);

  useEffect(() => {
    Promise.all([
      api.get<Character>(`/characters/${id}`),
      api.get<CharacterClass[]>('/entities/class'),
      api.get<Spell[]>('/entities/spell'),
    ])
      .then(([ch, cls, sp]) => {
        setCharacter(ch);
        setClasses(cls);
        setSpells(sp);
        setLuClassId(ch.classes[0]?.classId ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!character || skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.put<Character>(`/characters/${character.id}`, character)
        .then(() => setSavedAt(new Date().toLocaleTimeString('ru-RU')))
        .catch((e: Error) => setError(e.message));
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [character]);

  const patch = useCallback((p: Partial<Character>) => {
    setCharacter((c) => (c ? { ...c, ...p } : c));
  }, []);

  // ── Портрет: raw fetch с заголовком x-filename ──
  const uploadPortrait = async (file: File) => {
    if (!character) return;
    setUploading(true);
    setError('');
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'x-filename': file.name },
        body: file,
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { path: string };
      patch({ portraitPath: data.path });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // ── Визард повышения уровня ──
  const clsById = new Map(classes.map((c) => [c.id, c]));
  const luCls = clsById.get(luClassId);
  const existingEntry = character?.classes.find((c) => c.classId === luClassId);
  const newClassLevel = (existingEntry?.level ?? 0) + 1;
  const newTotalLevel = character ? characterLevel(character) + 1 : 0;
  const conScore = character ? effectiveScores(character).con : 10;
  const conMod = abilityModifier(conScore);
  const luFeatures = luCls?.features.filter((f) => f.level === newClassLevel) ?? [];
  const luHpGain = luCls
    ? luHpMode === 'avg'
      ? averageHpGain(luCls.hitDie, conScore)
      : (luRoll ?? 0) + conMod
    : 0;
  const luMaxSlotLevel = (luCls?.spellSlotsByLevel?.[newTotalLevel] ?? []).length;
  const luAvailableSpells = luCls?.spellcastingAbility && character
    ? spells.filter(
        (s) =>
          s.classes.includes(luCls.id)
          && s.level <= Math.max(1, luMaxSlotLevel)
          && !character.knownSpells.includes(s.id),
      )
    : [];

  const openWizard = () => {
    setLuClassId(character?.classes[0]?.classId ?? '');
    setLuHpMode('avg');
    setLuRoll(null);
    setLuSpells([]);
    setLuOpen(true);
  };

  const applyLevelUp = () => {
    if (!character || !luCls) return;
    const gain = luHpGain;
    const updatedClasses = character.classes.map((c) =>
      c.classId === luClassId
        ? {
            ...c,
            level: c.level + 1,
            hpRolls: [...c.hpRolls, gain],
            chosenSpells: [...c.chosenSpells, ...luSpells],
          }
        : c);
    if (!existingEntry) {
      updatedClasses.push({
        classId: luClassId,
        level: 1,
        hpRolls: [],
        chosenSpells: luSpells,
      });
    }
    // Пересчёт ячеек по таблице класса на новом уровне персонажа
    const newMax = luCls.spellSlotsByLevel?.[newTotalLevel] ?? character.spellSlotsMax;
    const newCurrent = newMax.map((m, i) => {
      const oldMax = character.spellSlotsMax[i] ?? 0;
      const oldCur = character.spellSlotsCurrent[i] ?? 0;
      return Math.min(m, oldCur + Math.max(0, m - oldMax));
    });
    setCharacter({
      ...character,
      classes: updatedClasses,
      maxHp: character.maxHp + gain,
      currentHp: character.currentHp + gain,
      hitDiceTotal: character.hitDiceTotal + 1,
      hitDiceCurrent: character.hitDiceCurrent + 1,
      spellSlotsMax: newMax,
      spellSlotsCurrent: newCurrent,
      knownSpells: [...character.knownSpells, ...luSpells],
      preparedSpells: [...character.preparedSpells, ...luSpells],
    });
    setLuOpen(false);
  };

  if (error && !character) {
    return (
      <div className="wiz anim-fade-in">
        <h1>Редактирование</h1>
        <div className="error-box" style={{ marginTop: 14 }}>Ошибка: {error}</div>
        <button onClick={() => navigate('/characters')}><ArrowLeft size={15} /> К библиотеке</button>
      </div>
    );
  }
  if (!character) {
    return <div className="wiz anim-fade-in"><p className="muted">Загрузка персонажа…</p></div>;
  }

  return (
    <div className="char-page anim-fade-in">
      <div className="lib-head">
        <h1>Редактирование</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {savedAt && <span className="muted small">Сохранено в {savedAt}</span>}
          <button onClick={() => navigate('/characters')}>
            <ArrowLeft size={15} style={{ verticalAlign: -3 }} /> К библиотеке
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* ── Основные поля + портрет ── */}
      <div className="sheet-section" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div className="portrait-box">
            {character.portraitPath
              ? <img src={character.portraitPath} alt={character.name} />
              : <Camera size={30} />}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPortrait(f);
              e.target.value = '';
            }}
          />
          <button onClick={() => fileInput.current?.click()} disabled={uploading}>
            <Camera size={14} style={{ verticalAlign: -2 }} /> {uploading ? 'Загрузка…' : 'Портрет'}
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="form-row">
            <div className="form-field">
              <label>Имя персонажа</label>
              <input value={character.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Игрок</label>
              <input value={character.playerName} onChange={(e) => patch({ playerName: e.target.value })} />
            </div>
          </div>
          <div className="form-field" style={{ maxWidth: 320 }}>
            <label>Максимум хитов</label>
            <input
              type="number"
              min={1}
              value={character.maxHp}
              onChange={(e) => patch({ maxHp: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
        </div>
      </div>

      {/* ── Повышение уровня ── */}
      {!luOpen ? (
        <div className="rest-bar">
          <button className="primary" onClick={openWizard}>
            <ArrowUpCircle size={15} /> Повысить уровень ({characterLevel(character)} → {characterLevel(character) + 1})
          </button>
        </div>
      ) : (
        <div className="sheet-section">
          <h3><ArrowUpCircle size={15} /> Повышение уровня → {newTotalLevel}</h3>

          <div className="form-field" style={{ maxWidth: 360, marginBottom: 14 }}>
            <label>Класс нового уровня</label>
            <select
              value={luClassId}
              onChange={(e) => { setLuClassId(e.target.value); setLuRoll(null); setLuSpells([]); }}
            >
              {character.classes.map((c) => (
                <option key={c.classId} value={c.classId}>
                  {clsById.get(c.classId)?.nameRu ?? c.classId} (было {c.level} ур.)
                </option>
              ))}
              {classes
                .filter((c) => !character.classes.some((x) => x.classId === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>Новый класс: {c.nameRu}</option>
                ))}
            </select>
          </div>

          {luCls && (
            <>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>Прирост хитов (кость к{luCls.hitDie} + Телосложение {modifierText(conMod)})</label>
                <div className="mode-switch" style={{ marginBottom: 8 }}>
                  <button
                    className={luHpMode === 'avg' ? 'active' : ''}
                    onClick={() => setLuHpMode('avg')}
                  >
                    Среднее (+{averageHpGain(luCls.hitDie, conScore)})
                  </button>
                  <button
                    className={luHpMode === 'roll' ? 'active' : ''}
                    onClick={() => { setLuHpMode('roll'); setLuRoll(null); }}
                  >
                    Бросок к{luCls.hitDie}
                  </button>
                </div>
                {luHpMode === 'roll' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button onClick={() => setLuRoll(rollDice(`1d${luCls.hitDie}`).total)}>
                      <Dices size={14} style={{ verticalAlign: -2 }} /> Бросить
                    </button>
                    {luRoll != null && (
                      <span key={luRoll} className="roll-result anim-dice-pop" style={{ marginTop: 0 }}>
                        <span className="rr-total">{luRoll}</span>
                        <span className="rr-detail">+ {conMod} ТЕЛ = {luRoll + conMod}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {luFeatures.length > 0 && (
                <div className="summary-block">
                  <h3>Умения {newClassLevel} уровня класса «{luCls.nameRu}»</h3>
                  {luFeatures.map((f) => (
                    <div key={f.name} style={{ marginBottom: 8 }}>
                      <div style={{ color: 'var(--gold-bright)', fontSize: 14 }}>{f.name}</div>
                      <div className="muted small">{f.description}</div>
                    </div>
                  ))}
                </div>
              )}

              {luCls.spellcastingAbility && luAvailableSpells.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label className="muted small" style={{ display: 'block', marginBottom: 6 }}>
                    Новые заклинания ({luSpells.length} выбрано; базовая характеристика — {ABILITY_NAMES_RU[luCls.spellcastingAbility]})
                  </label>
                  <div className="spell-list">
                    {luAvailableSpells.map((s) => {
                      const on = luSpells.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          className={`spell-row${on ? ' selected' : ''}`}
                          onClick={() =>
                            setLuSpells((prev) =>
                              on ? prev.filter((x) => x !== s.id) : [...prev, s.id])
                          }
                        >
                          <span className="sname">{s.nameRu}</span>
                          <span className="smeta">
                            {s.level === 0 ? 'Заговор' : `${s.level} ур.`} · {s.castingTime}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="primary"
                  disabled={luHpMode === 'roll' && luRoll == null}
                  onClick={applyLevelUp}
                >
                  <Check size={15} /> Применить (+{luHpGain} хитов)
                </button>
                <button onClick={() => setLuOpen(false)}>Отмена</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Полная карточка с трекингом ── */}
      <CharacterSheet character={character} onPatch={patch} />
    </div>
  );
}
