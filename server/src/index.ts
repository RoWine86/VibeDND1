// Точка входа сервера VibeDND. Реализуется агентом сервера.
import express from 'express';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`VibeDND server: http://localhost:${PORT}`);
});
