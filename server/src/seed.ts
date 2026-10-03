// ─── Заливка стартового контента (D&D 2024) в базу ──────────────────────────
// Читает server/data/seed/*.json и делает upsert в таблицу entities.
// Запуск: npx tsx src/seed.ts (из каталога server/) или npm run seed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, upsertEntity } from './db.js';

const SEED_DIR = path.join(DATA_DIR, 'seed');

const FILES: { file: string; kind: string }[] = [
  { file: 'species.json', kind: 'species' },
  { file: 'classes.json', kind: 'class' },
  { file: 'backgrounds.json', kind: 'background' },
  { file: 'spells.json', kind: 'spell' },
  { file: 'items.json', kind: 'item' },
  { file: 'monsters.json', kind: 'monster' },
];

const counts = new Map<string, number>();
let total = 0;

for (const { file, kind } of FILES) {
  const filePath = path.join(SEED_DIR, file);
  const entries = JSON.parse(readFileSync(filePath, 'utf8')) as { id: string }[];
  if (!Array.isArray(entries)) {
    throw new Error(`${file}: ожидался массив объектов`);
  }
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`${file}: запись без id`);
    }
    upsertEntity(kind, entry);
  }
  counts.set(kind, entries.length);
  total += entries.length;
}

console.log('Сид залит в entities:');
for (const [kind, count] of counts) {
  console.log(`  ${kind}: ${count}`);
}
console.log(`Итого: ${total}`);
