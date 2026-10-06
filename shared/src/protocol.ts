// ─── Протокол WebSocket: клиент ↔ сервер ────────────────────────────────────
// Транспорт: JSON-сообщения { type: string, ...payload }.
// Сервер хранит авторитетное состояние; после каждой мутации рассылает
// соответствующее ServerMsg всем подключённым клиентам сессии.

import type {
  Character, CombatEvent, ConditionKey, DiceLogEntry, DrawStroke, FogShape,
  Item, LiveToken, SaveRequest, SecretRequest, SessionState, TokenKind,
} from './types.js';

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

  // ── Боевой движок (шаг 2) ──────────────────────────────────────────────

  // Каст заклинания. Источник — персонаж (игрок) ИЛИ токен монстра
  // (мастер). slotLevel — уровень ячейки (0 = заговор, без ячеек); для
  // заклинаний с targeting:'area' — мультивыбор целей в targetTokenIds.
  | {
      type: 'castSpell';
      characterId?: string;
      tokenId?: string;
      spellId: string;
      slotLevel: number;
      targetTokenIds: string[];
    }

  // Атака оружием/действием. Атакующий — токен монстра ИЛИ персонаж.
  // attackName — готовая запись из Character.attacks / Monster.attacks;
  // weaponItemId — вместо неё: атака строится по экипированному оружию
  // персонажа (бонусы — из предмета и характеристик).
  | {
      type: 'attackWith';
      attackerTokenId?: string;
      attackerCharacterId?: string;
      attackName?: string;
      weaponItemId?: string;
      targetTokenId: string;
    }

  // Игрок: вписать результат физического спасброска из очереди.
  | { type: 'saveResult'; requestId: string; value: number }
  // Игрок: кинуть спасбросок виртуально (сервер бросает d20).
  | { type: 'saveRoll'; requestId: string }
  // Мастер: кидает/вписывает спасбросок за монстра (или фолбэк за игрока).
  // rolledValue опущен — сервер кинет d20 сам.
  | { type: 'resolveSave'; requestId: string; rolledValue?: number }

  // Отдых: короткий (кость хитов + ресурсы short) или длинный (полное
  // восстановление). Заменяет прежние REST-кнопки CharacterSheet.
  | { type: 'rest'; characterId: string; kind: 'short' | 'long' }

  // игрок с телефона: полный список предметов для инвентаря
  | { type: 'requestItems' }

  // ── Скрытые заявки (шаг 8) ────────────────────────────────────────────

  // Игрок: свободный текст, видимый только мастеру («хочу незаметно стащить ключ»).
  | { type: 'secretRequest'; characterId: string; text: string }
  // Мастер: одобрить/отклонить заявку, необязательно с текстовым ответом.
  | { type: 'secretResolve'; requestId: string; decision: 'approve' | 'reject'; reply?: string }
  // История заявок: мастер получает все, игрок — только свои.
  | { type: 'requestSecrets' };

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

  // ── Боевой движок (шаг 2) ──────────────────────────────────────────────

  /** Структурное событие боя (фаза, участники, урон/крит/спас). Шлётся всем
   *  в комнате; события со скрытыми токенами — только мастеру. */
  | { type: 'combatEvent'; event: CombatEvent }
  /** Новый запрос спасброска: адресно владельцу персонажа и мастеру
   *  (за монстров всегда кидает мастер). */
  | { type: 'saveRequest'; request: SaveRequest }
  | { type: 'characterUpdated'; character: Character }

  // ── Скрытые заявки (шаг 8) ────────────────────────────────────────────

  /** Новая заявка игрока — только DM-соединениям; доска и игроки не получают. */
  | { type: 'secretNew'; request: SecretRequest }
  /** Решение мастера — только отправителю заявки и DM. */
  | { type: 'secretResolved'; request: SecretRequest }
  /** Ответ на requestSecrets — только запросившему клиенту. */
  | { type: 'secrets'; requests: SecretRequest[] }

  | { type: 'activeMap'; mapId: string }
  // ответ на requestItems (шлётся только запросившему клиенту)
  | { type: 'items'; items: Item[] }
  | { type: 'error'; message: string };
