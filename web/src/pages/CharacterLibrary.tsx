// ─── Библиотека персонажей: список, создание, редактирование, удаление ─────

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpCircle, Pencil, Plus, Shield, Trash2, Users } from 'lucide-react';
import { characterLevel } from '@vibednd/shared';
import type { Character, CharacterClass, Species } from '@vibednd/shared';
import { api } from '../api';
import '../styles/character.css';

export default function CharacterLibrary() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api.get<Character[]>('/characters'),
      api.get<CharacterClass[]>('/entities/class'),
      api.get<Species[]>('/entities/species'),
    ])
      .then(([chs, cls, sp]) => {
        setCharacters(chs);
        setClasses(cls);
        setSpecies(sp);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const remove = async (ch: Character) => {
    if (!window.confirm(`Удалить персонажа «${ch.name}»? Действие необратимо.`)) return;
    try {
      await api.del(`/characters/${ch.id}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const levelUp = (ch: Character) => {
    navigate(`/characters/${ch.id}/edit?levelup=1`);
  };

  const clsById = new Map(classes.map((c) => [c.id, c]));
  const spById = new Map(species.map((s) => [s.id, s]));

  return (
    <div className="char-page anim-fade-in">
      <div className="lib-head">
        <h1><Users size={26} /> Персонажи</h1>
        <Link to="/characters/new">
          <button className="primary"><Plus size={15} style={{ verticalAlign: -3 }} /> Создать</button>
        </Link>
      </div>

      {error && <div className="error-box">Ошибка: {error}</div>}

      {characters.length === 0 && !error && (
        <div className="empty-state">
          <h2>Библиотека пуста</h2>
          <p>Создайте первого героя — мастер проведёт вас по правилам D&D 2024.</p>
        </div>
      )}

      <div className="lib-grid">
        {characters.map((ch) => {
          const lvl = characterLevel(ch);
          const classLabel = ch.classes
            .map((c) => `${clsById.get(c.classId)?.nameRu ?? c.classId} ${c.level}`)
            .join(' / ');
          return (
            <div className="char-card" key={ch.id}>
              <div className="cc-top">
                <div className="cc-portrait">
                  {ch.portraitPath
                    ? <img src={ch.portraitPath} alt={ch.name} />
                    : <Shield size={26} />}
                </div>
                <div>
                  <div className="cc-name">{ch.name}</div>
                  <div className="cc-sub">Игрок: {ch.playerName || '—'}</div>
                  <div className="cc-sub">
                    {spById.get(ch.speciesId)?.nameRu ?? '—'} · {classLabel || '—'} · {lvl} ур.
                  </div>
                </div>
              </div>
              <div className="cc-actions">
                <Link to={`/characters/${ch.id}/edit`}>
                  <button><Pencil size={13} /> Редактировать</button>
                </Link>
                <button onClick={() => levelUp(ch)}>
                  <ArrowUpCircle size={13} /> Повысить уровень
                </button>
                <button className="danger" onClick={() => void remove(ch)}>
                  <Trash2 size={13} /> Удалить
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
