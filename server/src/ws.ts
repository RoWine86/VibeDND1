// ─── WebSocket-слой: живое состояние сессии и рассылка в комнаты ────────────
// Сервер хранит авторитетное состояние. Каждое сообщение клиента мутирует
// состояние, синхронно сохраняется в SQLite и рассылается всем в комнате.
// Скрытые броски и полные данные чужих персонажей игрокам не отправляются.

import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  rollDice,
  type Character,
  type ClientMsg,
  type DiceLogEntry,
  type DrawStroke,
  type Item,
  type LiveToken,
  type Role,
  type ServerMsg,
  type SessionState,
} from '@vibednd/shared';
import * as db from './db.js';

const DICE_LOG_LIMIT = 200;

// ─── Подключённые клиенты ───────────────────────────────────────────────────

interface Client {
  sock: WebSocket;
  role: Role;
  sessionId: string;
  characterId?: string;
}

const clients = new Set<Client>();

/** Кэш живых сессий в памяти; источник истины — SQLite. */
const liveSessions = new Map<string, SessionState>();

function loadSession(sessionId: string): SessionState | undefined {
  let session = liveSessions.get(sessionId);
  if (!session) {
    session = db.getSession(sessionId);
    if (session) liveSessions.set(sessionId, session);
  }
  return session;
}

// ─── Рассылка ───────────────────────────────────────────────────────────────

function sendTo(client: Client, msg: ServerMsg): void {
  if (client.sock.readyState === WebSocket.OPEN) {
    client.sock.send(JSON.stringify(msg));
  }
}

/** Фильтр получателя: скрытые броски — только мастеру. */
function broadcast(sessionId: string, msg: ServerMsg, onlyDm = false): void {
  for (const client of clients) {
    if (client.sessionId !== sessionId) continue;
    if (onlyDm && client.role !== 'dm') continue;
    sendTo(client, msg);
  }
}

function sendError(client: Client, message: string): void {
  sendTo(client, { type: 'error', message });
}

// ─── Снимок с учётом роли ───────────────────────────────────────────────────

/** Доска и игроки не видят скрытые токены, скрытые броски и заметки о тумане. */
function filterSessionForRole(session: SessionState, role: Role): SessionState {
  if (role === 'dm') return session;
  return {
    ...session,
    tokens: session.tokens.filter((t) => !t.hidden),
    diceLog: session.diceLog.filter((e) => !e.hidden),
  };
}

function snapshotFor(client: Client, session: SessionState): ServerMsg {
  if (client.role === 'player') {
    // Игрок получает только своего персонажа
    const characters: Character[] = [];
    if (client.characterId) {
      const ch = db.getCharacter(client.characterId);
      if (ch) characters.push(ch);
    }
    return { type: 'snapshot', session: filterSessionForRole(session, client.role), characters };
  }
  const characters = session.characterIds
    .map((id) => db.getCharacter(id))
    .filter((ch): ch is Character => Boolean(ch));
  return { type: 'snapshot', session: filterSessionForRole(session, client.role), characters };
}

/** Для игрока БЕЗ персонажа (экран выбора): вся партия целиком, чтобы он мог
 *  увидеть имена и выбрать себя. */
function snapshotParty(session: SessionState): ServerMsg {
  const characters = session.characterIds
    .map((id) => db.getCharacter(id))
    .filter((ch): ch is Character => Boolean(ch));
  return { type: 'snapshot', session: filterSessionForRole(session, 'player'), characters };
}

// ─── Синхронизация HP: персонаж ↔ токен ─────────────────────────────────────

/** После изменения персонажа — обновить привязанный токен и разослать оба. */
function syncCharacter(session: SessionState, character: Character): void {
  broadcast(session.id, { type: 'characterUpdated', character });
  const token = session.tokens.find((t) => t.characterId === character.id);
  if (token) {
    token.currentHp = character.currentHp;
    token.maxHp = character.maxHp;
    broadcast(session.id, { type: 'tokenUpsert', token });
  }
}

/** После изменения HP токена — обновить привязанного персонажа. */
function syncTokenToCharacter(session: SessionState, token: LiveToken): void {
  if (!token.characterId) return;
  const character = db.getCharacter(token.characterId);
  if (!character) return;
  character.currentHp = token.currentHp;
  db.saveCharacter(character);
  broadcast(session.id, { type: 'characterUpdated', character });
}

// ─── Обработчики сообщений ──────────────────────────────────────────────────

/** Проверка: действие доступно только мастеру. */
function requireDm(client: Client): boolean {
  if (client.role !== 'dm') {
    sendError(client, 'Это действие доступно только мастеру');
    return false;
  }
  return true;
}

function handleMessage(client: Client, session: SessionState, msg: ClientMsg): void {
  switch (msg.type) {
    case 'hello':
      // обрабатывается при подключении
      return;

    // ── Карта и токены (только мастер) ──────────────────────────────────

    case 'setActiveMap': {
      if (!requireDm(client)) return;
      session.activeMapId = msg.mapId;
      db.saveSession(session);
      broadcast(session.id, { type: 'activeMap', mapId: msg.mapId });
      return;
    }

    case 'addToken': {
      if (!requireDm(client)) return;
      const token: LiveToken = { ...msg.token, id: randomUUID() };
      session.tokens.push(token);
      db.saveSession(session);
      broadcast(session.id, { type: 'tokenUpsert', token });
      return;
    }

    case 'moveToken': {
      if (!requireDm(client)) return;
      const token = session.tokens.find((t) => t.id === msg.tokenId);
      if (!token) {
        sendError(client, 'Токен не найден');
        return;
      }
      token.x = msg.x;
      token.y = msg.y;
      db.saveSession(session);
      broadcast(session.id, { type: 'tokenUpsert', token });
      return;
    }

    case 'removeToken': {
      if (!requireDm(client)) return;
      const idx = session.tokens.findIndex((t) => t.id === msg.tokenId);
      if (idx === -1) {
        sendError(client, 'Токен не найден');
        return;
      }
      session.tokens.splice(idx, 1);
      db.saveSession(session);
      broadcast(session.id, { type: 'tokenRemoved', tokenId: msg.tokenId });
      return;
    }

    case 'setTokenHidden': {
      if (!requireDm(client)) return;
      const token = session.tokens.find((t) => t.id === msg.tokenId);
      if (!token) {
        sendError(client, 'Токен не найден');
        return;
      }
      token.hidden = msg.hidden;
      db.saveSession(session);
      broadcast(session.id, { type: 'tokenUpsert', token });
      return;
    }

    case 'setTokenHp': {
      if (!requireDm(client)) return;
      const token = session.tokens.find((t) => t.id === msg.tokenId);
      if (!token) {
        sendError(client, 'Токен не найден');
        return;
      }
      token.currentHp = Math.max(0, Math.min(msg.currentHp, token.maxHp || msg.currentHp));
      db.saveSession(session);
      broadcast(session.id, { type: 'tokenUpsert', token });
      syncTokenToCharacter(session, token);
      return;
    }

    case 'setTokenConditions': {
      if (!requireDm(client)) return;
      const token = session.tokens.find((t) => t.id === msg.tokenId);
      if (!token) {
        sendError(client, 'Токен не найден');
        return;
      }
      token.conditions = msg.conditions;
      db.saveSession(session);
      broadcast(session.id, { type: 'tokenUpsert', token });
      return;
    }

    // ── Туман войны ───────────────────────────────────────────────────────

    case 'fog': {
      if (!requireDm(client)) return;
      if (msg.mode === 'reveal') {
        session.fogReveals.push({ id: randomUUID(), mapId: msg.mapId, shape: msg.shape });
      } else {
        // «скрыть область»: убираем открытые области этой карты, совпадающие по форме
        const shapeJson = JSON.stringify(msg.shape);
        session.fogReveals = session.fogReveals.filter(
          (r) => !(r.mapId === msg.mapId && JSON.stringify(r.shape) === shapeJson),
        );
      }
      db.saveSession(session);
      broadcast(session.id, {
        type: 'fogReveals',
        mapId: msg.mapId,
        reveals: session.fogReveals
          .filter((r) => r.mapId === msg.mapId)
          .map(({ id, shape }) => ({ id, shape })),
      });
      return;
    }

    case 'fogReset': {
      if (!requireDm(client)) return;
      session.fogReveals = session.fogReveals.filter((r) => r.mapId !== msg.mapId);
      db.saveSession(session);
      broadcast(session.id, { type: 'fogReveals', mapId: msg.mapId, reveals: [] });
      return;
    }

    // ── Рисование ─────────────────────────────────────────────────────────

    case 'draw': {
      if (!requireDm(client)) return;
      const stroke: DrawStroke = { ...msg.stroke, id: randomUUID() };
      session.drawings.push(stroke);
      db.saveSession(session);
      broadcast(session.id, { type: 'strokeAdded', stroke });
      return;
    }

    case 'eraseStroke': {
      if (!requireDm(client)) return;
      const idx = session.drawings.findIndex((s) => s.id === msg.strokeId);
      if (idx === -1) {
        sendError(client, 'Штрих не найден');
        return;
      }
      session.drawings.splice(idx, 1);
      db.saveSession(session);
      broadcast(session.id, { type: 'strokeRemoved', strokeId: msg.strokeId });
      return;
    }

    case 'clearDrawings': {
      if (!requireDm(client)) return;
      session.drawings = session.drawings.filter((s) => s.mapId !== msg.mapId);
      db.saveSession(session);
      broadcast(session.id, { type: 'drawingsCleared', mapId: msg.mapId });
      return;
    }

    // ── Инициатива ────────────────────────────────────────────────────────

    case 'initiativeStart': {
      if (!requireDm(client)) return;
      session.combat = {
        active: true,
        round: 1,
        currentIndex: 0,
        // сортировка по броску по убыванию
        entries: msg.entries
          .map((e) => ({ ...e, id: randomUUID() }))
          .sort((a, b) => b.roll - a.roll),
      };
      db.saveSession(session);
      broadcast(session.id, { type: 'combat', combat: session.combat });
      return;
    }

    case 'initiativeNext': {
      if (!requireDm(client)) return;
      if (!session.combat.active || session.combat.entries.length === 0) {
        sendError(client, 'Бой не идёт');
        return;
      }
      session.combat.currentIndex += 1;
      if (session.combat.currentIndex >= session.combat.entries.length) {
        // конец круга — новый раунд
        session.combat.currentIndex = 0;
        session.combat.round += 1;
      }
      db.saveSession(session);
      broadcast(session.id, { type: 'combat', combat: session.combat });
      return;
    }

    case 'initiativeEnd': {
      if (!requireDm(client)) return;
      session.combat = { active: false, round: 0, entries: [], currentIndex: 0 };
      db.saveSession(session);
      broadcast(session.id, { type: 'combat', combat: session.combat });
      return;
    }

    // ── Броски костей ─────────────────────────────────────────────────────

    case 'rollDice': {
      if (msg.hidden && client.role !== 'dm') {
        sendError(client, 'Скрытые броски доступны только мастеру');
        return;
      }
      let rolled;
      try {
        rolled = rollDice(msg.formula);
      } catch (err) {
        sendError(client, err instanceof Error ? err.message : 'Некорректная формула костей');
        return;
      }
      const rollerName =
        client.role === 'player' && client.characterId
          ? (db.getCharacter(client.characterId)?.name ?? 'Игрок')
          : client.role === 'dm'
            ? 'Мастер'
            : 'Доска';
      const entry: DiceLogEntry = {
        id: randomUUID(),
        timestamp: Date.now(),
        rollerName,
        label: msg.label,
        formula: msg.formula,
        total: rolled.total,
        rolls: rolled.rolls,
        hidden: Boolean(msg.hidden),
      };
      session.diceLog.push(entry);
      // лог не разрастается бесконечно
      if (session.diceLog.length > DICE_LOG_LIMIT) {
        session.diceLog.splice(0, session.diceLog.length - DICE_LOG_LIMIT);
      }
      db.saveSession(session);
      broadcast(session.id, { type: 'diceLog', entry }, entry.hidden);
      return;
    }

    // ── Персонажи ─────────────────────────────────────────────────────────

    case 'characterPatch': {
      // игрок правит только своего персонажа, мастер — любого
      if (client.role === 'player' && client.characterId !== msg.characterId) {
        sendError(client, 'Игрок может изменять только своего персонажа');
        return;
      }
      if (client.role === 'board') {
        sendError(client, 'Доска не может изменять персонажей');
        return;
      }
      const existing = db.getCharacter(msg.characterId);
      if (!existing) {
        sendError(client, 'Персонаж не найден');
        return;
      }
      const patch = { ...msg.patch };
      if (client.role === 'player') {
        // игрок не может переприсвоить id
        delete (patch as Partial<Character>).id;
      }
      const character: Character = { ...existing, ...patch, id: existing.id };
      if (typeof character.currentHp === 'number') {
        character.currentHp = Math.max(0, Math.min(character.currentHp, character.maxHp));
      }
      db.saveCharacter(character);
      if (session.characterIds.includes(character.id)) {
        syncCharacter(session, character);
        db.saveSession(session);
      } else {
        broadcast(session.id, { type: 'characterUpdated', character });
      }
      return;
    }

    case 'sessionAddCharacter': {
      if (!requireDm(client)) return;
      if (!db.getCharacter(msg.characterId)) {
        sendError(client, 'Персонаж не найден');
        return;
      }
      if (!session.characterIds.includes(msg.characterId)) {
        session.characterIds.push(msg.characterId);
      }
      // привязка токена к персонажу делается мастером через characterId токена;
      // здесь только список партии
      db.saveSession(session);
      const character = db.getCharacter(msg.characterId);
      // characterUpdated — сигнал клиентам, что состав партии изменился
      if (character) broadcast(session.id, { type: 'characterUpdated', character });
      return;
    }

    case 'sessionRemoveCharacter': {
      if (!requireDm(client)) return;
      session.characterIds = session.characterIds.filter((id) => id !== msg.characterId);
      // отвязываем токены этого персонажа
      for (const token of session.tokens) {
        if (token.characterId === msg.characterId) {
          delete token.characterId;
          broadcast(session.id, { type: 'tokenUpsert', token });
        }
      }
      db.saveSession(session);
      return;
    }

    // игрок с телефона запрашивает список предметов для инвентаря
    case 'requestItems': {
      const items = db.listEntities('item') as Item[];
      sendTo(client, { type: 'items', items });
      return;
    }
  }
}

// ─── Подключение ────────────────────────────────────────────────────────────

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (sock) => {
    let client: Client | null = null;

    sock.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: 'error', message: 'Некорректный JSON' }));
        }
        return;
      }

      // Первое сообщение — hello: привязка к комнате сессии и снимок состояния
      if (!client) {
        if (msg.type !== 'hello') {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ type: 'error', message: 'Первым сообщением ожидается hello' }));
          }
          return;
        }
        const session = loadSession(msg.sessionId);
        if (!session) {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ type: 'error', message: 'Сессия не найдена' }));
          }
          sock.close();
          return;
        }
        if (msg.role === 'player' && msg.characterId && !db.getCharacter(msg.characterId)) {
          // characterId указан, но персонажа нет в базе — вход невозможен
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ type: 'error', message: 'Персонаж не найден' }));
          }
          sock.close();
          return;
        }
        // player без characterId — экран выбора персонажа: снимок с партией,
        // без права отдавать команды (handleMessage сам отсекает лишнее)
        client = { sock, role: msg.role, sessionId: msg.sessionId, characterId: msg.characterId };
        clients.add(client);
        // player без characterId — экран выбора: шлём всю партию
        sendTo(client, client.role === 'player' && !client.characterId
          ? snapshotParty(session)
          : snapshotFor(client, session));
        return;
      }

      const session = loadSession(client.sessionId);
      if (!session) {
        sendError(client, 'Сессия не найдена');
        return;
      }
      try {
        handleMessage(client, session, msg);
      } catch (err) {
        console.error('Ошибка обработки сообщения', msg.type, err);
        sendError(client, 'Внутренняя ошибка сервера');
      }
    });

    sock.on('close', () => {
      if (client) clients.delete(client);
    });
  });
}
