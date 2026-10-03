// ─── Протокол WebSocket: клиент ↔ сервер ────────────────────────────────────
// Транспорт: JSON-сообщения { type: string, ...payload }.
// Сервер хранит авторитетное состояние; после каждой мутации рассылает
// соответствующее ServerMsg всем подключённым клиентам сессии.

import type {
  Character, ConditionKey, DiceLogEntry, DrawStroke, FogShape, Item,
  LiveToken, SessionState, TokenKind,
} from './types';

export type Role = 'dm' | 'board' | 'player';

// ─── Клиент → Сервер ────────────────────────────────────────────────────────

export type ClientMsg =
  | { type: 'hello'; role: Role; sessionId: string; characterId?: string }

  // мастер: карта и токены
  | { type: 'setActiveMap'; mapId: string }
  | { type: 'addToken'; token: Omit<LiveToken, 'id'> }
  | { type: 'moveToken'; tokenId: string; x: number; y: number }
  | { type: 'removeToken'; tokenId: string }
  | { type: 'setTokenHidden'; tokenId: string; hidden: boolean }
  | { type: 'setTokenHp'; tokenId: string; currentHp: number }
  | { type: 'setTokenConditions'; tokenId: string; conditions: ConditionKey[] }

  // мастер: туман войны (mode: reveal — открыть, hide — скрыть область)
  | { type: 'fog'; mapId: string; shape: FogShape; mode: 'reveal' | 'hide' }
  | { type: 'fogReset'; mapId: string } // скрыть всё

  // мастер: рисование
  | { type: 'draw'; stroke: Omit<DrawStroke, 'id'> }
  | { type: 'eraseStroke'; strokeId: string }
  | { type: 'clearDrawings'; mapId: string }

  // мастер: инициатива
  | { type: 'initiativeStart'; entries: { name: string; roll: number; tokenId?: string; characterId?: string; kind: TokenKind }[] }
  | { type: 'initiativeNext' }
  | { type: 'initiativeEnd' }

  // броски костей (игрок с телефона или мастер)
  | { type: 'rollDice'; label: string; formula: string; hidden?: boolean }

  // игрок: изменение своего персонажа (сервер применяет к авторитетной копии)
  | { type: 'characterPatch'; characterId: string; patch: Partial<Character> }

  // персонажи в сессии
  | { type: 'sessionAddCharacter'; characterId: string }
  | { type: 'sessionRemoveCharacter'; characterId: string }

  // игрок с телефона: полный список предметов для инвентаря
  | { type: 'requestItems' };

// ─── Сервер → Клиент ────────────────────────────────────────────────────────

export type ServerMsg =
  // полный снимок после hello (для player — только его персонаж и лог)
  | { type: 'snapshot'; session: SessionState; characters: Character[] }
  | { type: 'tokenUpsert'; token: LiveToken }
  | { type: 'tokenRemoved'; tokenId: string }
  | { type: 'fogReveals'; mapId: string; reveals: { id: string; shape: FogShape }[] }
  | { type: 'strokeAdded'; stroke: DrawStroke }
  | { type: 'strokeRemoved'; strokeId: string }
  | { type: 'drawingsCleared'; mapId: string }
  | { type: 'combat'; combat: SessionState['combat'] }
  | { type: 'diceLog'; entry: DiceLogEntry } // скрытые броски шлются только роли dm
  | { type: 'characterUpdated'; character: Character }
  | { type: 'activeMap'; mapId: string }
  // ответ на requestItems (шлётся только запросившему клиенту)
  | { type: 'items'; items: Item[] }
  | { type: 'error'; message: string };
