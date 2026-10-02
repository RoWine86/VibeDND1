// ─── Библиотека приключений: список, создание, редактирование, удаление,
// запуск сессии из приключения ───────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Map as MapIcon, NotebookPen, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { Adventure, SessionState } from '@vibednd/shared';
import { api } from '../api';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export default function AdventureLibrary() {
  const navigate = useNavigate();
  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [sessionFor, setSessionFor] = useState<Adventure | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Adventure[]>('/adventures')
      .then((list) => {
        setAdventures(list);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    try {
      const adv = await api.post<Adventure>('/adventures', { name });
      navigate(`/adventures/${adv.id}/edit`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async (adv: Adventure) => {
    if (
      !window.confirm(
        `Удалить приключение «${adv.name}» вместе с картами, токенами и заметками? Действие необратимо.`,
      )
    ) {
      return;
    }
    try {
      await api.del(`/adventures/${adv.id}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openStartSession = (adv: Adventure) => {
    setSessionFor(adv);
    setSessionName(`${adv.name} — ${new Date().toLocaleDateString('ru-RU')}`);
  };

  const startSession = async () => {
    const name = sessionName.trim();
    if (!sessionFor || !name || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = await api.post<SessionState>('/sessions', {
        adventureId: sessionFor.id,
        name,
      });
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page anim-fade-in">
      <div className="lib-head">
        <h1>
          <BookOpen size={26} /> Приключения
        </h1>
        <button
          className="primary"
          onClick={() => {
            setCreating(true);
            setNewName('');
          }}
        >
          <Plus size={15} style={{ verticalAlign: -3 }} /> Создать
        </button>
      </div>

      {error && <div className="error-box">Ошибка: {error}</div>}

      {adventures.length === 0 && !error && (
        <div className="empty-state">
          <h2>Приключений пока нет</h2>
          <p>Создайте приключение: добавьте карты, расставьте токены и напишите заметки сцен.</p>
        </div>
      )}

      <div className="lib-grid">
        {adventures.map((adv) => (
          <div className="card" key={adv.id}>
            <div className="card-body">
              <div className="card-title">{adv.name}</div>
              {adv.source && <div className="card-sub">Источник: {adv.source}</div>}
              {adv.description && (
                <div className="card-sub" style={{ whiteSpace: 'pre-line' }}>
                  {adv.description}
                </div>
              )}
              <div className="card-sub">
                <MapIcon size={12} style={{ verticalAlign: -2 }} /> Карт: {adv.maps.length} · Токенов:{' '}
                {adv.tokens.length} · Заметок: {adv.notes.length}
              </div>
              <div className="card-sub">Изменено: {formatDate(adv.updatedAt)}</div>
            </div>
            <div className="card-actions">
              <button className="primary" onClick={() => openStartSession(adv)}>
                <Play size={13} /> Начать сессию
              </button>
              <Link to={`/adventures/${adv.id}/edit`}>
                <button>
                  <Pencil size={13} /> Редактировать
                </button>
              </Link>
              <button className="danger" onClick={() => void remove(adv)}>
                <Trash2 size={13} /> Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setCreating(false);
          }}
        >
          <div
            className="modal"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h2>Новое приключение</h2>
            <div className="form-field">
              <label>Название</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Например: Затерянные копи Фанделвера"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                }}
              />
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setCreating(false);
                }}
                disabled={busy}
              >
                Отмена
              </button>
              <button className="primary" onClick={() => void create()} disabled={busy || !newName.trim()}>
                {busy ? 'Создание…' : 'Создать и редактировать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionFor && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setSessionFor(null);
          }}
        >
          <div
            className="modal"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h2>Начать сессию</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 12 }}>
              <NotebookPen size={13} style={{ verticalAlign: -2 }} /> Приключение: {sessionFor.name}
            </p>
            <div className="form-field">
              <label>Название сессии</label>
              <input
                autoFocus
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void startSession();
                }}
              />
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setSessionFor(null);
                }}
                disabled={busy}
              >
                Отмена
              </button>
              <button
                className="primary"
                onClick={() => void startSession()}
                disabled={busy || !sessionName.trim()}
              >
                {busy ? 'Запуск…' : 'Начать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
