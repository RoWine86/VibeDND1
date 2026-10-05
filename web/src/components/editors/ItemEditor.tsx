// ─── Редактор предмета: форма ↔ тип Item, сохранение в /api/entities ────────

import { useEffect, useState } from 'react';
import { Save, X } from 'lucide-react';
import type { Ability, Currency, Item } from '@vibednd/shared';
import { ABILITIES, ABILITY_NAMES_RU } from '@vibednd/shared';
import { api } from '../../api';

type ItemCategory = Item['category'];

const CATEGORY_NAMES_RU: Record<ItemCategory, string> = {
  weapon: 'Оружие',
  armor: 'Броня',
  gear: 'Снаряжение',
  tool: 'Инструмент',
  magic: 'Магический предмет',
  consumable: 'Расходник',
};

const CATEGORIES = Object.keys(CATEGORY_NAMES_RU) as ItemCategory[];

interface Props {
  initial?: Item;
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

function emptyItem(): Item {
  return {
    id: '',
    nameRu: '',
    nameEn: '',
    category: 'gear',
    description: '',
  };
}

export default function ItemEditor({ initial, onSaved, onCancel }: Props) {
  const [item, setItem] = useState<Item>(() => initial ?? emptyItem());
  const [newProp, setNewProp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) setItem(initial);
  }, [initial]);

  const set = <K extends keyof Item>(key: K, value: Item[K]) => {
    setItem((prev) => ({ ...prev, [key]: value }));
  };

  const numOrUndef = (raw: string): number | undefined => {
    if (raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const addProperty = () => {
    const prop = newProp.trim();
    if (!prop) return;
    const props = item.properties ?? [];
    if (!props.includes(prop)) set('properties', [...props, prop]);
    setNewProp('');
  };

  const removeProperty = (prop: string) => {
    const next = (item.properties ?? []).filter((p) => p !== prop);
    set('properties', next.length > 0 ? next : undefined);
  };

  const save = async () => {
    if (!item.nameRu.trim()) {
      setError('Укажите название на русском.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload: Item = { ...item, nameRu: item.nameRu.trim() };
      if (!payload.id) delete (payload as Partial<Item>).id;
      const saved = await api.post<Item>('/entities/item', payload);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{initial ? 'Редактирование предмета' : 'Новый предмет'}</h2>

      {error && <div className="error-box">Ошибка: {error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="form-field">
          <label>Название (рус.)</label>
          <input value={item.nameRu} onChange={(e) => set('nameRu', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Название (англ.)</label>
          <input value={item.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Категория</label>
          <select
            value={item.category}
            onChange={(e) => set('category', e.target.value as ItemCategory)}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_NAMES_RU[cat]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Вес (фунты)</label>
          <input
            type="number"
            step="0.1"
            value={item.weight ?? ''}
            onChange={(e) => set('weight', numOrUndef(e.target.value))}
          />
        </div>
        <div className="form-field">
          <label>Стоимость</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              min={0}
              style={{ flex: 1 }}
              value={item.cost?.amount ?? ''}
              onChange={(e) => {
                const amount = e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value)));
                const currency = item.cost?.currency ?? 'gp';
                set('cost', amount == null ? undefined : { amount, currency });
              }}
              placeholder="10"
            />
            <select
              style={{ width: 84 }}
              value={item.cost?.currency ?? 'gp'}
              onChange={(e) => {
                const currency = e.target.value as Currency;
                set('cost', { amount: item.cost?.amount ?? 0, currency });
              }}
            >
              <option value="cp">мм</option>
              <option value="sp">см</option>
              <option value="gp">зм</option>
              <option value="pp">пм</option>
            </select>
          </div>
        </div>
        <div className="form-field" style={{ justifyContent: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={item.requiresAttunement ?? false}
              onChange={(e) =>
                set('requiresAttunement', e.target.checked ? true : undefined)
              }
            />
            Требует настройки
          </label>
        </div>
      </div>

      <div className="form-field">
        <label>Описание</label>
        <textarea
          rows={4}
          value={item.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      {item.category === 'weapon' && (
        <>
          <h3 style={{ marginBottom: 8 }}>Оружие</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
            <div className="form-field">
              <label>Кость урона</label>
              <input
                value={item.damageDice ?? ''}
                onChange={(e) => set('damageDice', e.target.value || undefined)}
                placeholder="1d8"
              />
            </div>
            <div className="form-field">
              <label>Тип урона</label>
              <input
                value={item.damageType ?? ''}
                onChange={(e) => set('damageType', e.target.value || undefined)}
                placeholder="Рубящий"
              />
            </div>
            <div className="form-field">
              <label>Характеристика атаки</label>
              <select
                value={item.weaponAbility ?? ''}
                onChange={(e) =>
                  set('weaponAbility', (e.target.value || undefined) as Ability | undefined)
                }
              >
                <option value="">—</option>
                {ABILITIES.map((ab) => (
                  <option key={ab} value={ab}>
                    {ABILITY_NAMES_RU[ab]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-field">
            <label>Свойства оружия</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ flex: 1 }}
                value={newProp}
                onChange={(e) => setNewProp(e.target.value)}
                placeholder="Например: Фехтовальное"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addProperty();
                  }
                }}
              />
              <button onClick={addProperty} disabled={!newProp.trim()}>
                Добавить
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {(item.properties ?? []).map((prop) => (
                <span
                  key={prop}
                  className="card-sub"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    border: '1px solid var(--border, #444)',
                    borderRadius: 6,
                    padding: '2px 8px',
                  }}
                >
                  {prop}
                  <X
                    size={12}
                    style={{ cursor: 'pointer' }}
                    onClick={() => removeProperty(prop)}
                  />
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {item.category === 'armor' && (
        <>
          <h3 style={{ marginBottom: 8 }}>Броня</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
            <div className="form-field">
              <label>Базовый КД</label>
              <input
                type="number"
                value={item.armorClassBase ?? ''}
                onChange={(e) => set('armorClassBase', numOrUndef(e.target.value))}
              />
            </div>
            <div className="form-field" style={{ justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={item.addDexToAC ?? false}
                  onChange={(e) => set('addDexToAC', e.target.checked ? true : undefined)}
                />
                Бонус Ловкости к КД
              </label>
            </div>
            <div className="form-field">
              <label>Макс. бонус Ловкости</label>
              <input
                type="number"
                value={item.maxDexBonus ?? ''}
                onChange={(e) => set('maxDexBonus', numOrUndef(e.target.value))}
                placeholder="Без ограничения — пусто"
              />
            </div>
          </div>
        </>
      )}

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
