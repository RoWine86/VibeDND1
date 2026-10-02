// ─── Точка входа сервера VibeDND ────────────────────────────────────────────
// Express (REST + статика загрузок) и WebSocket на одном порту 3001.

import express from 'express';
import { createServer } from 'node:http';
import { UPLOADS_DIR } from './db.js';
import { restRouter, lanAddress } from './rest.js';
import { uploadsRouter } from './uploads.js';
import { attachWebSocket } from './ws.js';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

app.use(express.json({ limit: '10mb' }));

// Отдача загруженных файлов (карты, арты, портреты)
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api', restRouter());
app.use('/api', uploadsRouter());

const server = createServer(app);
attachWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`VibeDND сервер: http://localhost:${PORT}`);
  console.log(`Вход по сети:   http://${lanAddress()}:${PORT}`);
});
