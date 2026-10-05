// ─── REST API (/api): библиотеки, сессии, сущности, служебные маршруты ──────

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { zeroCoins } from '@vibednd/shared';
import type { Adventure, LiveToken, SessionState } from '@vibednd/shared';
import * as db from './db.js';

/** Первый внешний IPv4-адрес машины — для QR/ссылки входа игроков по Wi-Fi. */
export function lanAddress(): string {
  const nets = os.networkInterfaces();
  for (const infos of Object.values(nets)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

function now(): string {
  return new Date().toISOString();
}

/** Создание живого состояния сессии из шаблона приключения. */
function createSessionFromAdventure(adventure: Adventure, name: string): SessionState {
  // Шаблонные токены приключения → живые токены; HP врагов — из статблока монстра
  const tokens: LiveToken[] = adventure.tokens.map((tpl) => {
    let maxHp = 0;
    if (tpl.monsterId) {
      const monster = db.getEntity('monster', tpl.monsterId) as { hitPoints?: number } | undefined;
      maxHp = monster?.hitPoints ?? 0;
    }
    return {
      id: randomUUID(),
      mapId: tpl.mapId,
      kind: tpl.kind,
      name: tpl.name,
      x: tpl.x,
      y: tpl.y,
      sizeCells: tpl.sizeCells,
      imagePath: tpl.imagePath,
      hidden: tpl.hidden,
      monsterId: tpl.monsterId,
      currentHp: maxHp,
      maxHp,
      conditions: [],
    };
  });

  return {
    id: randomUUID(),
    adventureId: adventure.id,
    name,
    activeMapId: adventure.maps[0]?.id,
    tokens,
    fogReveals: [], // туман пустой
    drawings: [],
    combat: { active: false, round: 0, entries: [], currentIndex: 0 },
    characterIds: [],
    diceLog: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

export function restRouter(): Router {
  const router = Router();

  // ─── Служебное ──────────────────────────────────────────────────────────

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ─── Персонажи ──────────────────────────────────────────────────────────

  router.get('/characters', (_req, res) => {
    res.json(db.listCharacters());
  });

  router.get('/characters/:id', (req, res) => {
    const ch = db.getCharacter(req.params.id!);
    if (!ch) {
      res.status(404).json({ error: 'Персонаж не найден' });
      return;
    }
    res.json(ch);
  });

  router.post('/characters', (req, res) => {
    const ch = req.body as { id?: string; name?: string } | undefined;
    if (!ch || typeof ch !== 'object' || !ch.name) {
      res.status(400).json({ error: 'Некорректные данные персонажа: нужно поле name' });
      return;
    }
    // кошелёк по умолчанию — нули, если клиент его не прислал (шаг 6)
    const withId = { coins: zeroCoins(), ...ch, id: ch.id ?? randomUUID() };
    db.saveCharacter(withId as never);
    res.json(withId);
  });

  router.put('/characters/:id', (req, res) => {
    const existing = db.getCharacter(req.params.id!);
    if (!existing) {
      res.status(404).json({ error: 'Персонаж не найден' });
      return;
    }
    const updated = { ...existing, ...req.body, id: existing.id };
    db.saveCharacter(updated);
    res.json(updated);
  });

  router.delete('/characters/:id', (req, res) => {
    if (!db.deleteCharacter(req.params.id!)) {
      res.status(404).json({ error: 'Персонаж не найден' });
      return;
    }
    res.json({ ok: true });
  });

  // ─── Приключения ────────────────────────────────────────────────────────

  router.get('/adventures', (_req, res) => {
    res.json(db.listAdventures());
  });

  router.get('/adventures/:id', (req, res) => {
    const adv = db.getAdventure(req.params.id!);
    if (!adv) {
      res.status(404).json({ error: 'Приключение не найдено' });
      return;
    }
    res.json(adv);
  });

  router.post('/adventures', (req, res) => {
    const body = req.body as Partial<Adventure> | undefined;
    if (!body || !body.name) {
      res.status(400).json({ error: 'Некорректные данные приключения: нужно поле name' });
      return;
    }
    const adv: Adventure = {
      id: body.id ?? randomUUID(),
      name: body.name,
      description: body.description ?? '',
      source: body.source ?? '',
      maps: body.maps ?? [],
      tokens: body.tokens ?? [],
      notes: body.notes ?? [],
      createdAt: body.createdAt ?? now(),
      updatedAt: now(),
    };
    db.saveAdventure(adv);
    res.json(adv);
  });

  router.put('/adventures/:id', (req, res) => {
    const existing = db.getAdventure(req.params.id!);
    if (!existing) {
      res.status(404).json({ error: 'Приключение не найдено' });
      return;
    }
    const updated: Adventure = { ...existing, ...req.body, id: existing.id, updatedAt: now() };
    db.saveAdventure(updated);
    res.json(updated);
  });

  router.delete('/adventures/:id', (req, res) => {
    if (!db.deleteAdventure(req.params.id!)) {
      res.status(404).json({ error: 'Приключение не найдено' });
      return;
    }
    res.json({ ok: true });
  });

  // ─── Сессии ─────────────────────────────────────────────────────────────

  router.get('/sessions', (_req, res) => {
    res.json(db.listSessions());
  });

  router.get('/sessions/:id', (req, res) => {
    const session = db.getSession(req.params.id!);
    if (!session) {
      res.status(404).json({ error: 'Сессия не найдена' });
      return;
    }
    res.json(session);
  });

  // Создание сессии из приключения: { adventureId, name }
  router.post('/sessions', (req, res) => {
    const { adventureId, name } = (req.body ?? {}) as { adventureId?: string; name?: string };
    if (!adventureId || !name) {
      res.status(400).json({ error: 'Нужны поля adventureId и name' });
      return;
    }
    const adventure = db.getAdventure(adventureId);
    if (!adventure) {
      res.status(404).json({ error: 'Приключение не найдено' });
      return;
    }
    const session = createSessionFromAdventure(adventure, name);
    db.saveSession(session);
    res.json(session);
  });

  router.delete('/sessions/:id', (req, res) => {
    if (!db.deleteSession(req.params.id!)) {
      res.status(404).json({ error: 'Сессия не найдена' });
      return;
    }
    res.json({ ok: true });
  });

  // Ссылка входа игрока: URL с LAN-адресом (порт фронтенда Vite — 5173)
  router.get('/sessions/:id/join-info', (req, res) => {
    const session = db.getSession(req.params.id!);
    if (!session) {
      res.status(404).json({ error: 'Сессия не найдена' });
      return;
    }
    res.json({ url: `http://${lanAddress()}:5173/player/${session.id}` });
  });

  // ─── Справочные сущности ────────────────────────────────────────────────

  router.get('/entities/:kind', (req, res) => {
    res.json(db.listEntities(req.params.kind!));
  });

  router.get('/entities/:kind/:id', (req, res) => {
    const entity = db.getEntity(req.params.kind!, req.params.id!);
    if (!entity) {
      res.status(404).json({ error: 'Сущность не найдена' });
      return;
    }
    res.json(entity);
  });

  // Upsert: id берётся из тела или генерируется
  router.post('/entities/:kind', (req, res) => {
    const body = req.body as { id?: string } | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом сущности' });
      return;
    }
    const entity = { ...body, id: body.id ?? randomUUID() };
    db.upsertEntity(req.params.kind!, entity as { id: string });
    res.json(entity);
  });

  router.delete('/entities/:kind/:id', (req, res) => {
    if (!db.deleteEntity(req.params.kind!, req.params.id!)) {
      res.status(404).json({ error: 'Сущность не найдена' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
