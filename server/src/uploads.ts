// ─── Загрузка файлов: изображения карт, арты, портреты ──────────────────────
// Тело — сырые байты (express.raw), имя исходного файла приходит в заголовке
// x-filename. Сохраняем под uuid-именем с сохранением расширения.

import express, { type Router } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from './db.js';

/** Разрешённые расширения — только то, что реально отображается в браузере. */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

export function uploadsRouter(): Router {
  const router = express.Router();

  router.post('/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    const rawName = String(req.headers['x-filename'] ?? 'file');
    const ext = path.extname(rawName).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      res.status(400).json({ error: `Недопустимый тип файла: ${ext || 'без расширения'}` });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Пустое тело запроса' });
      return;
    }
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(path.join(UPLOADS_DIR, filename), req.body);
    res.json({ path: `/uploads/${filename}` });
  });

  return router;
}
