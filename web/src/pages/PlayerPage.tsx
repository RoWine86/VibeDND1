// ─── Телефонный экран игрока: /player/:sessionId/:characterId? ──────────────
// По QR-ссылке (/player/:sessionId) игрок выбирает своего персонажа; в адресе
// с id персонажа открывается его лист. Связь — по WebSocket: снимок сессии,
// лист персонажа, лог бросков. Кубы кидает сервер (rollDice), изменения
// персонажа идут через characterPatch — сервер авторитетен.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen, Dices, Heart, Moon, Package, ShieldAlert, Skull, Sun, Sword,
  Target, User, Users, Zap,
} from 'lucide-react';
import {
  ABILITIES, ABILITY_NAMES_RU, CONDITION_NAMES_RU, abilityModifier, canEquip,
  characterLevel, classNameRu, modifierText, proficiencyBonus, usedHands,
} from '@vibednd/shared';
import type {
  Ability, AttackEntry, Character, CharacterClass, ClientMsg, CombatEvent,
  DiceLogEntry, Item, LiveToken, SaveRequest, SessionState, Spell,
} from '@vibednd/shared';
import { api } from '../api';
import { SessionProvider, useSessionStore } from '../sessionStore';
import SpellDetails from '../components/SpellDetails';
import '../styles/player.css';

type Tab = 'sheet' | 'combat' | 'spells' | 'inventory' | 'party';

const TABS: { id: Tab; label: string; Icon: typeof User }[] = [
  { id: 'sheet', label: 'Лист', Icon: User },
  { id: 'combat', label: 'Бой', Icon: Sword },
  { id: 'spells', label: 'Магия', Icon: BookOpen },
  { id: 'inventory', label: 'Вещи', Icon: Package },
  { id: 'party', label: 'Партия', Icon: Users },
];

const CATEGORY_RU: Record<Item['category'], string> = {
  weapon: 'Оружие', armor: 'Броня', gear: 'Снаряжение', tool: 'Инструмент',
  magic: 'Магия', consumable: 'Расходник',
};

export default function PlayerPage() {
  const { sessionId = '', characterId } = useParams();
  return (
    // без key: при выборе персонажа стор переживает переподключение сокета,
    // чтобы уже загруженные items не пропадали (прежнее поведение)
    <SessionProvider role="player" sessionId={sessionId} characterId={characterId}>
      <PlayerContent sessionId={sessionId} characterId={characterId} />
    </SessionProvider>
  );
}

function PlayerContent({
  sessionId,
  characterId,
}: {
  sessionId: string;
  characterId?: string;
}) {
  const navigate = useNavigate();
  const {
    session, characters, items, combatEvents, saveRequests, error, send,
  } = useSessionStore();

  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<Tab>('sheet');
  const toastTimer = useRef<number>(0);
  const fatal = error;

  const me = useMemo(
    () => characters.find((c) => c.id === characterId) ?? null,
    [characters, characterId],
  );

  // Справочники (нужны и на экране выбора персонажа)
  useEffect(() => {
    api.get<CharacterClass[]>('/entities/class').then(setClasses).catch(() => undefined);
    api.get<Spell[]>('/entities/spell').then(setSpells).catch(() => undefined);
  }, []);

  const patchMe = (patch: Partial<Character>) => {
    if (!characterId) return;
    send({ type: 'characterPatch', characterId, patch });
  };

  const roll = (label: string, formula: string) => {
    send({ type: 'rollDice', label, formula });
  };

  const flash = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2000);
  };

  const classesById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  // ── Экран ошибки ──
  if (fatal) {
    return (
      <div className="player-root player-empty">
        <h1>Не удалось войти</h1>
        <p>{fatal}</p>
        {characterId && (
          <button className="primary" onClick={() => navigate(`/player/${sessionId}`)}>
            Выбрать другого персонажа
          </button>
        )}
      </div>
    );
  }

  // ── Выбор персонажа (QR-ссылка без id) ──
  if (!characterId) {
    const party = session
      ? session.characterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is Character => Boolean(c))
      : [];
    return (
      <div className="player-root player-empty">
        <h1>{session?.name ?? 'Подключение…'}</h1>
        {session ? (
          party.length > 0 ? (
            <div className="player-pick">
              <p className="player-dim">Кто вы?</p>
              {party.map((c) => (
                <button
                  key={c.id}
                  className="player-pick-btn"
                  onClick={() => navigate(`/player/${sessionId}/${c.id}`)}
                >
                  {c.portraitPath ? (
                    <img src={c.portraitPath} alt="" />
                  ) : (
                    <span className="player-pick-initial">{(c.name || '?')[0]}</span>
                  )}
                  <span className="player-pick-name">{c.name}</span>
                  <span className="player-dim">
                    {c.classes.map((cl) => `${classNameRu(cl.classId, classesById)} ${cl.level}`).join(' / ')}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="player-dim">
              Мастер ещё не добавил персонажей в партию. Когда добавит — они появятся здесь сами.
            </p>
          )
        ) : (
          <p className="player-dim">Подключаемся к столу…</p>
        )}
      </div>
    );
  }

  // ── Ждём свой лист ──
  if (!session || !me) {
    return (
      <div className="player-root player-empty">
        <h1>Загрузка…</h1>
        <p className="player-dim">Получаем лист персонажа от мастера.</p>
      </div>
    );
  }

  const combat = session.combat;
  const log = session.diceLog.filter((e) => !e.hidden).slice(-20).reverse();

  return (
    <div className="player-root">
      <header className="player-head">
        <div className="player-id">
          {me.portraitPath ? (
            <img className="player-portrait" src={me.portraitPath} alt="" />
          ) : (
            <span className="player-portrait player-portrait-empty">{(me.name || '?')[0]}</span>
          )}
          <div>
            <div className="player-name">{me.name}</div>
            <div className="player-dim">
              {me.classes.map((cl) => `${classNameRu(cl.classId, classesById)} ${cl.level}`).join(' / ')}
            </div>
          </div>
        </div>
        <HpBar
          current={me.currentHp}
          max={me.maxHp}
          temp={me.tempHp}
          onChange={(v) => {
            patchMe({ currentHp: v });
            flash(v > me.currentHp ? 'Лечение' : 'Урон');
          }}
        />
      </header>

      <nav className="player-tabs">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`player-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      <main className="player-main">
        <TabContent
          tab={tab}
          me={me}
          session={session}
          log={log}
          items={items}
          spells={spells}
          classesById={classesById}
          characters={characters}
          combatEvents={combatEvents}
          patchMe={patchMe}
          roll={roll}
          send={send}
          flash={flash}
        />
      </main>

      {/* Очередь спасбросков — большая карточка поверх всего */}
      {saveRequests.filter((r) => r.characterId === characterId).map((req) => (
        <SaveRequestModal key={req.id} request={req} send={send} />
      ))}

      {toast && <div className="player-toast anim-fade-in">{toast}</div>}
      {combat.active && (
        <div className="player-combat-banner">
          Бой, раунд {combat.round} · ход: {combat.entries[combat.currentIndex]?.name ?? '—'}
        </div>
      )}
    </div>
  );
}

// ─── Карточка спасброска ────────────────────────────────────────────────────

const SAVE_ABILITY_RU: Record<Ability, string> = {
  str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы',
};

function SaveRequestModal({
  request, send,
}: { request: SaveRequest; send: (msg: ClientMsg) => void }) {
  const [physical, setPhysical] = useState('');
  const [busy, setBusy] = useState(false);

  const rollVirtual = () => {
    setBusy(true);
    send({ type: 'saveRoll', requestId: request.id });
  };
  const submitPhysical = () => {
    const value = parseInt(physical, 10);
    if (!Number.isFinite(value)) return;
    setBusy(true);
    send({ type: 'saveResult', requestId: request.id, value });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal player-save-modal anim-fade-in">
        <div className="player-save-icon"><ShieldAlert size={30} /></div>
        <h2>Спасбросок {SAVE_ABILITY_RU[request.ability]}</h2>
        <p className="player-save-dc">Сл {request.dc}</p>
        {request.spellName && (
          <p className="player-dim">
            {request.sourceName} · «{request.spellName}»
            {request.halfOnSuccess ? ' · половина урона при успехе' : ''}
          </p>
        )}
        <p className="player-dim">
          Ваш бонус: {request.bonus >= 0 ? `+${request.bonus}` : request.bonus}
          {request.pendingDamage.total > 0 && ` · урон при провале: ${request.pendingDamage.total}`}
        </p>
        <button className="primary player-save-roll" onClick={rollVirtual} disabled={busy}>
          <Dices size={18} /> Кинуть (виртуальный d20)
        </button>
        <div className="player-save-physical">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={physical}
            disabled={busy}
            onChange={(e) => setPhysical(e.target.value)}
            placeholder="Результат физического кубика (1–20)"
          />
          <button onClick={submitPhysical} disabled={busy || !physical.trim()}>
            Вписать
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Полоса хитов ───────────────────────────────────────────────────────────

function HpBar({
  current, max, temp, onChange,
}: { current: number; max: number; temp: number; onChange: (v: number) => void }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className="player-hp">
      <div className="player-hp-bar" title={`Хиты: ${current}/${max}`}>
        <div className="player-hp-fill" style={{ width: `${pct}%` }} />
        <span className="player-hp-text">
          <Heart size={13} /> {current}/{max}{temp > 0 ? ` (+${temp})` : ''}
        </span>
      </div>
      <div className="player-hp-buttons">
        <button aria-label="Урон" onClick={() => onChange(Math.max(0, current - 1))}>−1</button>
        <button aria-label="Лечение" onClick={() => onChange(Math.min(max, current + 1))}>+1</button>
      </div>
    </div>
  );
}

// ─── Контент вкладок ────────────────────────────────────────────────────────

function TabContent(p: {
  tab: Tab;
  me: Character;
  session: SessionState;
  log: DiceLogEntry[];
  items: Item[];
  spells: Spell[];
  classesById: Map<string, CharacterClass>;
  characters: Character[];
  combatEvents: CombatEvent[];
  patchMe: (patch: Partial<Character>) => void;
  roll: (label: string, formula: string) => void;
  send: (msg: ClientMsg) => void;
  flash: (text: string) => void;
}) {
  const { tab, me, log, items, spells, classesById, combatEvents, patchMe, roll, send, flash } = p;
  const prof = proficiencyBonus(characterLevel(me));

  // Цели на активной карте из стора сессии. Скрытые токены игроку не
  // приходят — фильтруем на всякий случай. Враги — для атак и боевых
  // заклинаний, союзники (токены персонажей) — для лечения.
  const mapTokens = useMemo(
    () => p.session.tokens.filter((t) => t.mapId === p.session.activeMapId && !t.hidden),
    [p.session.tokens, p.session.activeMapId],
  );
  const enemies = mapTokens.filter((t) => t.kind !== 'player');
  const allies = mapTokens.filter((t) => t.kind === 'player');

  if (tab === 'sheet') {
    return (
      <div className="anim-fade-in">
        <section className="player-panel">
          <h2>Характеристики</h2>
          <div className="player-abilities">
            {ABILITIES.map((ab) => {
              const score = me.abilityScores[ab] + (me.backgroundBonuses[ab] ?? 0);
              return (
                <button
                  key={ab}
                  className="player-ability"
                  onClick={() => roll(`Проверка: ${ABILITY_NAMES_RU[ab]}`, `1d20${modifierText(score)}`)}
                >
                  <span className="player-ability-name">{ABILITY_NAMES_RU[ab]}</span>
                  <span className="player-ability-score">{score}</span>
                  <span className="player-ability-mod">{modifierText(score)}</span>
                </button>
              );
            })}
          </div>
          <p className="player-dim player-tap-hint">Нажмите на характеристику — бросок проверки.</p>
        </section>

        <section className="player-panel">
          <h2>Состояния</h2>
          <div className="player-conditions">
            {(Object.keys(CONDITION_NAMES_RU) as (keyof typeof CONDITION_NAMES_RU)[]).map((key) => {
              const active = me.conditions.includes(key);
              return (
                <button
                  key={key}
                  className={`player-chip${active ? ' active' : ''}`}
                  onClick={() =>
                    patchMe({
                      conditions: active
                        ? me.conditions.filter((c) => c !== key)
                        : [...me.conditions, key],
                    })
                  }
                >
                  {CONDITION_NAMES_RU[key]}
                </button>
              );
            })}
          </div>
        </section>

        <section className="player-panel">
          <h2>Спасброски от смерти</h2>
          <div className="player-deathsaves">
            <span>Успехи: {[0, 1, 2].map((i) => (
              <button
                key={`s${i}`}
                aria-label={`Успех ${i + 1}`}
                className={`player-pip${me.deathSaves.successes > i ? ' ok' : ''}`}
                onClick={() =>
                  patchMe({ deathSaves: { ...me.deathSaves, successes: me.deathSaves.successes === i + 1 ? i : i + 1 } })
                }
              />
            ))}</span>
            <span>Провалы: {[0, 1, 2].map((i) => (
              <button
                key={`f${i}`}
                aria-label={`Провал ${i + 1}`}
                className={`player-pip${me.deathSaves.failures > i ? ' bad' : ''}`}
                onClick={() =>
                  patchMe({ deathSaves: { ...me.deathSaves, failures: me.deathSaves.failures === i + 1 ? i : i + 1 } })
                }
              />
            ))}</span>
          </div>
        </section>
      </div>
    );
  }

  if (tab === 'combat') {
    const attacks: AttackEntry[] = me.attacks ?? [];
    return (
      <div className="anim-fade-in">
        <section className="player-panel">
          <h2><Dices size={16} /> Броски</h2>
          <div className="player-dice-row">
            {['1d20', '2d6', '1d8', '1d6', '1d4'].map((f) => (
              <button key={f} onClick={() => roll('Свободный бросок', f)}>{f}</button>
            ))}
          </div>
          <button className="primary" onClick={() => roll('Инициатива', `1d20${modifierText(me.abilityScores.dex)}`)}>
            Бросить инициативу
          </button>
        </section>

        {attacks.length > 0 && (
          <section className="player-panel">
            <h2><Sword size={16} /> Атаки</h2>
            {attacks.map((a, i) => (
              <div key={i} className="player-attack">
                <div className="player-attack-name">
                  {a.name}{' '}
                  <span className="player-dim">
                    +{a.attackBonus} · {a.damageDice}{a.damageBonus ? `+${a.damageBonus}` : ''} {a.damageType}
                  </span>
                </div>
                <TargetPicker
                  targets={enemies}
                  emptyHint="На карте нет видимых целей."
                  actionLabel="Атаковать"
                  groupKey={`atk-${i}`}
                  onPick={(tokenIds) => {
                    send({
                      type: 'attackWith',
                      attackerCharacterId: me.id,
                      attackName: a.name,
                      targetTokenId: tokenIds[0]!,
                    });
                    flash(`Атака: ${a.name}`);
                  }}
                />
              </div>
            ))}
          </section>
        )}

        <CombatEventFeed events={combatEvents} me={me} />

        <section className="player-panel">
          <h2>Лог бросков</h2>
          {log.length === 0 ? (
            <p className="player-dim">Бросков пока не было.</p>
          ) : (
            log.map((e) => (
              <div key={e.id} className="player-log-row">
                <span className="player-log-name">{e.rollerName}</span>
                <span className="player-dim">{e.label}</span>
                <span className="player-log-total">{e.total}</span>
              </div>
            ))
          )}
        </section>
      </div>
    );
  }

  if (tab === 'spells') {
    const known = (me.knownSpells ?? [])
      .map((id) => spells.find((s) => s.id === id))
      .filter((s): s is Spell => Boolean(s))
      .sort((a, b) => a.level - b.level || a.nameRu.localeCompare(b.nameRu));
    const cls = me.classes[0] ? classesById.get(me.classes[0].classId) : undefined;
    const spellScore = cls?.spellcastingAbility
      ? me.abilityScores[cls.spellcastingAbility] + (me.backgroundBonuses[cls.spellcastingAbility] ?? 0)
      : 10;
    const dc = 8 + prof + abilityModifier(spellScore);
    const atk = prof + abilityModifier(spellScore);
    // клик по пипке: по заполненной — потратить её и правее, по пустой —
    // восстановить до неё (сервер авторитетен, значения приходят из стора)
    const toggleSlot = (lvlIdx: number, pipIdx: number) => {
      const current = [...me.spellSlotsCurrent];
      const cur = current[lvlIdx] ?? 0;
      current[lvlIdx] = pipIdx < cur
        ? pipIdx
        : Math.min(me.spellSlotsMax[lvlIdx] ?? 0, pipIdx + 1);
      patchMe({ spellSlotsCurrent: current });
    };
    return (
      <div className="anim-fade-in">
        <section className="player-panel">
          <h2><BookOpen size={16} /> Заклинания</h2>
          {cls?.spellcastingAbility && (
            <p className="player-dim">
              СЛ {dc} · атака {atk >= 0 ? `+${atk}` : atk} · базовая характеристика: {ABILITY_NAMES_RU[cls.spellcastingAbility]}
            </p>
          )}
          {me.spellSlotsMax.some((n) => n > 0) && (
            <div className="player-slot-pips">
              {me.spellSlotsMax.map((max, lvlIdx) => {
                if (max <= 0) return null;
                const cur = me.spellSlotsCurrent[lvlIdx] ?? 0;
                return (
                  <div className="player-slot-row" key={lvlIdx}>
                    <span className="player-slot-lvl">{lvlIdx + 1} ур.</span>
                    <span className="slot-pips">
                      {Array.from({ length: max }, (_, pip) => (
                        <button
                          key={pip}
                          className={`slot-pip${pip < cur ? ' full' : ''}`}
                          onClick={() => toggleSlot(lvlIdx, pip)}
                          title={pip < cur ? 'Потратить ячейку' : 'Восстановить ячейку'}
                        />
                      ))}
                    </span>
                    <span className="player-dim">{cur}/{max}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="player-rest-row">
            <button
              onClick={() => send({ type: 'rest', characterId: me.id, kind: 'short' })}
              disabled={me.hitDiceCurrent <= 0}
            >
              <Sun size={15} /> Короткий отдых
            </button>
            <button onClick={() => send({ type: 'rest', characterId: me.id, kind: 'long' })}>
              <Moon size={15} /> Длинный отдых
            </button>
          </div>
          {known.length === 0 ? (
            <p className="player-dim">Заклинаний нет.</p>
          ) : (
            known.map((s) => (
              <SpellRow
                key={s.id}
                spell={s}
                me={me}
                dc={dc}
                enemies={enemies}
                allies={allies}
                onCast={(slotLevel, targetTokenIds) => {
                  send({
                    type: 'castSpell',
                    characterId: me.id,
                    spellId: s.id,
                    slotLevel,
                    targetTokenIds,
                  });
                  flash(`«${s.nameRu}» сотворено`);
                }}
              />
            ))
          )}
        </section>
        <CombatEventFeed events={combatEvents} me={me} />
      </div>
    );
  }

  if (tab === 'inventory') {
    const inv = me.inventory ?? [];
    const equipped = inv.filter((e) => e.equipped);
    const bag = inv.filter((e) => !e.equipped);
    const byId = new Map(items.map((it) => [it.id, it]));
    const toggle = (itemId: string, equip: boolean) =>
      patchMe({ inventory: inv.map((e) => (e.itemId === itemId ? { ...e, equipped: equip } : e)) });
    const remove = (itemId: string) =>
      patchMe({ inventory: inv.filter((e) => e.itemId !== itemId) });
    const add = (itemId: string) => {
      if (!itemId) return;
      if (inv.some((e) => e.itemId === itemId)) {
        patchMe({ inventory: inv.map((e) => (e.itemId === itemId ? { ...e, quantity: e.quantity + 1 } : e)) });
      } else {
        patchMe({ inventory: [...inv, { itemId, quantity: 1, equipped: false }] });
      }
    };
    const row = (e: { itemId: string; quantity: number; equipped: boolean }) => {
      const it = byId.get(e.itemId);
      const blocked = !e.equipped && it ? !canEquip(it, inv, byId).ok : false;
      const reason = !e.equipped && it ? canEquip(it, inv, byId).reason : undefined;
      return (
        <div key={e.itemId} className="player-item-row">
          <span className="player-item-name">{it?.nameRu ?? e.itemId} ×{e.quantity}</span>
          <span className="player-item-actions">
            {e.equipped ? (
              <button onClick={() => toggle(e.itemId, false)}>Снять</button>
            ) : (
              <button disabled={blocked} title={reason} onClick={() => toggle(e.itemId, true)}>Надеть</button>
            )}
            <button className="danger" onClick={() => remove(e.itemId)}>×</button>
          </span>
        </div>
      );
    };
    return (
      <div className="anim-fade-in">
        <section className="player-panel">
          <h2><Package size={16} /> На мне</h2>
          <p className="player-dim" style={{ marginBottom: 8 }}>Руки заняты: {usedHands(inv, byId)}/2.</p>
          {equipped.length === 0 ? <p className="player-dim">Ничего не надето.</p> : equipped.map(row)}
        </section>
        <section className="player-panel">
          <h2>Рюкзак</h2>
          {bag.length === 0 ? <p className="player-dim">Пусто.</p> : bag.map(row)}
          <div className="player-item-add">
            <select defaultValue="" onChange={(e) => { add(e.target.value); e.target.value = ''; }}>
              <option value="" disabled>Добавить предмет…</option>
              {[...items]
                .sort((a, b) => a.nameRu.localeCompare(b.nameRu))
                .map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.nameRu} · {CATEGORY_RU[it.category]}
                  </option>
                ))}
            </select>
          </div>
        </section>
      </div>
    );
  }

  // party
  const party = p.session.characterIds
    .map((id) => p.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));
  return (
    <div className="anim-fade-in">
      <section className="player-panel">
        <h2><Users size={16} /> Партия</h2>
        {party.length === 0 && <p className="player-dim">Партия пуста.</p>}
        {party.map((c) => (
          <div key={c.id} className="player-party-row">
            <span className="player-item-name">
              {c.name}{c.id === me.id ? ' (вы)' : ''}
            </span>
            <span className="player-dim">{c.currentHp}/{c.maxHp} HP</span>
          </div>
        ))}
      </section>
    </div>
  );
}

// ─── Выбор цели ─────────────────────────────────────────────────────────────

/**
 * Выбор цели из токенов: одна (select) или несколько (чекбоксы) для area.
 * Кнопка действия появляется только когда цель выбрана — крупные тач-цели.
 */
function TargetPicker({
  targets, emptyHint, actionLabel, multi = false, groupKey, disabled = false, onPick,
}: {
  targets: LiveToken[];
  emptyHint: string;
  actionLabel: string;
  multi?: boolean;
  /** уникальное имя radio-группы (у разных атак цели могут совпадать) */
  groupKey: string;
  disabled?: boolean;
  onPick: (tokenIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  if (targets.length === 0) return <p className="player-dim">{emptyHint}</p>;

  const toggle = (id: string) => {
    if (multi) {
      setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    } else {
      setSelected([id]);
    }
  };

  return (
    <div className="player-targets">
      {targets.map((t) => (
        <label key={t.id} className={`player-target${selected.includes(t.id) ? ' selected' : ''}`}>
          <input
            type={multi ? 'checkbox' : 'radio'}
            name={`target-${groupKey}`}
            checked={selected.includes(t.id)}
            onChange={() => toggle(t.id)}
          />
          <span className="player-target-name">{t.name || 'Безымянный'}</span>
          {t.maxHp > 0 && (
            <span className="player-dim">{t.currentHp}/{t.maxHp}</span>
          )}
        </label>
      ))}
      {selected.length > 0 && (
        <button
          className="primary player-target-go"
          disabled={disabled}
          onClick={() => onPick(selected)}
        >
          <Target size={14} /> {actionLabel}{selected.length > 1 ? ` (${selected.length})` : ''}
        </button>
      )}
    </div>
  );
}

// ─── Строка заклинания: ячейка + цели + каст ────────────────────────────────

function SpellRow({
  spell, me, dc, enemies, allies, onCast,
}: {
  spell: Spell;
  me: Character;
  dc: number;
  enemies: LiveToken[];
  allies: LiveToken[];
  onCast: (slotLevel: number, targetTokenIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const isCantrip = spell.level === 0;
  const needsTargets = spell.effectType === 'attack' || spell.effectType === 'save' || spell.heals === true;
  const targets = spell.heals ? allies : enemies;

  // доступные ячейки: уровень не ниже уровня заклинания и есть свободные
  const slotOptions: number[] = [];
  if (!isCantrip) {
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      if ((me.spellSlotsCurrent[lvl - 1] ?? 0) > 0) slotOptions.push(lvl);
    }
  }
  const [slotLevel, setSlotLevel] = useState(spell.level);
  const effectiveSlot = isCantrip ? 0 : slotLevel;
  const canCast = isCantrip || slotOptions.includes(effectiveSlot);

  return (
    <div className="player-spell">
      <button className="player-spell-head" onClick={() => setOpen((v) => !v)}>
        <span>{spell.nameRu}</span>
        <span className="player-dim">
          {isCantrip ? 'Заговор' : `${spell.level} ур.`} · {spell.castingTime}
        </span>
      </button>
      {open && (
        <div className="player-spell-body anim-fade-in">
          <SpellDetails spell={spell} showHeader={false} />

          {/* выбор уровня ячейки (заговоры — без ячеек) */}
          {!isCantrip && (
            <div className="form-field" style={{ marginTop: 10 }}>
              <label>Уровень ячейки</label>
              <div className="player-slot-choice">
                {Array.from({ length: 9 - spell.level + 1 }, (_, i) => spell.level + i).map((lvl) => {
                  const free = me.spellSlotsCurrent[lvl - 1] ?? 0;
                  return (
                    <button
                      key={lvl}
                      className={`player-slot-btn${slotLevel === lvl ? ' active' : ''}`}
                      disabled={free <= 0}
                      onClick={() => setSlotLevel(lvl)}
                    >
                      {lvl} ур.
                      <span className="player-dim"> ×{free}</span>
                    </button>
                  );
                })}
              </div>
              {!canCast && (
                <p className="player-dim player-warn">Нет свободных ячеек нужного уровня — отдохните.</p>
              )}
            </div>
          )}

          {/* цели: мультивыбор для area, одна для single; лечебные — по союзникам */}
          {needsTargets ? (
            <div style={{ marginTop: 10 }}>
              <label className="player-dim" style={{ display: 'block', marginBottom: 6 }}>
                {spell.heals ? 'Кого лечить' : spell.targeting === 'area' ? 'Цели (можно несколько)' : 'Цель'}
                {spell.effectType === 'save' && !spell.heals && spell.saveAbility
                  ? ` · спас ${SAVE_ABILITY_RU[spell.saveAbility]}, Сл ${dc}${spell.halfOnSuccess ? ' (половина при успехе)' : ''}`
                  : ''}
              </label>
              <TargetPicker
                targets={targets}
                multi={spell.targeting === 'area'}
                emptyHint={spell.heals ? 'На карте нет видимых союзников.' : 'На карте нет видимых целей.'}
                actionLabel={`Сотворить${isCantrip ? '' : ` (ячейка ${effectiveSlot} ур.)`}`}
                groupKey={`spell-${spell.id}`}
                disabled={!canCast}
                onPick={(ids) => onCast(effectiveSlot, ids)}
              />
            </div>
          ) : (
            // служебные заклинания (щит, доспехи мага, маскировка…) — без целей
            <button
              className="primary"
              style={{ marginTop: 10 }}
              disabled={!canCast}
              onClick={() => onCast(effectiveSlot, [])}
            >
              <Zap size={13} /> Сотворить{isCantrip ? '' : ` (ячейка ${effectiveSlot} ур.)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Лента событий боя ──────────────────────────────────────────────────────

const PHASE_ICON: Record<CombatEvent['phase'], string> = {
  cast: '✦',
  attack: '⚔',
  damage: '✸',
  heal: '✚',
  'save-request': '⛨',
  'save-result': '⛨',
  concentration: '◎',
  death: '☠',
  rest: '☾',
};

function CombatEventFeed({ events, me }: { events: CombatEvent[]; me: Character }) {
  const recent = events.slice(-15).reverse();
  if (recent.length === 0) return null;
  return (
    <section className="player-panel">
      <h2><Skull size={16} /> События боя</h2>
      {recent.map((e) => {
        const mine =
          e.sourceCharacterId === me.id || e.targetCharacterId === me.id;
        return (
          <div key={e.id} className={`player-event phase-${e.phase}${mine ? ' mine' : ''}`}>
            <span className="player-event-icon">{PHASE_ICON[e.phase]}</span>
            <span className="player-event-text">{e.text}</span>
          </div>
        );
      })}
    </section>
  );
}
