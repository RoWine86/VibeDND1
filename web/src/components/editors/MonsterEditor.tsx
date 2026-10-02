// ─── Редактор монстра: форма ↔ тип Monster, сохранение в /api/entities ──────

import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { Ability, AttackEntry, Monster, SkillKey } from '@vibednd/shared';
import { ABILITIES, ABILITY_NAMES_RU, SKILL_NAMES_RU } from '@vibednd/shared';
import { api } from '../../api';

interface NameDesc {
  name: string;
  description: string;
}

interface Props {
  /** Заполнено при редактировании существующего монстра */
  initial?: Monster;
  /** Вызывается после успешного сохранения (сервер вернул сущность с id) */
  onSaved: (monster: Monster) => void;
  onCancel: () => void;
}

function emptyMonster(): Monster {
  return {
    id: '',
    nameRu: '',
    nameEn: '',
    size: 'Средний',
    type: '',
    alignment: '',
    armorClass: 10,
    hitPoints: 10,
    hitDice: '',
    speed: '30 фт.',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    senses: '',
    languages: '',
    challengeRating: '0',
    traits: [],
    actions: [],
    attacks: [],
  };
}

function emptyAttack(): AttackEntry {
  return { name: '', attackBonus: 0, damageDice: '1d6', damageBonus: 0, damageType: '' };
}

export default function MonsterEditor({ initial, onSaved, onCancel }: Props) {
  const [m, setM] = useState<Monster>(() => initial ?? emptyMonster());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) setM(initial);
  }, [initial]);

  const set = <K extends keyof Monster>(key: K, value: Monster[K]) => {
    setM((prev) => ({ ...prev, [key]: value }));
  };

  const setAbility = (ab: Ability, value: number) => {
    setM((prev) => ({ ...prev, abilities: { ...prev.abilities, [ab]: value } }));
  };

  const num = (raw: string, fallback = 0): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const save = async () => {
    if (!m.nameRu.trim()) {
      setError('Укажите название на русском.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload: Monster = { ...m, nameRu: m.nameRu.trim() };
      if (!payload.id) delete (payload as Partial<Monster>).id;
      const saved = await api.post<Monster>('/entities/monster', payload);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // ── Списки «черты / действия» ──

  const renderNameDescList = (
    key: 'traits' | 'actions',
    title: string,
  ) => {
    const list = m[key];
    const update = (idx: number, patch: Partial<NameDesc>) => {
      const next = list.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry));
      set(key, next);
    };
    const removeEntry = (idx: number) => {
      set(key, list.filter((_, i) => i !== idx));
    };
    return (
      <div className="form-field">
        <label>{title}</label>
        {list.map((entry, idx) => (
          <div key={idx} className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ flex: 1 }}
                value={entry.name}
                placeholder="Название"
                onChange={(e) => update(idx, { name: e.target.value })}
              />
              <button className="danger" onClick={() => removeEntry(idx)} title="Удалить">
                <Trash2 size={13} />
              </button>
            </div>
            <textarea
              style={{ marginTop: 6, width: '100%' }}
              rows={2}
              value={entry.description}
              placeholder="Описание"
              onChange={(e) => update(idx, { description: e.target.value })}
            />
          </div>
        ))}
        <div>
          <button onClick={() => set(key, [...list, { name: '', description: '' }])}>
            <Plus size={13} /> Добавить
          </button>
        </div>
      </div>
    );
  };

  // ── Атаки (AttackEntry) ──

  const updateAttack = (idx: number, patch: Partial<AttackEntry>) => {
    set(
      'attacks',
      m.attacks.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    );
  };

  // ── Спасброски и навыки (частичные записи) ──

  const renderOptionalNumbers = <K extends string>(
    title: string,
    record: Partial<Record<K, number>> | undefined,
    keys: readonly K[],
    names: Record<K, string>,
    onChange: (next: Partial<Record<K, number>> | undefined) => void,
  ) => {
    const rec: Partial<Record<K, number>> = record ?? {};
    const setEntry = (k: K, raw: string) => {
      if (raw === '') {
        const next = { ...rec };
        delete next[k];
        onChange(Object.keys(next).length > 0 ? next : undefined);
      } else {
        onChange({ ...rec, [k]: num(raw) });
      }
    };
    return (
      <div className="form-field">
        <label>{title} (пусто — нет бонуса)</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
          {keys.map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ flex: 1, color: 'var(--text-dim)' }}>{names[k]}</span>
              <input
                style={{ width: 60 }}
                type="number"
                value={rec[k] ?? ''}
                onChange={(e) => setEntry(k, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{initial ? 'Редактирование монстра' : 'Новый монстр'}</h2>

      {error && <div className="error-box">Ошибка: {error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="form-field">
          <label>Название (рус.)</label>
          <input value={m.nameRu} onChange={(e) => set('nameRu', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Название (англ.)</label>
          <input value={m.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Размер</label>
          <input value={m.size} onChange={(e) => set('size', e.target.value)} placeholder="Средний" />
        </div>
        <div className="form-field">
          <label>Тип</label>
          <input value={m.type} onChange={(e) => set('type', e.target.value)} placeholder="Гуманоид" />
        </div>
        <div className="form-field">
          <label>Мировоззрение</label>
          <input value={m.alignment} onChange={(e) => set('alignment', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Класс брони</label>
          <input
            type="number"
            value={m.armorClass}
            onChange={(e) => set('armorClass', num(e.target.value))}
          />
        </div>
        <div className="form-field">
          <label>Хиты</label>
          <input
            type="number"
            value={m.hitPoints}
            onChange={(e) => set('hitPoints', num(e.target.value))}
          />
        </div>
        <div className="form-field">
          <label>Кости хитов</label>
          <input
            value={m.hitDice}
            onChange={(e) => set('hitDice', e.target.value)}
            placeholder="2d8+4"
          />
        </div>
        <div className="form-field">
          <label>Скорость</label>
          <input
            value={m.speed}
            onChange={(e) => set('speed', e.target.value)}
            placeholder="30 фт., летая 60 фт."
          />
        </div>
        <div className="form-field">
          <label>Показатель опасности</label>
          <input
            value={m.challengeRating}
            onChange={(e) => set('challengeRating', e.target.value)}
            placeholder="1/2"
          />
        </div>
        <div className="form-field">
          <label>Чувства</label>
          <input
            value={m.senses}
            onChange={(e) => set('senses', e.target.value)}
            placeholder="Тёмное зрение 60 фт., пасс. Восприятие 12"
          />
        </div>
        <div className="form-field">
          <label>Языки</label>
          <input
            value={m.languages}
            onChange={(e) => set('languages', e.target.value)}
            placeholder="Общий, гоблинский"
          />
        </div>
      </div>

      <div className="form-field">
        <label>Характеристики</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
          {ABILITIES.map((ab) => (
            <label key={ab} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ flex: 1, color: 'var(--text-dim)' }}>{ABILITY_NAMES_RU[ab]}</span>
              <input
                style={{ width: 60 }}
                type="number"
                value={m.abilities[ab]}
                onChange={(e) => setAbility(ab, num(e.target.value, 10))}
              />
            </label>
          ))}
        </div>
      </div>

      {renderOptionalNumbers<Ability>(
        'Спасброски',
        m.savingThrows,
        ABILITIES,
        ABILITY_NAMES_RU,
        (next) => set('savingThrows', next),
      )}
      {renderOptionalNumbers<SkillKey>(
        'Навыки',
        m.skills,
        Object.keys(SKILL_NAMES_RU) as SkillKey[],
        SKILL_NAMES_RU,
        (next) => set('skills', next),
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
        <div className="form-field">
          <label>Сопротивления урону</label>
          <input
            value={m.damageResistances ?? ''}
            onChange={(e) => set('damageResistances', e.target.value || undefined)}
          />
        </div>
        <div className="form-field">
          <label>Иммунитеты к урону</label>
          <input
            value={m.damageImmunities ?? ''}
            onChange={(e) => set('damageImmunities', e.target.value || undefined)}
          />
        </div>
        <div className="form-field">
          <label>Иммунитеты к состояниям</label>
          <input
            value={m.conditionImmunities ?? ''}
            onChange={(e) => set('conditionImmunities', e.target.value || undefined)}
          />
        </div>
      </div>

      <div className="form-field">
        <label>Путь к изображению</label>
        <input
          value={m.imagePath ?? ''}
          onChange={(e) => set('imagePath', e.target.value || undefined)}
          placeholder="/uploads/monsters/goblin.png"
        />
      </div>

      {renderNameDescList('traits', 'Черты')}
      {renderNameDescList('actions', 'Действия')}

      <div className="form-field">
        <label>Атаки</label>
        {m.attacks.map((a, idx) => (
          <div key={idx} className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                style={{ flex: 2, minWidth: 140 }}
                value={a.name}
                placeholder="Название (Короткий меч)"
                onChange={(e) => updateAttack(idx, { name: e.target.value })}
              />
              <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Бонус атаки{' '}
                <input
                  style={{ width: 60 }}
                  type="number"
                  value={a.attackBonus}
                  onChange={(e) => updateAttack(idx, { attackBonus: num(e.target.value) })}
                />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Кость{' '}
                <input
                  style={{ width: 70 }}
                  value={a.damageDice}
                  placeholder="1d6"
                  onChange={(e) => updateAttack(idx, { damageDice: e.target.value })}
                />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Бонус урона{' '}
                <input
                  style={{ width: 60 }}
                  type="number"
                  value={a.damageBonus}
                  onChange={(e) => updateAttack(idx, { damageBonus: num(e.target.value) })}
                />
              </label>
              <input
                style={{ flex: 1, minWidth: 100 }}
                value={a.damageType}
                placeholder="Тип урона (колющий)"
                onChange={(e) => updateAttack(idx, { damageType: e.target.value })}
              />
              <button
                className="danger"
                onClick={() => set('attacks', m.attacks.filter((_, i) => i !== idx))}
                title="Удалить атаку"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        <div>
          <button onClick={() => set('attacks', [...m.attacks, emptyAttack()])}>
            <Plus size={13} /> Добавить атаку
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={() => void save()} disabled={busy}>
          <Save size={14} /> {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </div>
  );
}
