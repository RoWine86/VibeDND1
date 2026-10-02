// ─── Загрузка файлов: изображения карт, арты, портреты ──────────────────────
// Основной формат — сырые байты (express.raw), имя файла в заголовке
// x-filename. Fallback — multipart/form-data (поле file): его шлёт
// api.upload() из веб-клиента. Сохраняем под uuid-именем.

import express, { type Router } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from './db.js';

/** Разрешённые расширения — только то, что реально отображается в браузере. */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

const MAX_BYTES = 50 * 1024 * 1024;

function saveBuffer(buf: Buffer, rawName: string, res: express.Response, contentType = ''): void {
  let ext = path.extname(rawName).toLowerCase();
  // Имя без расширения (или с неразрешённым) — берём расширение из Content-Type
  if (!ALLOWED_EXT.has(ext)) {
    const byMime: Record<string, string> = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
      'image/gif': '.gif', 'image/svg+xml': '.svg',
    };
    ext = byMime[contentType.split(';')[0]!.trim()] ?? '';
  }
  if (!ALLOWED_EXT.has(ext)) {
    res.status(400).json({ error: `Недопустимый тип файла: ${path.extname(rawName) || 'без расширения'}` });
    return;
  }
  if (buf.length === 0) {
    res.status(400).json({ error: 'Пустое тело запроса' });
    return;
  }
  const filename = `${randomUUID()}${ext}`;
  writeFileSync(path.join(UPLOADS_DIR, filename), buf);
  res.json({ path: `/uploads/${filename}` });
}

// ─── Минимальный разбор multipart/form-data ─────────────────────────────────
// Формат: части разделены boundary, у каждой заголовки вида
// Content-Disposition: form-data; name="file"; filename="map.png".
// Извлекаем первый файл: имя из заголовка части, байты — между заголовками
// и границей. Зависимостей нет; поток сперва буферизуем (лимит 50 МБ).

interface MultipartFile {
  filename: string;
  data: Buffer;
}

function extractMultipartFile(body: Buffer, boundary: string): MultipartFile | null {
  const delim = Buffer.from(`--${boundary}`);
  const first = body.indexOf(delim);
  if (first === -1) return null;
  // начало заголовков первой части
  const headersStart = first + delim.length + 2; // \r\n после boundary
  const headersEnd = body.indexOf('\r\n\r\n', headersStart);
  if (headersEnd === -1) return null;
  const headers = body.subarray(headersStart, headersEnd).toString('latin1');
  const m = /filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i.exec(headers);
  if (!m || !m[1]) return null;
  const filename = decodeURIComponent(m[1].trim());
  const dataStart = headersEnd + 4;
  // конец данных — ближайшая граница \r\n--boundary
  const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), delim]), dataStart);
  if (next === -1) return null;
  return { filename, data: body.subarray(dataStart, next) };
}

function handleMultipart(req: express.Request, res: express.Response): void {
  const ct = String(req.headers['content-type'] ?? '');
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  const boundary = (bm?.[1] ?? bm?.[2] ?? '').trim();
  if (!boundary) {
    res.status(400).json({ error: 'multipart/form-data без boundary' });
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let answered = false;
  req.on('data', (d: Buffer) => {
    size += d.length;
    if (size > MAX_BYTES && !answered) {
      answered = true;
      res.status(413).json({ error: 'Файл слишком большой (макс. 50 МБ)' });
      return;
    }
    chunks.push(d);
  });
  req.on('end', () => {
    if (answered) return;
    answered = true;
    const file = extractMultipartFile(Buffer.concat(chunks), boundary);
    if (!file) {
      res.status(400).json({ error: 'В запросе нет файла' });
      return;
    }
    saveBuffer(file.data, file.filename, res);
  });
  req.on('error', () => {
    if (!answered) {
      answered = true;
      res.status(400).json({ error: 'Не удалось прочитать тело запроса' });
    }
  });
}

export function uploadsRouter(): Router {
  const router = express.Router();

  router.post(
    '/upload',
    // raw-парсер только для НЕ-multipart запросов: multipart читаем сами
    (req, res, next) => {
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.startsWith('multipart/form-data')) return next();
      return express.raw({ type: '*/*', limit: '50mb' })(req, res, next);
    },
    (req, res) => {
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.startsWith('multipart/form-data')) {
        handleMultipart(req, res);
        return;
      }
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Пустое тело запроса' });
        return;
      }
      saveBuffer(req.body, String(req.headers['x-filename'] ?? 'file'), res, ct);
    },
  );

  return router;
}
