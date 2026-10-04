// ─── Редактор заклинания: форма ↔ тип Spell, сохранение в /api/entities ─────

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { Ability, CharacterClass, Spell, SpellSchool } from '@vibednd/shared';
import { ABILITIES, ABILITY_NAMES_RU } from '@vibednd/shared';
import { api } from '../../api';

const SCHOOL_NAMES_RU: Record<SpellSchool, string> = {
  abjuration: 'Ограждение',
  conjuration: 'Вызов',
  divination: 'Прорицание',
  enchantment: 'Очарование',
  evocation: 'Воплощение',
  illusion: 'Иллюзия',
  necromancy: 'Некромантия',
  transmutation: 'Преобразование',
};

const SCHOOLS = Object.keys(SCHOOL_NAMES_RU) as SpellSchool[];

const LEVEL_NAMES = (lvl: number) => (lvl === 0 ? 'Заговор' : `${lvl} уровень`);

// Оцифровка для боевого движка
const EFFECT_TYPE_NAMES_RU: Record<NonNullable<Spell['effectType']>, string> = {
  attack: 'Атака заклинанием',
  save: 'Спасбросок',
  utility: 'Без урона / служебное',
};
const TARGETING_NAMES_RU: Record<NonNullable<Spell['targeting']>, string> = {
  single: 'Одна цель',
  area: 'Область / несколько целей',
};
// Подсказки типов урона (список не ограничивает — поле свободное)
const DAMAGE_TYPE_HINTS = [
  'огонь', 'холод', 'электричество', 'звук', 'излучение', 'силовое поле',
  'некротический', 'кислота', 'яд', 'психический', 'дробящий', 'колющий', 'рубящий',
];

interface Props {
  initial?: Spell;
  onSaved: (spell: Spell) => void;
  onCancel: () => void;
}

function emptySpell(): Spell {
  return {
    id: '',
    nameRu: '',
    nameEn: '',
    level: 0,
    school: 'evocation',
    castingTime: 'Действие',
    range: '',
    components: '',
    duration: 'Мгновенная',
    concentration: false,
    ritual: false,
    description: '',
    classes: [],
  };
}

export default function SpellEditor({ initial, onSaved, onCancel }: Props) {
  const [s, setS] = useState<Spell>(() => initial ?? emptySpell());
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) setS(initial);
  }, [initial]);

  useEffect(() => {
    api
      .get<CharacterClass[]>('/entities/class')
      .then(setClasses)
      .catch(() => setClasses([]));
  }, []);

  const set = <K extends keyof Spell>(key: K, value: Spell[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
  };

  const toggleClass = (classId: string) => {
    set(
      'classes',
      s.classes.includes(classId)
        ? s.classes.filter((c) => c !== classId)
        : [...s.classes, classId],
    );
  };

  const save = async () => {
    if (!s.nameRu.trim()) {
      setError('Укажите название на русском.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload: Spell = { ...s, nameRu: s.nameRu.trim() };
      if (!payload.id) delete (payload as Partial<Spell>).id;
      const saved = await api.post<Spell>('/entities/spell', payload);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{initial ? 'Редактирование заклинания' : 'Новое заклинание'}</h2>

      {error && <div className="error-box">Ошибка: {error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="form-field">
          <label>Название (рус.)</label>
          <input value={s.nameRu} onChange={(e) => set('nameRu', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Название (англ.)</label>
          <input value={s.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Уровень</label>
          <select value={s.level} onChange={(e) => set('level', Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, lvl) => (
              <option key={lvl} value={lvl}>
                {LEVEL_NAMES(lvl)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Школа</label>
          <select value={s.school} onChange={(e) => set('school', e.target.value as SpellSchool)}>
            {SCHOOLS.map((school) => (
              <option key={school} value={school}>
                {SCHOOL_NAMES_RU[school]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Время накладывания</label>
          <input
            value={s.castingTime}
            onChange={(e) => set('castingTime', e.target.value)}
            placeholder="Действие"
          />
        </div>
        <div className="form-field">
          <label>Дистанция</label>
          <input
            value={s.range}
            onChange={(e) => set('range', e.target.value)}
            placeholder="60 футов"
          />
        </div>
        <div className="form-field">
          <label>Компоненты</label>
          <input
            value={s.components}
            onChange={(e) => set('components', e.target.value)}
            placeholder="В, С, М (…)"
          />
        </div>
        <div className="form-field">
          <label>Длительность</label>
          <input
            value={s.duration}
            onChange={(e) => set('duration', e.target.value)}
            placeholder="Концентрация, до 1 минуты"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={s.concentration}
            onChange={(e) => set('concentration', e.target.checked)}
          />
          Концентрация
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={s.ritual}
            onChange={(e) => set('ritual', e.target.checked)}
          />
          Ритуал
        </label>
      </div>

      <div className="form-field">
        <label>Описание</label>
        <textarea
          rows={6}
          value={s.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      {/* ── Оцифровка для боевого движка ── */}
      <h3 style={{ margin: '14px 0 8px' }}>Боевые данные</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="form-field">
          <label>Тип эффекта</label>
          <select
            value={s.effectType ?? ''}
            onChange={(e) =>
              set('effectType', e.target.value === '' ? undefined : (e.target.value as Spell['effectType']))
            }
          >
            <option value="">— не задан —</option>
            {(Object.keys(EFFECT_TYPE_NAMES_RU) as (keyof typeof EFFECT_TYPE_NAMES_RU)[]).map((k) => (
              <option key={k} value={k}>{EFFECT_TYPE_NAMES_RU[k]}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Выбор целей</label>
          <select
            value={s.targeting ?? ''}
            onChange={(e) =>
              set('targeting', e.target.value === '' ? undefined : (e.target.value as Spell['targeting']))
            }
          >
            <option value="">— не задан —</option>
            {(Object.keys(TARGETING_NAMES_RU) as (keyof typeof TARGETING_NAMES_RU)[]).map((k) => (
              <option key={k} value={k}>{TARGETING_NAMES_RU[k]}</option>
            ))}
          </select>
        </div>
        {s.effectType === 'save' && (
          <div className="form-field">
            <label>Характеристика спасброска</label>
            <select
              value={s.saveAbility ?? ''}
              onChange={(e) =>
                set('saveAbility', e.target.value === '' ? undefined : (e.target.value as Ability))
              }
            >
              <option value="">— не задана —</option>
              {ABILITIES.map((ab) => (
                <option key={ab} value={ab}>{ABILITY_NAMES_RU[ab]}</option>
              ))}
            </select>
          </div>
        )}
        {(s.heals || s.effectType === 'attack' || s.effectType === 'save') && (
          <div className="form-field">
            <label>{s.heals ? 'Кости лечения (без модификатора, например 2d8)' : 'Кости урона (например, 8d6)'}</label>
            <input
              value={s.damageDice ?? ''}
              onChange={(e) => set('damageDice', e.target.value)}
              placeholder={s.heals ? '2d8' : '8d6'}
            />
          </div>
        )}
        {!s.heals && (s.effectType === 'attack' || s.effectType === 'save') && (
          <div className="form-field">
            <label>Тип урона</label>
            <input
              value={s.damageType ?? ''}
              onChange={(e) => set('damageType', e.target.value)}
              placeholder="огонь"
              list="spell-damage-types"
            />
            <datalist id="spell-damage-types">
              {DAMAGE_TYPE_HINTS.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
        )}
        {s.effectType === 'attack' && (
          <div className="form-field">
            <label>Число попаданий/лучей</label>
            <input
              type="number"
              min={1}
              value={s.projectiles ?? ''}
              onChange={(e) =>
                set('projectiles', e.target.value === '' ? undefined : Number(e.target.value))
              }
              placeholder="1"
            />
          </div>
        )}
        <div className="form-field">
          <label>Upcast: прибавка за уровень ячейки выше базового</label>
          <input
            value={s.upcast?.perSlotLevel ?? ''}
            onChange={(e) =>
              set('upcast', e.target.value.trim() === '' ? undefined : { perSlotLevel: e.target.value.trim() })
            }
            placeholder="+1d6 / +1 цель / пусто, если нет"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 10, flexWrap: 'wrap' }}>
        {s.effectType === 'save' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={s.halfOnSuccess ?? false}
              onChange={(e) => set('halfOnSuccess', e.target.checked)}
            />
            Половина урона при успехе
          </label>
        )}
        {s.effectType === 'attack' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={s.autoHit ?? false}
              onChange={(e) => set('autoHit', e.target.checked)}
            />
            Автоматическое попадание
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={s.heals ?? false}
            onChange={(e) => set('heals', e.target.checked)}
          />
          Лечит, а не наносит урон
        </label>
      </div>

      <div className="form-field">
        <label>Классы (кому доступно)</label>
        {classes.length === 0 && (
          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Список классов не загружен — можно сохранить и без него.
          </span>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {classes.map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={s.classes.includes(c.id)}
                onChange={() => toggleClass(c.id)}
              />
              {c.nameRu}
            </label>
          ))}
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
