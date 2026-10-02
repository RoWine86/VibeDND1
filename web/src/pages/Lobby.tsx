// ─── Главная (/): три плитки-раздела и список активных сессий ───────────────

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Library, Map as MapIcon, Swords, Users } from 'lucide-react';
import type { SessionState } from '@vibednd/shared';
import { api } from '../api';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export default function Lobby() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<SessionState[]>('/sessions')
      .then((list) => {
        setSessions(list);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="page lobby anim-fade-in">
      <div className="lobby-hero">
        <h1>VibeDND</h1>
        <p>Живая игра в D&D 2024 за одним столом: общая доска, консоль мастера и телефоны игроков.</p>
      </div>

      <div className="lobby-tiles">
        <Link to="/characters" className="lobby-tile">
          <Users size={40} />
          <h2>Персонажи</h2>
          <p>Библиотека героев: создание по правилам D&D 2024, повышение уровней, листы персонажей.</p>
        </Link>
        <Link to="/adventures" className="lobby-tile">
          <BookOpen size={40} />
          <h2>Приключения</h2>
          <p>Шаблоны игр: карты с калибровкой сетки, токены монстров и НПС, заметки и арты сцен.</p>
        </Link>
        <Link to="/entities/monster" className="lobby-tile">
          <Library size={40} />
          <h2>Справочник</h2>
          <p>База контента: монстры, заклинания и предметы — создание и редактирование.</p>
        </Link>
        <Link to="/dm" className="lobby-tile">
          <Swords size={40} />
          <h2>Сессии</h2>
          <p>Запущенные игры. Консоль мастера: токены, туман войны, инициатива, броски и HP.</p>
        </Link>
      </div>

      <div className="session-panel">
        <h2>
          <MapIcon size={17} style={{ verticalAlign: -3 }} /> Активные сессии ({sessions.length})
        </h2>
        {error && <div className="error-box">Ошибка загрузки сессий: {error}</div>}
        {!error && sessions.length === 0 && (
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            Нет запущенных сессий — начните одну из библиотеки приключений.
          </p>
        )}
        <div className="lobby-session-list">
          {sessions.map((s) => (
            <Link to={`/session/${s.id}`} className="lobby-session-row" key={s.id}>
              <div>
                <div>{s.name}</div>
                <div className="party-sub">
                  Обновлена {formatDate(s.updatedAt)} · Партия: {s.characterIds.length} · Токенов:{' '}
                  {s.tokens.length}
                </div>
              </div>
              <span style={{ color: 'var(--gold)', fontSize: 18 }}>→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
