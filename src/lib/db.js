// src/lib/db.js
// Singleton SQLite connection for Next.js API routes

import Database from 'better-sqlite3';
import path from 'path';

let db;

export function getDb() {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'data', 'o2c.db');
    db = new Database(dbPath, { readonly: false });
    db.pragma('journal_mode = WAL');
  }
  return db;
}
