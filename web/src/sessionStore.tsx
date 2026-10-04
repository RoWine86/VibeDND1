// ─── Единый стор сессии: WS-состояние для board / dm / player ───────────────
// SessionProvider владеет SessionSocket и сводит все ServerMsg в один редьюсер
// (раньше switch-обработка была скопирована в BoardPage / DmPage / PlayerPage).
// Страницы читают состояние через useSessionStore() и шлют команды через send();
// оптимистичные обновления мастера (движение токена, туман) тоже живут здесь.

import {
  createContext, useContext, useEffect, useMemo, useReducer, useRef,
} from 'react';
import type { ReactNode } from 'react';
import type {
  Character, ClientMsg, FogShape, Item, Role, ServerMsg, SessionState,
} from '@vibednd/shared';
import { SessionSocket } from './ws';

// Лог бросков не растёт бесконечно: мастер и доска хранят последние 50,
// телефон — последние 20 (лимиты прежних страничных switch'ей).
const DICE_LOG_LIMIT = 50;
const PLAYER_DICE_LOG_LIMIT = 20;

export interface SessionStoreState {
  role: Role;
  session: SessionState | null;
  characters: Character[];
  items: Item[];
  /** Текст последней WS-ошибки, '' — нет. Страницы трактуют её сами:
   *  доска показывает только «Сессия не найдена», телефон — любую. */
  error: string;
}

type Action =
  | { type: 'serverMsg'; msg: ServerMsg }
  // оптимистичные обновления мастера: применяются локально сразу, чтобы
  // перетаскивание токена и кисть тумана не дёргались в ожидании сервера
  | { type: 'optimisticMove'; tokenId: string; x: number; y: number }
  | { type: 'optimisticFog'; mapId: string; shape: FogShape; mode: 'reveal' | 'hide' };

function initialState(role: Role): SessionStoreState {
  return { role, session: null, characters: [], items: [], error: '' };
}

/** Изменить снимок сессии; если снимка ещё нет — проигнорировать. */
function patchSession(
  state: SessionStoreState,
  patch: (s: SessionState) => SessionState,
): SessionStoreState {
  return state.session ? { ...state, session: patch(state.session) } : state;
}

function applyServerMsg(state: SessionStoreState, msg: ServerMsg): SessionStoreState {
  const { role } = state;
  switch (msg.type) {
    case 'snapshot':
      return { ...state, session: msg.session, characters: msg.characters, error: '' };

    case 'tokenUpsert': {
      // В снимке скрытых токенов нет, но tokenUpsert рассылается всем:
      // доска и игроки убирают их из списка самостоятельно, мастер видит все.
      if (msg.token.hidden && role !== 'dm') {
        return patchSession(state, (s) => ({
          ...s,
          tokens: s.tokens.filter((t) => t.id !== msg.token.id),
        }));
      }
      return patchSession(state, (s) => ({
        ...s,
        tokens: [...s.tokens.filter((t) => t.id !== msg.token.id), msg.token],
      }));
    }
    case 'tokenRemoved':
      return patchSession(state, (s) => ({
        ...s,
        tokens: s.tokens.filter((t) => t.id !== msg.tokenId),
      }));

    case 'fogReveals':
      return patchSession(state, (s) => ({
        ...s,
        fogReveals: [
          ...s.fogReveals.filter((r) => r.mapId !== msg.mapId),
          ...msg.reveals.map((r) => ({ ...r, mapId: msg.mapId })),
        ],
      }));

    case 'strokeAdded':
      return patchSession(state, (s) => ({
        ...s,
        drawings: [...s.drawings.filter((d) => d.id !== msg.stroke.id), msg.stroke],
      }));
    case 'strokeRemoved':
      return patchSession(state, (s) => ({
        ...s,
        drawings: s.drawings.filter((d) => d.id !== msg.strokeId),
      }));
    case 'drawingsCleared':
      return patchSession(state, (s) => ({
        ...s,
        drawings: s.drawings.filter((d) => d.mapId !== msg.mapId),
      }));

    case 'combat':
      return patchSession(state, (s) => ({ ...s, combat: msg.combat }));
    case 'activeMap':
      return patchSession(state, (s) => ({ ...s, activeMapId: msg.mapId }));

    case 'diceLog': {
      // Скрытые броски сервер шлёт только мастеру; для остальных ролей
      // дополнительно фильтруем здесь (прежнее поведение доски и телефона).
      if (msg.entry.hidden && role !== 'dm') return state;
      const limit = role === 'player' ? PLAYER_DICE_LOG_LIMIT : DICE_LOG_LIMIT;
      return patchSession(state, (s) => ({
        ...s,
        diceLog: [...s.diceLog.slice(-(limit - 1)), msg.entry],
      }));
    }

    case 'characterUpdated':
      return {
        ...state,
        characters: [...state.characters.filter((c) => c.id !== msg.character.id), msg.character],
      };

    case 'items':
      return { ...state, items: msg.items };

    case 'error':
      return { ...state, error: msg.message };

    default:
      return state;
  }
}

function sessionReducer(state: SessionStoreState, action: Action): SessionStoreState {
  switch (action.type) {
    case 'serverMsg':
      return applyServerMsg(state, action.msg);
    case 'optimisticMove':
      return patchSession(state, (s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.id === action.tokenId ? { ...t, x: action.x, y: action.y } : t),
      }));
    case 'optimisticFog': {
      if (action.mode === 'reveal') {
        const optimistic = {
          id: `local-${Date.now()}-${Math.random()}`,
          mapId: action.mapId,
          shape: action.shape,
        };
        return patchSession(state, (s) => ({
          ...s,
          fogReveals: [...s.fogReveals, optimistic],
        }));
      }
      // «скрыть область»: убираем совпадающие по форме открытые области,
      // чтобы ответ сервера не откатывал UI
      const shapeJson = JSON.stringify(action.shape);
      return patchSession(state, (s) => ({
        ...s,
        fogReveals: s.fogReveals.filter(
          (r) => !(r.mapId === action.mapId && JSON.stringify(r.shape) === shapeJson),
        ),
      }));
    }
    default:
      return state;
  }
}

// ─── Контекст ───────────────────────────────────────────────────────────────

export interface SessionStore extends SessionStoreState {
  /** Отправить сообщение серверу (без активного соединения молча теряется). */
  send: (msg: ClientMsg) => void;
  /** Движение токена: оптимистичный локальный сдвиг + команда серверу. */
  moveToken: (tokenId: string, x: number, y: number) => void;
  /** Туман: оптимистичное открытие/скрытие области + команда серверу. */
  fog: (mapId: string, shape: FogShape, mode: 'reveal' | 'hide') => void;
}

const SessionStoreContext = createContext<SessionStore | null>(null);

export function SessionProvider({
  role, sessionId, characterId, children,
}: {
  role: Role;
  sessionId: string;
  characterId?: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(sessionReducer, role, initialState);
  const sockRef = useRef<SessionSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const sock = new SessionSocket(role, sessionId, characterId);
    sockRef.current = sock;
    const off = sock.onMessage((msg) => {
      dispatch({ type: 'serverMsg', msg });
      // Телефон без выбранного персонажа: вслед за снимком просим полный
      // список предметов для инвентаря (прежнее поведение PlayerPage).
      if (msg.type === 'snapshot' && role === 'player' && !characterId) {
        sock.send({ type: 'requestItems' });
      }
    });
    return () => {
      off();
      sock.close();
      sockRef.current = null;
    };
  }, [role, sessionId, characterId]);

  // При смене персонажа (characterId) состояние НЕ сбрасывается: items и
  // снимок доживают до нового snapshot — как в прежнем PlayerPage, где
  // useState-значения переживали переподключение сокета.

  const value = useMemo<SessionStore>(() => ({
    ...state,
    send: (msg) => sockRef.current?.send(msg),
    moveToken: (tokenId, x, y) => {
      dispatch({ type: 'optimisticMove', tokenId, x, y });
      sockRef.current?.send({ type: 'moveToken', tokenId, x, y });
    },
    fog: (mapId, shape, mode) => {
      dispatch({ type: 'optimisticFog', mapId, shape, mode });
      sockRef.current?.send({ type: 'fog', mapId, shape, mode });
    },
  }), [state]);

  return <SessionStoreContext.Provider value={value}>{children}</SessionStoreContext.Provider>;
}

export function useSessionStore(): SessionStore {
  const ctx = useContext(SessionStoreContext);
  if (!ctx) throw new Error('useSessionStore() можно вызывать только внутри SessionProvider');
  return ctx;
}
