import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrateDbSchema } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/freeapi.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_PATH;
  const isMemory = resolvedPath === ':memory:';

  if (!isMemory) {
    const dataDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  db = new Database(resolvedPath);
  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrateDbSchema(db);

  // Auto-restore seed database on boot of persistent volume if keys table is empty
  if (!isMemory) {
    let needsSeeding = false;
    try {
      const keysCount = db.prepare("SELECT COUNT(*) as count FROM keys").get() as { count: number };
      if (keysCount.count === 0) {
        needsSeeding = true;
      }
    } catch (err) {
      needsSeeding = true;
    }

    if (needsSeeding) {
      const seedPaths = [
        path.resolve(__dirname, '../freeapi_seed.db'),
        path.resolve(__dirname, '../../freeapi_seed.db'),
        path.resolve(__dirname, '../../../freeapi_seed.db')
      ];
      for (const sp of seedPaths) {
        if (fs.existsSync(sp)) {
          console.log(`[Database Seeder] Keys empty. Restoring seed database from ${sp} to ${resolvedPath}`);
          try {
            db.close();
            fs.copyFileSync(sp, resolvedPath);
            db = new Database(resolvedPath);
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            break;
          } catch (err: any) {
            console.error(`[Database Seeder] Failed to copy seed:`, err.message);
          }
        }
      }
    }
  }

  console.log(`Database initialized at ${resolvedPath}`);
  return db;
}

export function getUnifiedApiKey(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string };
  return row.value;
}

export function regenerateUnifiedKey(): string {
  const db = getDb();
  const key = `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run(key);
  return key;
}

// Generic key/value settings accessors (used by routing strategy, etc.).
export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
