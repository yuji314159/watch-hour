import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
  sqlite.transaction(() => {
    for (const name of readdirSync('migrations').filter(n => n.endsWith('.sql')).sort()) {
      if (sqlite.prepare('SELECT name FROM migrations WHERE name = ?').get(name)) continue;
      sqlite.exec(readFileSync(resolve('migrations', name), 'utf8'));
      sqlite.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    }
  })();
  return { db: drizzle(sqlite), sqlite };
}
