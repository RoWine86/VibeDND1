// ─── Консоль мастера (/dm): карта с инструментами + боковая панель ─────────
// Панель: активная карта приключения, токены (HP кликом, состояния), бой
// (ручной ввод инициативы или «Кинуть всем», следующий ход, конец боя),
// скрытые броски мастера, заметки сцены (SceneNote).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  Dices,
  Eye,
  EyeOff,
  Flag,
  Map as MapIcon,
  Minus,
  NotebookPen,
  Play,
  Plus,
  SkipForward,
  Swords,
  Users,
  X,
} from 'lucide-react';
import type {
  Adventure,
  Character,
  ConditionKey,
  DiceLogEntry,
  DrawShape,
  FogShape,
  LiveToken,
  SessionState,
  TokenKind,
} from '@vibednd/shared';
import { abilityModifier, effectiveScores, CONDITION_NAMES_RU } from '@vibednd/shared';
import { SessionSocket } from '../ws';
import { api } from '../api';
import MapCanvas from '../components/MapCanvas';
import type { FogReveal } from '../components/MapCanvas';
import '../styles/map.css';

const d20 = () => Math.ceil(Math.random() * 20);
const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

interface SetupRow {
  key: string;
  name: string;
  roll: string;
  tokenId?: string;
  characterId?: string;
  kind: TokenKind;
}

const KIND_LABEL: Record<TokenKind, string> = {
  player: 'Персонаж',
  enemy: 'Враг',
  npc: 'НПС',
};

export default function DmPage() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [pickedId, setPickedId] = useState(() => localStorage.getItem('vibednd.dmSession') ?? '');
  const [session, setSession] = useState<SessionState | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [loadError, setLoadError] = useState('');
  const sockRef = useRef<SessionSocket | null>(null);

  // панель
  const [tab, setTab] = useState<'tokens' | 'combat' | 'notes'>('tokens');
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);

  // инициатива
  const [setupRows, setSetupRows] = useState<SetupRow[] | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  // заметки
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteTitleDraft, setNoteTitleDraft] = useState('');

  // ── Список сессий ────────────────────────────────────────────────────────

  useEffect(() => {
    api
      .get<SessionState[]>('/sessions')
      .then((list) => {
        setSessions(list);
        setLoadError('');
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // ── Подключение к выбранной сессии ───────────────────────────────────────

  useEffect(() => {
    if (!pickedId) return;
    localStorage.setItem('vibednd.dmSession', pickedId);
    setSession(null);
    setCharacters([]);
    setSetupOpen(false);
    setSetupRows(null);
    setSelectedTokenId(null);

    const sock = new SessionSocket('dm', pickedId);
    sockRef.current = sock;
    const off = sock.onMessage((msg) => {
      switch (msg.type) {
        case 'snapshot':
          setSession(msg.session);
          setCharacters(msg.characters);
          break;
        case 'tokenUpsert':
          setSession((s) =>
            s
              ? { ...s, tokens: [...s.tokens.filter((t) => t.id !== msg.token.id), msg.token] }
              : s,
          );
          break;
        case 'tokenRemoved':
          setSession((s) => (s ? { ...s, tokens: s.tokens.filter((t) => t.id !== msg.tokenId) } : s));
          setSelectedTokenId((id) => (id === msg.tokenId ? null : id));
          break;
        case 'fogReveals':
          setSession((s) =>
            s
              ? {
                  ...s,
                  fogReveals: [
                    ...s.fogReveals.filter((r) => r.mapId !== msg.mapId),
                    ...msg.reveals.map((r) => ({ ...r, mapId: msg.mapId })),
                  ],
                }
              : s,
          );
          break;
        case 'strokeAdded':
          setSession((s) =>
            s ? { ...s, drawings: [...s.drawings.filter((d) => d.id !== msg.stroke.id), msg.stroke] } : s,
          );
          break;
        case 'strokeRemoved':
          setSession((s) => (s ? { ...s, drawings: s.drawings.filter((d) => d.id !== msg.strokeId) } : s));
          break;
        case 'drawingsCleared':
          setSession((s) => (s ? { ...s, drawings: s.drawings.filter((d) => d.mapId !== msg.mapId) } : s));
          break;
        case 'combat':
          setSession((s) => (s ? { ...s, combat: msg.combat } : s));
          break;
        case 'diceLog':
          setSession((s) => (s ? { ...s, diceLog: [...s.diceLog.slice(-49), msg.entry] } : s));
          break;
        case 'characterUpdated':
          setCharacters((chs) => [...chs.filter((c) => c.id !== msg.character.id), msg.character]);
          break;
        case 'activeMap':
          setSession((s) => (s ? { ...s, activeMapId: msg.mapId } : s));
          break;
        case 'error':
          setLoadError(msg.message);
          break;
      }
    });
    return () => {
      off();
      sock.close();
      sockRef.current = null;
    };
  }, [pickedId]);

  // ── Приключение выбранной сессии ─────────────────────────────────────────

  useEffect(() => {
    if (!session?.adventureId) return;
    api
      .get<Adventure>(`/adventures/${session.adventureId}`)
      .then((adv) => {
        setAdventure(adv);
        setLoadError('');
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [session?.adventureId]);

  // ── Производные данные ───────────────────────────────────────────────────

  const map = useMemo(
    () => adventure?.maps.find((m) => m.id === session?.activeMapId) ?? adventure?.maps[0],
    [adventure, session?.activeMapId],
  );
  const mapTokens = useMemo(
    () => (session?.tokens ?? []).filter((t) => t.mapId === map?.id),
    [session?.tokens, map?.id],
  );
  const fogReveals = useMemo<FogReveal[]>(
    () => (session?.fogReveals ?? []).filter((r) => r.mapId === map?.id),
    [session?.fogReveals, map?.id],
  );
  const drawings = useMemo(
    () => (session?.drawings ?? []).filter((d) => d.mapId === map?.id),
    [session?.drawings, map?.id],
  );
  const mapNotes = useMemo(
    () => (adventure?.notes ?? []).filter((n) => n.mapId === map?.id),
    [adventure, map?.id],
  );
  const selectedToken = mapTokens.find((t) => t.id === selectedTokenId) ?? null;

  // ── Действия (только отправка в сокет; состояние придёт рассылкой) ───────

  const emit = (msg: Parameters<SessionSocket['send']>[0]) => sockRef.current?.send(msg);

  const onTokenMove = (tokenId: string, x: number, y: number) => {
    // оптимистично двигаем локально, чтобы drag не дёргался
    setSession((s) =>
      s ? { ...s, tokens: s.tokens.map((t) => (t.id === tokenId ? { ...t, x, y } : t)) } : s,
    );
    emit({ type: 'moveToken', tokenId, x, y });
  };

  const onFog = (shape: FogShape, fogMode: 'reveal' | 'hide') => {
    if (!map) return;
    if (fogMode === 'reveal') {
      // оптимистично открываем область локально — кисть должна рисовать без задержки
      const optimistic: FogReveal = { id: `local-${Date.now()}-${Math.random()}`, mapId: map.id, shape };
      setSession((s) => (s ? { ...s, fogReveals: [...s.fogReveals, optimistic] } : s));
    } else {
      // оптимистично убираем совпадающие области, чтобы ответ сервера не откатывал UI
      const shapeJson = JSON.stringify(shape);
      setSession((s) =>
        s
          ? {
              ...s,
              fogReveals: s.fogReveals.filter(
                (r) => !(r.mapId === map.id && JSON.stringify(r.shape) === shapeJson),
              ),
            }
          : s,
      );
    }
    emit({ type: 'fog', mapId: map.id, shape, mode: fogMode });
  };

  const onFogUndo = () => {
    const last = fogReveals[fogReveals.length - 1];
    if (!last) return;
    emit({ type: 'fog', mapId: last.mapId, shape: last.shape, mode: 'hide' });
  };

  const changeHp = (token: LiveToken, delta: number) => {
    emit({ type: 'setTokenHp', tokenId: token.id, currentHp: token.currentHp + delta });
  };

  const toggleCondition = (token: LiveToken, cond: ConditionKey) => {
    const next = token.conditions.includes(cond)
      ? token.conditions.filter((c) => c !== cond)
      : [...token.conditions, cond];
    emit({ type: 'setTokenConditions', tokenId: token.id, conditions: next });
  };

  // ── Инициатива ───────────────────────────────────────────────────────────

  const combat = session?.combat;

  const initModOf = (row: SetupRow): number => {
    if (row.characterId) {
      const ch = characters.find((c) => c.id === row.characterId);
      if (ch) return abilityModifier(effectiveScores(ch).dex);
    }
    return 0;
  };

  const openSetup = () => {
    if (!session) return;
    const rows: SetupRow[] = [];
    // персонажи партии
    for (const chId of session.characterIds) {
      const ch = characters.find((c) => c.id === chId);
      if (!ch) continue;
      const token = session.tokens.find((t) => t.characterId === chId);
      rows.push({
        key: `ch-${chId}`,
        name: ch.name,
        roll: '',
        tokenId: token?.id,
        characterId: chId,
        kind: 'player',
      });
    }
    // токены активной карты без персонажа (враги и НПС)
    for (const t of mapTokens) {
      if (t.characterId) continue;
      if (t.kind === 'player') continue;
      rows.push({ key: `tk-${t.id}`, name: t.name, roll: '', tokenId: t.id, kind: t.kind });
    }
    setSetupRows(rows);
    setSetupOpen(true);
  };

  const rollForAll = () => {
    setSetupRows((rows) =>
      (rows ?? []).map((r) => ({ ...r, roll: String(d20() + initModOf(r)) })),
    );
  };

  const startCombat = () => {
    if (!setupRows) return;
    const entries = setupRows
      .map((r) => ({ ...r, parsed: parseInt(r.roll, 10) }))
      .filter((r) => Number.isFinite(r.parsed))
      .map((r) => ({
        name: r.name,
        roll: r.parsed,
        tokenId: r.tokenId,
        characterId: r.characterId,
        kind: r.kind,
      }));
    if (entries.length === 0) return;
    emit({ type: 'initiativeStart', entries });
    setSetupOpen(false);
    setSetupRows(null);
  };

  // ── Заметки сцены ────────────────────────────────────────────────────────

  const saveNotes = (notes: Adventure['notes']) => {
    if (!adventure) return;
    setAdventure({ ...adventure, notes });
    api.put(`/adventures/${adventure.id}`, { notes }).catch((e: Error) => setLoadError(e.message));
  };

  const openNote = (id: string) => {
    if (openNoteId === id) {
      setOpenNoteId(null);
      return;
    }
    const note = mapNotes.find((n) => n.id === id);
    setOpenNoteId(id);
    setNoteTitleDraft(note?.title ?? '');
    setNoteDraft(note?.body ?? '');
  };

  const saveOpenNote = () => {
    if (!adventure || !openNoteId) return;
    saveNotes(
      adventure.notes.map((n) =>
        n.id === openNoteId ? { ...n, title: noteTitleDraft, body: noteDraft } : n,
      ),
    );
    setOpenNoteId(null);
  };

  const addNote = () => {
    if (!adventure || !map) return;
    const note = {
      id: crypto.randomUUID(),
      mapId: map.id,
      title: `Заметка ${mapNotes.length + 1}`,
      body: '',
    };
    saveNotes([...adventure.notes, note]);
    setOpenNoteId(note.id);
    setNoteTitleDraft(note.title);
    setNoteDraft('');
  };

  // ── Экран выбора сессии ──────────────────────────────────────────────────

  if (!pickedId) {
    return (
      <div className="dm-page" style={{ display: 'block', padding: 32 }}>
        <div className="dm-session-picker anim-fade-in">
          <h1>Консоль мастера</h1>
          <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
            Выберите сессию, которой будете управлять.
          </p>
          {loadError && <div className="error-box">Ошибка: {loadError}</div>}
          {sessions.length === 0 && !loadError && (
            <div className="empty-state">
              <h2>Нет сессий</h2>
              <p>Создайте сессию из приключения в библиотеке приключений.</p>
            </div>
          )}
          {sessions.map((s) => (
            <div key={s.id} className="dm-session-row">
              <span>{s.name}</span>
              <button className="primary" onClick={() => setPickedId(s.id)}>
                Открыть
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Основной экран ───────────────────────────────────────────────────────

  const combatEntries = combat?.entries ?? [];

  return (
    <div className="dm-page">
      <div className="dm-map-area">
        <MapCanvas
          map={map}
          tokens={mapTokens}
          fogReveals={fogReveals}
          drawings={drawings}
          mode="dm"
          characters={characters}
          onTokenMove={onTokenMove}
          onFog={onFog}
          onFogReset={() => map && emit({ type: 'fogReset', mapId: map.id })}
          onFogUndo={onFogUndo}
          onDraw={(shape: DrawShape) => map && emit({ type: 'draw', stroke: { mapId: map.id, shape } })}
          onErase={(strokeId) => emit({ type: 'eraseStroke', strokeId })}
          onClearDrawings={() => map && emit({ type: 'clearDrawings', mapId: map.id })}
        />
      </div>

      <aside className="dm-panel">
        {/* Шапка: сессия и активная карта */}
        <div className="dm-section">
          <div className="dm-session-head">
            <span className="dm-session-name">{session?.name ?? 'Подключение…'}</span>
            <button
              className="dm-btn"
              title="Сменить сессию"
              onClick={() => {
                setPickedId('');
                localStorage.removeItem('vibednd.dmSession');
              }}
            >
              Сменить
            </button>
          </div>
          <div className="dm-field">
            <label>
              <MapIcon size={14} /> Активная карта
            </label>
            <select
              value={session?.activeMapId ?? ''}
              onChange={(e) => emit({ type: 'setActiveMap', mapId: e.target.value })}
            >
              {(adventure?.maps ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              {(adventure?.maps.length ?? 0) === 0 && <option value="">Нет карт</option>}
            </select>
          </div>
        </div>

        {/* Вкладки */}
        <div className="dm-tabs">
          <button className={`dm-tab${tab === 'tokens' ? ' active' : ''}`} onClick={() => setTab('tokens')}>
            <Users size={14} /> Токены
          </button>
          <button className={`dm-tab${tab === 'combat' ? ' active' : ''}`} onClick={() => setTab('combat')}>
            <Swords size={14} /> Бой
          </button>
          <button className={`dm-tab${tab === 'notes' ? ' active' : ''}`} onClick={() => setTab('notes')}>
            <NotebookPen size={14} /> Заметки
          </button>
        </div>

        {/* ── Токены ── */}
        {tab === 'tokens' && (
          <div className="dm-scroll">
            {mapTokens.length === 0 && (
              <p className="dm-dim">На активной карте нет токенов.</p>
            )}
            {mapTokens.map((t) => (
              <div
                key={t.id}
                className={`dm-token${selectedTokenId === t.id ? ' selected' : ''}`}
                onClick={() => setSelectedTokenId(selectedTokenId === t.id ? null : t.id)}
              >
                <div className="dm-token-row">
                  <span className={`dm-token-dot kind-${t.kind}`} />
                  <span className="dm-token-name">
                    {t.name}
                    {t.hidden && <EyeOff size={13} className="dm-hidden-mark" />}
                  </span>
                  <span className="dm-token-hp">
                    {t.maxHp > 0 ? `${t.currentHp}/${t.maxHp}` : '—'}
                  </span>
                  <button
                    className="dm-btn"
                    title="Урон 1"
                    onClick={(e) => {
                      e.stopPropagation();
                      changeHp(t, -1);
                    }}
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    className="dm-btn"
                    title="Лечение 1"
                    onClick={(e) => {
                      e.stopPropagation();
                      changeHp(t, +1);
                    }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {t.conditions.length > 0 && (
                  <div className="dm-token-conds">
                    {t.conditions.map((c) => (
                      <span key={c} className="dm-cond">
                        {CONDITION_NAMES_RU[c]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {selectedToken && (
              <div className="dm-token-editor anim-fade-in">
                <div className="dm-token-editor-head">
                  <strong>{selectedToken.name}</strong>
                  <span className="dm-dim">{KIND_LABEL[selectedToken.kind]}</span>
                </div>
                <div className="dm-field">
                  <label>HP: быстрый урон / лечение</label>
                  <div className="dm-hp-btns">
                    {[-10, -5, -1, +1, +5, +10].map((d) => (
                      <button key={d} className="dm-btn" onClick={() => changeHp(selectedToken, d)}>
                        {d > 0 ? `+${d}` : d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="dm-field">
                  <label>Состояния</label>
                  <div className="dm-cond-grid">
                    {(Object.keys(CONDITION_NAMES_RU) as ConditionKey[]).map((c) => (
                      <button
                        key={c}
                        className={`dm-cond-toggle${selectedToken.conditions.includes(c) ? ' on' : ''}`}
                        onClick={() => toggleCondition(selectedToken, c)}
                      >
                        {CONDITION_NAMES_RU[c]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="dm-hp-btns">
                  <button
                    className="dm-btn"
                    onClick={() =>
                      emit({ type: 'setTokenHidden', tokenId: selectedToken.id, hidden: !selectedToken.hidden })
                    }
                  >
                    {selectedToken.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    {selectedToken.hidden ? ' Показать на доске' : ' Скрыть с доски'}
                  </button>
                  <button
                    className="dm-btn dm-danger"
                    onClick={() => {
                      if (window.confirm(`Убрать токен «${selectedToken.name}» с карты?`)) {
                        emit({ type: 'removeToken', tokenId: selectedToken.id });
                      }
                    }}
                  >
                    <X size={14} /> Убрать
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Бой ── */}
        {tab === 'combat' && (
          <div className="dm-scroll">
            {!combat?.active ? (
              <>
                {!setupOpen ? (
                  <button className="primary dm-wide" onClick={openSetup}>
                    <Play size={15} /> Начать бой
                  </button>
                ) : (
                  <div className="dm-setup anim-fade-in">
                    <div className="dm-field">
                      <label>Инициатива участников</label>
                    </div>
                    {setupRows?.map((row) => (
                      <div key={row.key} className="dm-setup-row">
                        <span className="dm-setup-name">{row.name}</span>
                        <span className="dm-dim">{KIND_LABEL[row.kind]}</span>
                        <input
                          type="number"
                          value={row.roll}
                          placeholder="—"
                          onChange={(e) =>
                            setSetupRows((rows) =>
                              (rows ?? []).map((r) =>
                                r.key === row.key ? { ...r, roll: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                    <div className="dm-hp-btns">
                      <button className="dm-btn" onClick={rollForAll}>
                        <Dices size={14} /> Кинуть всем
                      </button>
                      <button className="primary" onClick={startCombat}>
                        <Flag size={14} /> В бой
                      </button>
                    </div>
                    <button className="dm-btn dm-wide" onClick={() => setSetupOpen(false)}>
                      Отмена
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="dm-round">Раунд {combat.round}</div>
                {combatEntries.map((e, i) => (
                  <div
                    key={e.id}
                    className={`dm-init-entry kind-${e.kind}${i === combat.currentIndex ? ' current' : ''}`}
                  >
                    <span className="dm-init-roll">{e.roll}</span>
                    <span className="dm-init-name">{e.name}</span>
                    {i === combat.currentIndex && <span className="dm-init-now">ход</span>}
                  </div>
                ))}
                <div className="dm-hp-btns">
                  <button className="primary" onClick={() => emit({ type: 'initiativeNext' })}>
                    <SkipForward size={14} /> Следующий ход
                  </button>
                  <button
                    className="dm-btn dm-danger"
                    onClick={() => {
                      if (window.confirm('Закончить бой?')) emit({ type: 'initiativeEnd' });
                    }}
                  >
                    <X size={14} /> Закончить бой
                  </button>
                </div>
              </>
            )}

            {/* Скрытые броски мастера */}
            <div className="dm-section dm-hidden-roll">
              <div className="dm-field">
                <label>
                  <EyeOff size={14} /> Скрытый бросок (видите только вы)
                </label>
                <HiddenRollForm onRoll={(formula) => emit({ type: 'rollDice', label: 'Скрытый бросок', formula, hidden: true })} />
              </div>
              <DmDiceLog log={session?.diceLog ?? []} />
            </div>
          </div>
        )}

        {/* ── Заметки сцены ── */}
        {tab === 'notes' && (
          <div className="dm-scroll">
            <div className="dm-field dm-notes-head">
              <label>Заметки сцены{map ? `: «${map.name}»` : ''}</label>
              <button className="dm-btn" onClick={addNote} disabled={!map}>
                <Plus size={14} /> Добавить
              </button>
            </div>
            {mapNotes.length === 0 && <p className="dm-dim">Заметок для этой карты пока нет.</p>}
            {mapNotes.map((n) => (
              <div key={n.id} className="dm-note">
                <div className="dm-note-title" onClick={() => openNote(n.id)}>
                  <NotebookPen size={14} />
                  <span>{n.title || 'Без названия'}</span>
                  <button
                    className="dm-btn"
                    title="Удалить заметку"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (adventure && window.confirm('Удалить заметку?')) {
                        saveNotes(adventure.notes.filter((x) => x.id !== n.id));
                        if (openNoteId === n.id) setOpenNoteId(null);
                      }
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                {openNoteId === n.id && (
                  <div className="dm-note-editor anim-fade-in">
                    {n.artPath && <img className="dm-note-art" src={n.artPath} alt={n.title} />}
                    <input value={noteTitleDraft} onChange={(e) => setNoteTitleDraft(e.target.value)} placeholder="Заголовок" />
                    <textarea
                      rows={7}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Текст заметки для мастера…"
                    />
                    <button className="primary" onClick={saveOpenNote}>
                      Сохранить
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

// ─── Форма скрытого броска ──────────────────────────────────────────────────

function HiddenRollForm({ onRoll }: { onRoll: (formula: string) => void }) {
  const [formula, setFormula] = useState('1d20');
  return (
    <div className="dm-hidden-form">
      <input
        value={formula}
        onChange={(e) => setFormula(e.target.value)}
        placeholder="1d20+5"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && formula.trim()) onRoll(formula.trim());
        }}
      />
      <button
        className="dm-btn"
        title="Кинуть скрыто"
        onClick={() => formula.trim() && onRoll(formula.trim())}
      >
        <Crosshair size={14} />
      </button>
    </div>
  );
}

// ─── Лог бросков мастера (скрытые помечены) ─────────────────────────────────

function DmDiceLog({ log }: { log: DiceLogEntry[] }) {
  const recent = log.slice(-8).reverse();
  if (recent.length === 0) return null;
  return (
    <div className="dm-dicelog">
      {recent.map((e) => (
        <div key={e.id} className={`dm-dicelog-row${e.hidden ? ' hidden-roll' : ''}`}>
          <span className="dm-dicelog-name">
            {e.hidden && <EyeOff size={12} />} {e.rollerName}
          </span>
          <span className="dm-dicelog-label">{e.label}</span>
          <span className="dm-dicelog-formula">
            {e.formula} [{e.rolls.join(', ')}]
          </span>
          <span className="dm-dicelog-total">{e.total}</span>
        </div>
      ))}
    </div>
  );
}
