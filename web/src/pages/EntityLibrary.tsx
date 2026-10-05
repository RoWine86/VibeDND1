// ─── Библиотека сущностей контента: монстры, заклинания, предметы ───────────
// Список по kind (/entities/:kind) с поиском, создание/редактирование/удаление
// через редакторы из components/editors.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Eye, Package, PawPrint, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import type { CharacterClass, Item, Monster, Spell } from '@vibednd/shared';
import { costText } from '@vibednd/shared';
import { api } from '../api';
import MonsterEditor from '../components/editors/MonsterEditor';
import SpellEditor from '../components/editors/SpellEditor';
import ItemEditor from '../components/editors/ItemEditor';
import SpellCard from '../components/SpellCard';
import { SPELL_SCHOOL_NAMES_RU } from '../components/SpellDetails';

type Kind = 'monster' | 'spell' | 'item';
type AnyEntity = Monster | Spell | Item;

const KIND_META: Record<
  Kind,
  { title: string; plural: string; createLabel: string; Icon: typeof PawPrint }
> = {
  monster: { title: 'Монстры', plural: 'монстров', createLabel: 'Новый монстр', Icon: PawPrint },
  spell: { title: 'Заклинания', plural: 'заклинаний', createLabel: 'Новое заклинание', Icon: Sparkles },
  item: { title: 'Предметы', plural: 'предметов', createLabel: 'Новый предмет', Icon: Package },
};

const SPELL_SCHOOL_RU = SPELL_SCHOOL_NAMES_RU;

const ITEM_CATEGORY_RU: Record<Item['category'], string> = {
  weapon: 'Оружие',
  armor: 'Броня',
  gear: 'Снаряжение',
  tool: 'Инструмент',
  magic: 'Магический предмет',
  consumable: 'Расходник',
};

function entitySubtitle(kind: Kind, e: AnyEntity): string {
  if (kind === 'monster') {
    const m = e as Monster;
    return `ПО ${m.challengeRating} · КД ${m.armorClass} · Хиты ${m.hitPoints} · ${m.type || '—'}`;
  }
  if (kind === 'spell') {
    const s = e as Spell;
    const lvl = s.level === 0 ? 'Заговор' : `${s.level} уровень`;
    const flags = [s.concentration ? 'концентрация' : '', s.ritual ? 'ритуал' : '']
      .filter(Boolean)
      .join(', ');
    return `${lvl} · ${SPELL_SCHOOL_RU[s.school]}${flags ? ` · ${flags}` : ''}`;
  }
  const it = e as Item;
  const bits = [ITEM_CATEGORY_RU[it.category]];
  if (it.cost) bits.push(costText(it.cost));
  if (it.damageDice) bits.push(`Урон ${it.damageDice}${it.damageType ? ` (${it.damageType})` : ''}`);
  if (it.armorClassBase != null) bits.push(`КД ${it.armorClassBase}`);
  return bits.join(' · ');
}

function isKind(value: string | undefined): value is Kind {
  return value === 'monster' || value === 'spell' || value === 'item';
}

export default function EntityLibrary() {
  const params = useParams<{ kind: string }>();
  const kind: Kind = isKind(params.kind) ? params.kind : 'monster';

  const [entities, setEntities] = useState<AnyEntity[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AnyEntity | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Spell | null>(null);

  const load = useCallback(() => {
    api
      .get<AnyEntity[]>(`/entities/${kind}`)
      .then((list) => {
        setEntities(list);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [kind]);

  useEffect(() => {
    setQuery('');
    setEditing(null);
    setCreating(false);
    load();
  }, [load]);

  useEffect(() => {
    api.get<CharacterClass[]>('/entities/class').then(setClasses).catch(() => setClasses([]));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) =>
        e.nameRu.toLowerCase().includes(q) ||
        e.nameEn.toLowerCase().includes(q),
    );
  }, [entities, query]);

  const remove = async (e: AnyEntity) => {
    if (!window.confirm(`Удалить «${e.nameRu}»? Действие необратимо.`)) return;
    try {
      await api.del(`/entities/${kind}/${e.id}`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const meta = KIND_META[kind];
  const editorOpen = creating || editing !== null;

  const editorHandlers = {
    onSaved: () => {
      setEditing(null);
      setCreating(false);
      load();
    },
    onCancel: () => {
      setEditing(null);
      setCreating(false);
    },
  };

  return (
    <div className="page anim-fade-in">
      <div className="lib-head">
        <h1>
          <meta.Icon size={26} /> {meta.title}
        </h1>
        {!editorOpen && (
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={15} style={{ verticalAlign: -3 }} /> {meta.createLabel}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(Object.keys(KIND_META) as Kind[]).map((k) => {
          const K = KIND_META[k];
          return (
            <Link key={k} to={`/entities/${k}`}>
              <button className={k === kind ? 'primary' : ''}>
                <K.Icon size={13} /> {K.title}
              </button>
            </Link>
          );
        })}
        <Link to="/" style={{ marginLeft: 'auto' }}>
          <button>
            <ArrowLeft size={13} /> В лобби
          </button>
        </Link>
      </div>

      {error && <div className="error-box">Ошибка: {error}</div>}

      {editorOpen && kind === 'monster' && (
        <MonsterEditor {...editorHandlers} initial={(editing as Monster | null) ?? undefined} />
      )}
      {editorOpen && kind === 'spell' && (
        <SpellEditor {...editorHandlers} initial={(editing as Spell | null) ?? undefined} />
      )}
      {editorOpen && kind === 'item' && (
        <ItemEditor {...editorHandlers} initial={(editing as Item | null) ?? undefined} />
      )}

      {!editorOpen && (
        <>
          <div className="form-field" style={{ maxWidth: 420 }}>
            <label>
              <Search size={12} style={{ verticalAlign: -2 }} /> Поиск по названию
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Начните вводить название…"
            />
          </div>

          {entities.length === 0 && !error && (
            <div className="empty-state">
              <h2>Пусто</h2>
              <p>
                <BookOpen size={13} style={{ verticalAlign: -2 }} /> В справочнике нет{' '}
                {meta.plural} — создайте первую запись.
              </p>
            </div>
          )}
          {entities.length > 0 && filtered.length === 0 && (
            <div className="empty-state">
              <h2>Ничего не найдено</h2>
              <p>Попробуйте изменить запрос.</p>
            </div>
          )}

          <div className="lib-grid">
            {filtered.map((e) => (
              <div className="card" key={e.id}>
                <div className="card-body">
                  <div className="card-title">{e.nameRu}</div>
                  {e.nameEn && <div className="card-sub">{e.nameEn}</div>}
                  <div className="card-sub">{entitySubtitle(kind, e)}</div>
                </div>
                <div className="card-actions">
                  {kind === 'spell' && (
                    <button onClick={() => setViewing(e as Spell)}>
                      <Eye size={13} /> Просмотр
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setCreating(false);
                      setEditing(e);
                    }}
                  >
                    <Pencil size={13} /> Редактировать
                  </button>
                  <button className="danger" onClick={() => void remove(e)}>
                    <Trash2 size={13} /> Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {viewing && (
        <SpellCard
          spell={viewing}
          classNames={viewing.classes.map((id) => classes.find((c) => c.id === id)?.nameRu ?? id)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
