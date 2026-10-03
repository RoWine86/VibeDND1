// ─── Хаб запущенной сессии (/session/:id): ссылка и QR для игроков, партия
// (добавление из библиотеки по WebSocket), переходы в консоль мастера и на
// доску, список карт приключения ─────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BookOpen,
  Copy,
  Map as MapIcon,
  MonitorPlay,
  Plus,
  Swords,
  UserMinus,
  Users,
} from 'lucide-react';
import type { Adventure, Character, SessionState } from '@vibednd/shared';
import { SessionSocket } from '../ws';
import { api } from '../api';

const QR_API = 'https://api.qrserver.com/v1/create-qr-code/';

export default function SessionPage() {
  const { id = '' } = useParams();
  const [session, setSession] = useState<SessionState | null>(null);
  const [party, setParty] = useState<Character[]>([]);
  const [library, setLibrary] = useState<Character[]>([]);
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [joinUrl, setJoinUrl] = useState('');
  const [pickedCharId, setPickedCharId] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const sockRef = useRef<SessionSocket | null>(null);

  // Живое состояние сессии по WebSocket + ссылка входа и библиотека персонажей
  useEffect(() => {
    if (!id) return;
    const sock = new SessionSocket('dm', id);
    sockRef.current = sock;
    const off = sock.onMessage((msg) => {
      if (msg.type === 'snapshot') {
        setSession(msg.session);
        setParty(msg.characters);
      } else if (msg.type === 'characterUpdated') {
        setParty((list) => {
          const rest = list.filter((c) => c.id !== msg.character.id);
          return [...rest, msg.character];
        });
      } else if (msg.type === 'error') {
        setError(msg.message);
      }
    });
    api
      .get<{ url: string }>(`/sessions/${id}/join-info`)
      .then((info) => setJoinUrl(info.url))
      .catch(() => setJoinUrl(''));
    api
      .get<Character[]>('/characters')
      .then(setLibrary)
      .catch((e: Error) => setError(e.message));
    return () => {
      off();
      sock.close();
      sockRef.current = null;
    };
  }, [id]);

  // Шаблон приключения — для списка карт
  useEffect(() => {
    if (!session?.adventureId) return;
    api
      .get<Adventure>(`/adventures/${session.adventureId}`)
      .then(setAdventure)
      .catch(() => setAdventure(null));
  }, [session?.adventureId]);

  const addCharacter = () => {
    if (!pickedCharId || !sockRef.current) return;
    sockRef.current.send({ type: 'sessionAddCharacter', characterId: pickedCharId });
    setPickedCharId('');
  };

  const removeCharacter = (characterId: string) => {
    sockRef.current?.send({ type: 'sessionRemoveCharacter', characterId });
  };

  const copyLink = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Не удалось скопировать ссылку — выделите её вручную');
    }
  };

  if (!session) {
    return (
      <div className="page anim-fade-in">
        <p style={{ color: 'var(--text-dim)' }}>Подключение к сессии…</p>
      </div>
    );
  }

  const available = library.filter((c) => !session.characterIds.includes(c.id));

  return (
    <div className="page anim-fade-in">
      <div className="lib-head">
        <h1>
          <Swords size={26} /> {session.name}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/dm">
            <button className="primary">
              <BookOpen size={14} style={{ verticalAlign: -2 }} /> Консоль мастера
            </button>
          </Link>
          <Link to={`/board/${session.id}`}>
            <button>
              <MonitorPlay size={14} style={{ verticalAlign: -2 }} /> Открыть доску
            </button>
          </Link>
        </div>
      </div>

      {error && <div className="error-box">Ошибка: {error}</div>}

      <div className="session-cols">
        <div>
          <div className="session-panel">
            <h2>
              <Users size={17} style={{ verticalAlign: -3 }} /> Партия ({party.length})
            </h2>
            {party.length === 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                Добавьте персонажей игроков из библиотеки — они появятся на доске и в консоли.
              </p>
            )}
            {party.map((c) => (
              <div className="party-row" key={c.id}>
                <div>
                  <div>{c.name}</div>
                  <div className="party-sub">
                    Игрок: {c.playerName || '—'} · HP {c.currentHp}/{c.maxHp}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Link to={`/characters/${c.id}/edit`}>
                    <button>Лист</button>
                  </Link>
                  <button className="danger" onClick={() => removeCharacter(c.id)}>
                    <UserMinus size={13} />
                  </button>
                </div>
              </div>
            ))}
            <div className="party-add">
              <select value={pickedCharId} onChange={(e) => setPickedCharId(e.target.value)}>
                <option value="">— Выбрать персонажа из библиотеки —</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.playerName || 'без игрока'})
                  </option>
                ))}
              </select>
              <button className="primary" onClick={addCharacter} disabled={!pickedCharId}>
                <Plus size={13} /> Добавить
              </button>
            </div>
            {library.length === 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 8 }}>
                Библиотека пуста — сначала создайте персонажей в разделе «Персонажи».
              </p>
            )}
          </div>

          <div className="session-panel">
            <h2>
              <MapIcon size={17} style={{ verticalAlign: -3 }} /> Карты приключения
            </h2>
            {!adventure && <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Загрузка карт…</p>}
            {adventure && adventure.maps.length === 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                В приключении нет карт.{' '}
                <Link to={`/adventures/${adventure.id}/edit`} style={{ color: 'var(--gold-bright)' }}>
                  Открыть редактор
                </Link>
              </p>
            )}
            <div className="map-list">
              {adventure?.maps.map((m) => (
                <div className="map-row" key={m.id}>
                  {m.imagePath ? (
                    <img src={m.imagePath} alt={m.name} />
                  ) : (
                    <div className="map-row-empty">—</div>
                  )}
                  <div>
                    <div>{m.name || 'Без названия'}</div>
                    <div className="party-sub">
                      сетка {m.grid.cols}×{m.grid.rows}
                      {session.activeMapId === m.id ? ' · активна на доске' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="session-panel">
          <h2>Подключение игроков</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            Игроки открывают ссылку с телефона в той же Wi-Fi сети или сканируют QR-код.
          </p>
          {joinUrl && (
            <div className="qr-box">
              <img
                src={`${QR_API}?size=200x200&bgcolor=ffffff&color=14101c&data=${encodeURIComponent(joinUrl)}`}
                alt="QR-код для входа игроков"
                width={200}
                height={200}
              />
              <div className="join-url">{joinUrl}</div>
              <button onClick={() => void copyLink()}>
                <Copy size={13} /> {copied ? 'Скопировано!' : 'Скопировать ссылку'}
              </button>
            </div>
          )}
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 14 }}>
            QR-код также показывается на доске, пока не начался бой.
          </p>
        </div>
      </div>
    </div>
  );
}
