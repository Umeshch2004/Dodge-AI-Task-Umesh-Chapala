// src/lib/db.js
// Singleton SQLite connection for Next.js API routes
// On Vercel serverless, copies the DB from the bundled location to /tmp (writable)

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db;

export function getDb() {
  if (!db) {
    // In Vercel's serverless environment, only /tmp is writable.
    // We bundle the DB file with the app and copy it to /tmp on first access.
    const isVercel = process.env.VERCEL === '1';
    let dbPath;

    if (isVercel) {
      const tmpPath = '/tmp/o2c.db';
      if (!fs.existsSync(tmpPath)) {
        // Source: the bundled DB file included via outputFileTracingIncludes
        const bundledPath = path.join(process.cwd(), 'data', 'o2c.db');
        fs.copyFileSync(bundledPath, tmpPath);
      }
      dbPath = tmpPath;
    } else {
      // Local development — use path directly
      dbPath = path.join(process.cwd(), 'data', 'o2c.db');
    }

    db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');
  }
  return db;
}
