// ─── Консоль мастера (/dm): карта с инструментами + боковая панель ─────────
// Панель: активная карта приключения, токены (HP кликом, состояния), бой
// (ручной ввод инициативы или «Кинуть всем», следующий ход, конец боя),
// скрытые броски мастера, заметки сцены (SceneNote).

import { useEffect, useMemo, useState } from 'react';
import {
  Coins,
  Crosshair,
  Dices,
  Eye,
  EyeOff,
  Flag,
  MapPin,
  Map as MapIcon,
  Minus,
  NotebookPen,
  Play,
  Plus,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Swords,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type {
  Ability,
  Adventure,
  Character,
  ConditionKey,
  Currency,
  DiceLogEntry,
  DrawShape,
  FogShape,
  Item,
  LiveToken,
  Monster,
  SaveRequest,
  SessionState,
  Spell,
  TokenKind,
} from '@vibednd/shared';
import {
  abilityModifier, effectiveScores, encumbranceTier, inventoryWeight,
  CONDITION_NAMES_RU,
} from '@vibednd/shared';
import { SessionProvider, useSessionStore } from '../sessionStore';
import { api } from '../api';
import MapCanvas from '../components/MapCanvas';
import type { FogReveal } from '../components/MapCanvas';
import CoinPurse, { COIN_META } from '../components/CoinPurse';
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

/** Заготовка токена, который мастер размещает кликом по карте. */
interface PlacingToken {
  kind: TokenKind;
  name: string;
  monsterId?: string;
  maxHp: number;
  sizeCells: number;
}

const KIND_LABEL: Record<TokenKind, string> = {
  player: 'Персонаж',
  enemy: 'Враг',
  npc: 'НПС',
};

export default function DmPage() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [pickedId, setPickedId] = useState(() => localStorage.getItem('vibednd.dmSession') ?? '');
  const [pickerError, setPickerError] = useState('');

  // ── Список сессий ────────────────────────────────────────────────────────

  useEffect(() => {
    api
      .get<SessionState[]>('/sessions')
      .then((list) => {
        setSessions(list);
        setPickerError('');
      })
      .catch((e: Error) => setPickerError(e.message));
  }, []);

  useEffect(() => {
    if (pickedId) localStorage.setItem('vibednd.dmSession', pickedId);
  }, [pickedId]);

  // ── Экран выбора сессии ──────────────────────────────────────────────────

  if (!pickedId) {
    return (
      <div className="dm-page" style={{ display: 'block', padding: 32 }}>
        <div className="dm-session-picker anim-fade-in">
          <h1>Консоль мастера</h1>
          <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
            Выберите сессию, которой будете управлять.
          </p>
          {pickerError && <div className="error-box">Ошибка: {pickerError}</div>}
          {sessions.length === 0 && !pickerError && (
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

  // ── Консоль: стор сессии пересоздаётся при смене сессии (key) ───────────

  return (
    <SessionProvider key={pickedId} role="dm" sessionId={pickedId}>
      <DmConsole onPickSession={setPickedId} />
    </SessionProvider>
  );
}

function DmConsole({ onPickSession }: { onPickSession: (id: string) => void }) {
  const store = useSessionStore();
  const { session, characters, saveRequests } = store;
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [loadError, setLoadError] = useState('');
  // ошибка WS (например, сохранённая сессия удалена) или локальная ошибка API
  const consoleError = store.error || loadError;

  // панель
  const [tab, setTab] = useState<'tokens' | 'combat' | 'notes'>('tokens');
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);

  // справочники монстров, заклинаний и предметов (бейдж перегруза, шаг 7)
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [itemList, setItemList] = useState<Item[]>([]);
  useEffect(() => {
    api.get<Monster[]>('/entities/monster').then(setMonsters).catch(() => setMonsters([]));
    api.get<Spell[]>('/entities/spell').then(setSpells).catch(() => setSpells([]));
    api.get<Item[]>('/entities/item').then(setItemList).catch(() => setItemList([]));
  }, []);

  // размещение нового токена кликом по карте
  const [placing, setPlacing] = useState<PlacingToken | null>(null);

  // инициатива
  const [setupRows, setSetupRows] = useState<SetupRow[] | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  // заметки
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteTitleDraft, setNoteTitleDraft] = useState('');

  // снятие выделения: удалённый токен (прежнее поведение — из switch'а tokenRemoved)
  useEffect(() => {
    if (selectedTokenId && !session?.tokens.some((t) => t.id === selectedTokenId)) {
      setSelectedTokenId(null);
    }
  }, [session?.tokens, selectedTokenId]);

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
  const monsterById = useMemo(() => new Map(monsters.map((m) => [m.id, m])), [monsters]);
  const itemById = useMemo(() => new Map(itemList.map((i) => [i.id, i])), [itemList]);
  // перегруженные токены (вес > Сила×5) — бейдж на карте (шаг 7)
  const encumberedTokenIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of mapTokens) {
      if (!t.characterId) continue;
      const ch = characters.find((c) => c.id === t.characterId);
      if (!ch) continue;
      const tier = encumbranceTier(inventoryWeight(ch, itemById), ch);
      if (tier !== 'normal') set.add(t.id);
    }
    return set;
  }, [mapTokens, characters, itemById]);
  const spellById = useMemo(() => new Map(spells.map((s) => [s.id, s])), [spells]);
  const selectedMonster = selectedToken?.monsterId
    ? monsterById.get(selectedToken.monsterId)
    : undefined;

  // Цели для атак/заклинаний монстра: токены партии на активной карте
  const partyTargets = useMemo(
    () => mapTokens.filter((t) => t.kind === 'player'),
    [mapTokens],
  );
  // Цели для враждебных заклинаний по выбору мастера — любые токены карты
  // (кроме самого кастующего)
  const allTargets = useMemo(
    () => mapTokens.filter((t) => t.id !== selectedTokenId),
    [mapTokens, selectedTokenId],
  );

  // ── Действия (отправка в сокет через стор; состояние придёт рассылкой) ───

  const emit = store.send;

  // движение токена и туман — оптимистичные, живут в сторе
  const onTokenMove = store.moveToken;

  const onFog = (shape: FogShape, fogMode: 'reveal' | 'hide') => {
    if (!map) return;
    store.fog(map.id, shape, fogMode);
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

  // ── Добавление токена: заготовка → клик по карте ────────────────────────

  const placeTokenAt = (x: number, y: number) => {
    if (!placing || !map) return;
    emit({
      type: 'addToken',
      token: {
        mapId: map.id,
        kind: placing.kind,
        name: placing.name,
        monsterId: placing.monsterId,
        x,
        y,
        sizeCells: placing.sizeCells,
        hidden: placing.kind === 'enemy',
        currentHp: placing.maxHp,
        maxHp: placing.maxHp,
        conditions: [],
      },
    });
    setPlacing(null);
  };

  // ── Атаки и заклинания выбранного монстра ───────────────────────────────

  const monsterAttack = (attackName: string, targetTokenId: string) => {
    if (!selectedToken) return;
    emit({
      type: 'attackWith',
      attackerTokenId: selectedToken.id,
      attackName,
      targetTokenId,
    });
  };

  const monsterCast = (spellId: string, slotLevel: number, targetTokenIds: string[]) => {
    if (!selectedToken) return;
    emit({
      type: 'castSpell',
      tokenId: selectedToken.id,
      spellId,
      slotLevel,
      targetTokenIds,
    });
  };

  // ── Спасброски из очереди (за монстров или фолбэк за игрока) ────────────

  const resolveSave = (req: SaveRequest, rolledValue?: number) => {
    emit({ type: 'resolveSave', requestId: req.id, rolledValue });
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

  // ── Основной экран ───────────────────────────────────────────────────────

  const combatEntries = combat?.entries ?? [];

  const backToPicker = () => {
    onPickSession('');
    localStorage.removeItem('vibednd.dmSession');
    setLoadError('');
  };

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
          combatEvents={store.combatEvents}
          encumberedTokenIds={encumberedTokenIds}
          onTokenMove={onTokenMove}
          onFog={onFog}
          onFogReset={() => map && emit({ type: 'fogReset', mapId: map.id })}
          onFogUndo={onFogUndo}
          onDraw={(shape: DrawShape) => map && emit({ type: 'draw', stroke: { mapId: map.id, shape } })}
          onErase={(strokeId) => emit({ type: 'eraseStroke', strokeId })}
          onClearDrawings={() => map && emit({ type: 'clearDrawings', mapId: map.id })}
          onMapClick={placing ? placeTokenAt : undefined}
        />
        {placing && (
          <div className="dm-placing-hint anim-fade-in">
            <MapPin size={14} /> Кликните по карте, чтобы разместить: {placing.name}
            <button className="dm-btn" onClick={() => setPlacing(null)}>
              <X size={13} /> Отмена
            </button>
          </div>
        )}
      </div>

      <aside className="dm-panel">
        {/* Ошибка подключения (например, сохранённая сессия удалена) */}
        {consoleError && (
          <div className="error-box" style={{ margin: '12px 14px 0' }}>
            {consoleError}
            <button
              className="dm-btn"
              style={{ marginTop: 8 }}
              onClick={backToPicker}
            >
              Выбрать другую сессию
            </button>
          </div>
        )}
        {/* Шапка: сессия и активная карта */}
        <div className="dm-section">
          <div className="dm-session-head">
            <span className="dm-session-name">{session?.name ?? 'Подключение…'}</span>
            <button
              className="dm-btn"
              title="Сменить сессию"
              onClick={backToPicker}
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
            {saveRequests.length > 0 && <span className="dm-badge">{saveRequests.length}</span>}
          </button>
          <button className={`dm-tab${tab === 'notes' ? ' active' : ''}`} onClick={() => setTab('notes')}>
            <NotebookPen size={14} /> Заметки
          </button>
        </div>

        {/* ── Токены ── */}
        {tab === 'tokens' && (
          <div className="dm-scroll">
            <AddTokenForm
              monsters={monsters}
              disabled={!map || placing !== null}
              onPlace={(t) => {
                setPlacing(t);
                setTab('tokens');
              }}
            />
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

                {/* Атаки монстра: выбор цели из токенов партии */}
                {(selectedMonster?.attacks.length ?? 0) > 0 && (
                  <div className="dm-field">
                    <label><Swords size={13} /> Атака</label>
                    {partyTargets.length === 0 ? (
                      <p className="dm-dim">На карте нет токенов партии.</p>
                    ) : (
                      selectedMonster!.attacks.map((a) => (
                        <MonsterAttackRow
                          key={a.name}
                          attack={a}
                          targets={partyTargets}
                          onAttack={(targetId) => monsterAttack(a.name, targetId)}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Заклинания монстра-кастера */}
                {(selectedMonster?.spells?.length ?? 0) > 0 && (
                  <MonsterSpells
                    token={selectedToken}
                    monster={selectedMonster!}
                    spellById={spellById}
                    targets={allTargets}
                    onCast={monsterCast}
                  />
                )}

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
                {/* Кошелёк персонажа: мастер может выдать/изъять (раздача лута) */}
                {selectedToken.characterId && (
                  <DmCoinPurse
                    character={characters.find((c) => c.id === selectedToken.characterId)}
                    onPatch={(patch) =>
                      emit({ type: 'characterPatch', characterId: selectedToken.characterId!, patch })
                    }
                  />
                )}
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

            {/* Очередь спасбросков */}
            {saveRequests.length > 0 && (
              <div className="dm-section dm-save-queue">
                <div className="dm-field">
                  <label>
                    <ShieldAlert size={14} /> Спасброски в очереди ({saveRequests.length})
                  </label>
                </div>
                {saveRequests.map((req) => (
                  <SaveQueueRow key={req.id} request={req} onResolve={resolveSave} />
                ))}
              </div>
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

// ─── Добавление токена (враг из библиотеки / НПС / свободный) ───────────────

function AddTokenForm({
  monsters, disabled, onPlace,
}: {
  monsters: Monster[];
  disabled: boolean;
  onPlace: (t: PlacingToken) => void;
}) {
  const [open, setOpen] = useState(false);
  const [monsterId, setMonsterId] = useState('');
  const [customName, setCustomName] = useState('');
  const [customHp, setCustomHp] = useState('1');

  const chosen = monsters.find((m) => m.id === monsterId);

  if (!open) {
    return (
      <button className="dm-btn dm-wide" style={{ marginBottom: 10 }} disabled={disabled} onClick={() => setOpen(true)}>
        <Plus size={14} /> Добавить токен
      </button>
    );
  }
  return (
    <div className="dm-add-token anim-fade-in">
      <div className="dm-field">
        <label><Swords size={13} /> Враг из библиотеки монстров</label>
        <select value={monsterId} onChange={(e) => setMonsterId(e.target.value)}>
          <option value="">— выберите монстра —</option>
          {[...monsters].sort((a, b) => a.nameRu.localeCompare(b.nameRu)).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nameRu} (ПО {m.challengeRating}, {m.hitPoints} HP)
            </option>
          ))}
        </select>
        {chosen && (
          <button
            className="primary dm-wide"
            onClick={() => onPlace({
              kind: 'enemy',
              name: chosen.nameRu,
              monsterId: chosen.id,
              maxHp: chosen.hitPoints,
              // укрупнение по размеру: S/M = 1 клетка, L = 2, H = 3, G = 4
              sizeCells: chosen.size === 'L' ? 2 : chosen.size === 'H' ? 3 : chosen.size === 'G' ? 4 : 1,
            })}
          >
            <MapPin size={14} /> Разместить кликом по карте
          </button>
        )}
      </div>
      <div className="dm-field">
        <label>НПС или свободный токен</label>
        <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Имя (например, Торговец)" />
        <div className="dm-hp-btns">
          <input
            type="number"
            min={0}
            value={customHp}
            onChange={(e) => setCustomHp(e.target.value)}
            placeholder="HP"
            style={{ width: 70 }}
          />
          <button
            className="primary"
            disabled={!customName.trim()}
            onClick={() => onPlace({
              kind: 'npc',
              name: customName.trim(),
              maxHp: Math.max(0, parseInt(customHp, 10) || 0),
              sizeCells: 1,
            })}
          >
            <MapPin size={14} /> Разместить
          </button>
        </div>
      </div>
      <button className="dm-btn dm-wide" onClick={() => setOpen(false)}>Закрыть</button>
    </div>
  );
}

// ─── Атака монстра: выбор цели ──────────────────────────────────────────────

function MonsterAttackRow({
  attack, targets, onAttack,
}: {
  attack: { name: string; attackBonus: number; damageDice: string; damageBonus: number; damageType: string };
  targets: LiveToken[];
  onAttack: (targetTokenId: string) => void;
}) {
  const [targetId, setTargetId] = useState('');
  return (
    <div className="dm-attack-row">
      <div className="dm-attack-info">
        {attack.name}{' '}
        <span className="dm-dim">
          {fmtMod(attack.attackBonus)} · {attack.damageDice}{attack.damageBonus ? fmtMod(attack.damageBonus) : ''} {attack.damageType}
        </span>
      </div>
      <div className="dm-attack-pick">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">Цель…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || 'Безымянный'} ({t.currentHp}/{t.maxHp})
            </option>
          ))}
        </select>
        <button className="primary" disabled={!targetId} onClick={() => onAttack(targetId)}>
          <Swords size={13} /> Атака
        </button>
      </div>
    </div>
  );
}

// ─── Заклинания монстра-кастера ─────────────────────────────────────────────

const SAVE_ABILITY_GEN: Record<Ability, string> = {
  str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы',
};

function MonsterSpells({
  token, monster, spellById, targets, onCast,
}: {
  token: LiveToken;
  monster: Monster;
  spellById: Map<string, Spell>;
  targets: LiveToken[];
  onCast: (spellId: string, slotLevel: number, targetTokenIds: string[]) => void;
}) {
  const [openSpellId, setOpenSpellId] = useState<string | null>(null);
  const slotsMax = token.spellSlotsMax ?? monster.spellSlots?.max ?? [];
  const slotsCur = token.spellSlotsCurrent ?? slotsMax;
  const abilityName = monster.spellcastingAbility
    ? SAVE_ABILITY_GEN[monster.spellcastingAbility]
    : undefined;

  const known = (monster.spells ?? [])
    .map((id) => spellById.get(id))
    .filter((s): s is Spell => Boolean(s))
    .sort((a, b) => a.level - b.level || a.nameRu.localeCompare(b.nameRu));
  if (known.length === 0) return null;

  return (
    <div className="dm-field">
      <label><Sparkles size={13} /> Заклинания{abilityName ? ` (${abilityName})` : ''}</label>
      {slotsMax.some((n) => n > 0) && (
        <div className="dm-slot-pips">
          {slotsMax.map((max, idx) =>
            max > 0 ? (
              <span key={idx} className="dm-dim">
                {idx + 1} ур.: {slotsCur[idx] ?? 0}/{max}
              </span>
            ) : null,
          )}
        </div>
      )}
      {known.map((spell) => {
        const isCantrip = spell.level === 0;
        const hasSlot = isCantrip
          || slotsMax.some((_, i) => i + 1 >= spell.level && (slotsCur[i] ?? 0) > 0);
        return (
          <MonsterSpellRow
            key={spell.id}
            spell={spell}
            slotsMax={slotsMax}
            slotsCur={slotsCur}
            targets={targets}
            hasSlot={hasSlot}
            open={openSpellId === spell.id}
            onToggle={() => setOpenSpellId(openSpellId === spell.id ? null : spell.id)}
            onCast={(slotLevel, ids) => onCast(spell.id, slotLevel, ids)}
          />
        );
      })}
    </div>
  );
}

function MonsterSpellRow({
  spell, slotsMax, slotsCur, targets, hasSlot, open, onToggle, onCast,
}: {
  spell: Spell;
  slotsMax: number[];
  slotsCur: number[];
  targets: LiveToken[];
  hasSlot: boolean;
  open: boolean;
  onToggle: () => void;
  onCast: (slotLevel: number, targetTokenIds: string[]) => void;
}) {
  const isCantrip = spell.level === 0;
  const [slotLevel, setSlotLevel] = useState(Math.max(spell.level, 1));
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const needsTargets = spell.effectType === 'attack' || spell.effectType === 'save' || spell.heals === true;
  const multi = spell.targeting === 'area';

  const availableSlots: number[] = [];
  if (!isCantrip) {
    for (let lvl = spell.level; lvl <= Math.max(spell.level, slotsMax.length); lvl++) {
      if ((slotsCur[lvl - 1] ?? 0) > 0) availableSlots.push(lvl);
    }
  }
  const canCast = hasSlot && (!needsTargets || targetIds.length > 0);

  return (
    <div className="dm-monster-spell">
      <button className="dm-spell-head" onClick={onToggle} disabled={!isCantrip && !hasSlot}>
        <span>{spell.nameRu}</span>
        <span className="dm-dim">{isCantrip ? 'Заговор' : `${spell.level} ур.`}</span>
      </button>
      {open && (
        <div className="dm-spell-body anim-fade-in">
          {!isCantrip && (
            <div className="dm-hp-btns">
              {Array.from({ length: Math.max(0, slotsMax.length - spell.level + 1) }, (_, i) => spell.level + i).map((lvl) => (
                <button
                  key={lvl}
                  className={`dm-btn${slotLevel === lvl ? ' dm-btn-active' : ''}`}
                  disabled={(slotsCur[lvl - 1] ?? 0) <= 0}
                  onClick={() => setSlotLevel(lvl)}
                >
                  {lvl} ур. ({slotsCur[lvl - 1] ?? 0})
                </button>
              ))}
            </div>
          )}
          {needsTargets ? (
            <div className="dm-target-picks">
              {targets.map((t) => (
                <label key={t.id} className={`dm-target-pick${targetIds.includes(t.id) ? ' on' : ''}`}>
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    checked={targetIds.includes(t.id)}
                    onChange={() =>
                      setTargetIds((cur) =>
                        multi
                          ? cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]
                          : [t.id],
                      )
                    }
                  />
                  {t.name || 'Безымянный'}
                  <span className="dm-dim"> {t.currentHp}/{t.maxHp}</span>
                </label>
              ))}
            </div>
          ) : null}
          <button
            className="primary dm-wide"
            disabled={!canCast}
            onClick={() => {
              onCast(isCantrip ? 0 : slotLevel, needsTargets ? targetIds : []);
              setTargetIds([]);
              onToggle();
            }}
          >
            <Zap size={13} /> Сотворить{isCantrip ? '' : ` (${slotLevel} ур.)`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Строка очереди спасбросков ─────────────────────────────────────────────

function SaveQueueRow({
  request, onResolve,
}: {
  request: SaveRequest;
  onResolve: (req: SaveRequest, rolledValue?: number) => void;
}) {
  const [value, setValue] = useState('');
  const parsed = parseInt(value, 10);
  return (
    <div className="dm-save-row">
      <div className="dm-save-info">
        <strong>{request.rollerName}</strong>{' '}
        <span className="dm-dim">
          ({SAVE_ABILITY_GEN[request.ability]} {fmtMod(request.bonus)}), Сл {request.dc}
          {request.halfOnSuccess ? ' · половина при успехе' : ''}
        </span>
        {request.spellName && (
          <div className="dm-dim">
            от «{request.spellName}» ({request.sourceName}) · урон {request.pendingDamage.total}
          </div>
        )}
      </div>
      <div className="dm-save-actions">
        <button className="primary" onClick={() => onResolve(request)}>
          <Dices size={13} /> Кинуть
        </button>
        <input
          type="number"
          min={1}
          max={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && Number.isFinite(parsed)) onResolve(request, parsed);
          }}
          placeholder="д20"
          style={{ width: 60 }}
        />
        <button
          className="dm-btn"
          disabled={!Number.isFinite(parsed)}
          onClick={() => onResolve(request, parsed)}
        >
          Вписать
        </button>
      </div>
      {!request.rollerIsDm && (
        <div className="dm-dim dm-save-fallback">
          спасбросок персонажа — ждём игрока; можете вписать за него
        </div>
      )}
    </div>
  );
}

// ─── Кошелёк персонажа у мастера: выдать / изъять ───────────────────────────

const COIN_CURS: Currency[] = ['cp', 'sp', 'gp', 'pp'];

function DmCoinPurse({
  character, onPatch,
}: {
  character: Character | undefined;
  onPatch: (patch: Partial<Character>) => void;
}) {
  const [amount, setAmount] = useState('10');
  const [cur, setCur] = useState<Currency>('gp');
  if (!character) return null;
  const coins = character.coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 };
  const n = Math.max(0, Math.round(Number(amount) || 0));

  const apply = (sign: 1 | -1) => {
    if (n === 0) return;
    const next = { ...coins, [cur]: Math.max(0, coins[cur] + sign * n) };
    onPatch({ coins: next });
  };

  return (
    <div className="dm-field">
      <label><Coins size={13} /> Кошелёк</label>
      <CoinPurse coins={coins} />
      <div className="dm-save-actions" style={{ marginTop: 6 }}>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 70 }}
        />
        <select value={cur} onChange={(e) => setCur(e.target.value as Currency)}>
          {COIN_CURS.map((c) => (
            <option key={c} value={c}>{COIN_META[c].short}</option>
          ))}
        </select>
        <button className="dm-btn" onClick={() => apply(1)}>
          <Plus size={13} /> Выдать
        </button>
        <button className="dm-btn dm-danger" onClick={() => apply(-1)}>
          <Minus size={13} /> Изъять
        </button>
      </div>
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
