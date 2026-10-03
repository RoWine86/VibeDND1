// ─── Телефонный экран игрока: /player/:sessionId/:characterId? ──────────────
// По QR-ссылке (/player/:sessionId) игрок выбирает своего персонажа; в адресе
// с id персонажа открывается его лист. Связь — по WebSocket: снимок сессии,
// лист персонажа, лог бросков. Кубы кидает сервер (rollDice), изменения
// персонажа идут через characterPatch — сервер авторитетен.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen, Dices, Heart, Package, Sword, User, Users, Zap,
} from 'lucide-react';
import {
  ABILITIES, ABILITY_NAMES_RU, CONDITION_NAMES_RU, abilityModifier, canEquip,
  characterLevel, classNameRu, modifierText, proficiencyBonus, usedHands,
} from '@vibednd/shared';
import type {
  AttackEntry, Character, CharacterClass, DiceLogEntry, Item,
  ServerMsg, SessionState, Spell,
} from '@vibednd/shared';
import { api } from '../api';
import { SessionSocket } from '../ws';
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
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionState | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]); // мой лист / партия
  const [items, setItems] = useState<Item[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [fatal, setFatal] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<Tab>('sheet');
  const sockRef = useRef<SessionSocket | null>(null);
  const toastTimer = useRef<number>(0);

  const me = useMemo(
    () => characters.find((c) => c.id === characterId) ?? null,
    [characters, characterId],
  );

  // Справочники (нужны и на экране выбора персонажа)
  useEffect(() => {
    api.get<CharacterClass[]>('/entities/class').then(setClasses).catch(() => undefined);
    api.get<Spell[]>('/entities/spell').then(setSpells).catch(() => undefined);
  }, []);

  // Подключение к сессии
  useEffect(() => {
    if (!sessionId) return;
    const sock = new SessionSocket('player', sessionId, characterId);
    sockRef.current = sock;
    const off = sock.onMessage((msg: ServerMsg) => {
      switch (msg.type) {
        case 'snapshot':
          setSession(msg.session);
          setCharacters(msg.characters);
          if (!characterId) sock.send({ type: 'requestItems' });
          break;
        case 'items':
          setItems(msg.items);
          break;
        case 'characterUpdated':
          setCharacters((chs) => {
            const rest = chs.filter((c) => c.id !== msg.character.id);
            return [...rest, msg.character];
          });
          break;
        case 'diceLog':
          if (msg.entry.hidden) break;
          setSession((s) => (s ? { ...s, diceLog: [...s.diceLog.slice(-19), msg.entry] } : s));
          break;
        case 'combat':
          setSession((s) => (s ? { ...s, combat: msg.combat } : s));
          break;
        case 'tokenUpsert':
          setSession((s) => {
            if (!s) return s;
            if (msg.token.hidden) return s;
            const rest = s.tokens.filter((t) => t.id !== msg.token.id);
            return { ...s, tokens: [...rest, msg.token] };
          });
          break;
        case 'tokenRemoved':
          setSession((s) => (s ? { ...s, tokens: s.tokens.filter((t) => t.id !== msg.tokenId) } : s));
          break;
        case 'error':
          setFatal(msg.message);
          break;
      }
    });
    return () => {
      off();
      sock.close();
      sockRef.current = null;
    };
  }, [sessionId, characterId]);

  const patchMe = (patch: Partial<Character>) => {
    if (!characterId) return;
    sockRef.current?.send({ type: 'characterPatch', characterId, patch });
  };

  const roll = (label: string, formula: string) => {
    sockRef.current?.send({ type: 'rollDice', label, formula });
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
          patchMe={patchMe}
          roll={roll}
        />
      </main>

      {toast && <div className="player-toast anim-fade-in">{toast}</div>}
      {combat.active && (
        <div className="player-combat-banner">
          Бой, раунд {combat.round} · ход: {combat.entries[combat.currentIndex]?.name ?? '—'}
        </div>
      )}
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
  patchMe: (patch: Partial<Character>) => void;
  roll: (label: string, formula: string) => void;
}) {
  const { tab, me, log, items, spells, classesById, patchMe, roll } = p;
  const prof = proficiencyBonus(characterLevel(me));

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
                <div className="player-attack-btns">
                  <button onClick={() => roll(`Атака: ${a.name}`, `1d20+${a.attackBonus}`)}>Атака</button>
                  <button onClick={() => roll(`Урон: ${a.name}`, `${a.damageDice}${a.damageBonus ? `+${a.damageBonus}` : ''}`)}>Урон</button>
                </div>
              </div>
            ))}
          </section>
        )}

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
    const spellScore = cls?.spellcastingAbility ? me.abilityScores[cls.spellcastingAbility] : 10;
    const dc = 8 + prof + abilityModifier(spellScore);
    const atk = prof + abilityModifier(spellScore);
    return (
      <div className="anim-fade-in">
        <section className="player-panel">
          <h2><BookOpen size={16} /> Заклинания</h2>
          {cls?.spellcastingAbility && (
            <p className="player-dim">
              СЛ {dc} · атака {atk >= 0 ? `+${atk}` : atk} · базовая характеристика: {ABILITY_NAMES_RU[cls.spellcastingAbility]}
            </p>
          )}
          {me.spellSlotsMax.length > 0 && (
            <div className="player-slots">
              {me.spellSlotsMax.map((max, lvl) =>
                max > 0 ? (
                  <span key={lvl} className="player-dim">
                    {lvl + 1} ур.: {me.spellSlotsCurrent[lvl] ?? 0}/{max}
                  </span>
                ) : null,
              )}
            </div>
          )}
          {known.length === 0 ? (
            <p className="player-dim">Заклинаний нет.</p>
          ) : (
            known.map((s) => <SpellRow key={s.id} spell={s} atk={atk} onCast={roll} />)
          )}
        </section>
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

// ─── Строка заклинания с раскрытием описания ────────────────────────────────

function SpellRow({ spell, atk, onCast }: { spell: Spell; atk: number; onCast: (label: string, formula: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="player-spell">
      <button className="player-spell-head" onClick={() => setOpen((v) => !v)}>
        <span>{spell.nameRu}</span>
        <span className="player-dim">
          {spell.level === 0 ? 'Заговор' : `${spell.level} ур.`} · {spell.castingTime}
        </span>
      </button>
      {open && (
        <div className="player-spell-body anim-fade-in">
          <SpellDetails spell={spell} showHeader={false} />
          <button onClick={() => onCast(`Заклинание: ${spell.nameRu}`, `1d20${atk >= 0 ? '+' : ''}${atk}`)}>
            <Zap size={13} /> Сотворить (атака {atk >= 0 ? `+${atk}` : atk})
          </button>
        </div>
      )}
    </div>
  );
}
