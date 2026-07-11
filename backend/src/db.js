// Veritabanı katmanı: önce `better-sqlite3` (gerçek, native, üretimde yaygın kullanılan
// bir paket) kullanmayı dener. Kurulu değilse (npm install yapılmadıysa) otomatik olarak
// Node'un yerleşik `node:sqlite` modülüne düşer — böylece hem "gerçek" bir üretim
// kütüphanesine geçilmiş olur hem de paket kurulmadan da çalışmaya devam eder.
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cember.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db;
let engine;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  engine = 'better-sqlite3';
} catch (e) {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  engine = 'node:sqlite (yerleşik, better-sqlite3 kurulu değil)';
}
console.log(`[db] motor: ${engine} — dosya: ${DB_PATH}`);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ad            TEXT NOT NULL,
    soyad         TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category       TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    details_json   TEXT NOT NULL DEFAULT '{}',
    lat            REAL,
    lng            REAL,
    photo_data_url TEXT,
    status         TEXT NOT NULL DEFAULT 'aktif',
    stage_idx      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tips (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id   INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Eski veritabanlarında photo_data_url sütunu yoksa ekle (basit migrasyon)
try {
  const cols = db.prepare("PRAGMA table_info(alerts)").all();
  if (!cols.some(c => c.name === 'photo_data_url')) {
    db.exec('ALTER TABLE alerts ADD COLUMN photo_data_url TEXT');
    console.log('[db] migrasyon: alerts.photo_data_url sütunu eklendi');
  }
} catch (e) {
  console.warn('[db] migrasyon kontrolü atlandı:', e.message);
}

module.exports = db;
