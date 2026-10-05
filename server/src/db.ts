// ─── Слой хранения: SQLite (better-sqlite3) ─────────────────────────────────
// Каждая запись хранится целиком как JSON-строка. Автосохранение сессий —
// синхронная запись после каждой мутации состояния.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCoins } from '@vibednd/shared';
import type { Adventure, Character, SessionState } from '@vibednd/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Корень пакета server/ (при tsx src/, при сборке dist/)
export const SERVER_ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(SERVER_ROOT, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'vibednd.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS adventures (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entities (
    kind TEXT NOT NULL,
    id   TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );
`);

// ─── Обобщённые помощники ───────────────────────────────────────────────────

interface Row {
  data: string;
}

function listRows<T>(table: 'characters' | 'adventures' | 'sessions'): T[] {
  const rows = db.prepare(`SELECT data FROM ${table}`).all() as Row[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

function getRow<T>(table: 'characters' | 'adventures' | 'sessions', id: string): T | undefined {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
  return row ? (JSON.parse(row.data) as T) : undefined;
}

function putRow(table: 'characters' | 'adventures' | 'sessions', id: string, value: unknown): void {
  db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)
              ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
    .run(id, JSON.stringify(value));
}

function deleteRow(table: 'characters' | 'adventures' | 'sessions', id: string): boolean {
  const res = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return res.changes > 0;
}

// ─── Персонажи ──────────────────────────────────────────────────────────────

// Миграция без скрипта (шаг 6): у персонажей, сохранённых до появления
// кошелька, поля coins нет — подставляем нули при каждом чтении.
export const listCharacters = (): Character[] => listRows<Character>('characters').map(withCoins);
export const getCharacter = (id: string): Character | undefined => {
  const ch = getRow<Character>('characters', id);
  return ch ? withCoins(ch) : undefined;
};
export const saveCharacter = (ch: Character): void => putRow('characters', ch.id, ch);
export const deleteCharacter = (id: string): boolean => deleteRow('characters', id);

// ─── Приключения ────────────────────────────────────────────────────────────

export const listAdventures = (): Adventure[] => listRows<Adventure>('adventures');
export const getAdventure = (id: string): Adventure | undefined => getRow<Adventure>('adventures', id);
export const saveAdventure = (adv: Adventure): void => putRow('adventures', adv.id, adv);
export const deleteAdventure = (id: string): boolean => deleteRow('adventures', id);

// ─── Сессии ─────────────────────────────────────────────────────────────────

export const listSessions = (): SessionState[] => listRows<SessionState>('sessions');
export const getSession = (id: string): SessionState | undefined => getRow<SessionState>('sessions', id);

/** Автосохранение: синхронная запись после каждой мутации состояния. */
export function saveSession(session: SessionState): void {
  session.updatedAt = new Date().toISOString();
  putRow('sessions', session.id, session);
}

export const deleteSession = (id: string): boolean => deleteRow('sessions', id);

// ─── Справочные сущности (entities) ─────────────────────────────────────────

interface EntityRow {
  data: string;
}

export function listEntities(kind: string): unknown[] {
  const rows = db.prepare('SELECT data FROM entities WHERE kind = ?').all(kind) as EntityRow[];
  return rows.map((r) => JSON.parse(r.data));
}

export function getEntity(kind: string, id: string): unknown | undefined {
  const row = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ?')
    .get(kind, id) as EntityRow | undefined;
  return row ? JSON.parse(row.data) : undefined;
}

/** Upsert: id берётся из поля id записи. */
export function upsertEntity(kind: string, value: { id: string }): void {
  db.prepare(`INSERT INTO entities (kind, id, data) VALUES (?, ?, ?)
              ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data`)
    .run(kind, value.id, JSON.stringify(value));
}

export function deleteEntity(kind: string, id: string): boolean {
  const res = db.prepare('DELETE FROM entities WHERE kind = ? AND id = ?').run(kind, id);
  return res.changes > 0;
}
