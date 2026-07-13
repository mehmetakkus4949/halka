// PostgreSQL bağlantısı — Leapcell (veya Render/Railway/Supabase gibi herhangi bir
// PostgreSQL sağlayan servis) tarafından verilen DATABASE_URL bağlantı dizesini kullanır.
// Yerelde test için de aynı DATABASE_URL'i (uzaktaki ücretsiz Postgres'i) kullanabilirsin —
// böylece "yerel" ve "canlı" ayrımı olmadan tek bir gerçek veritabanı vardır.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n[HATA] DATABASE_URL ortam değişkeni ayarlanmamış.');
  console.error('Örnek: DATABASE_URL=postgres://kullanici:sifre@host:5432/veritabani\n');
  process.exit(1);
}

const useSSL = !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[db] beklenmeyen havuz hatası:', err.message);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      ad            TEXT NOT NULL,
      soyad         TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id             SERIAL PRIMARY KEY,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category       TEXT NOT NULL,
      title          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      details_json   TEXT NOT NULL DEFAULT '{}',
      lat            DOUBLE PRECISION,
      lng            DOUBLE PRECISION,
      photo_data_url TEXT,
      status         TEXT NOT NULL DEFAULT 'aktif',
      stage_idx      INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tips (
      id         SERIAL PRIMARY KEY,
      alert_id   INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_tips_alert ON tips(alert_id);
  `);
  console.log('[db] PostgreSQL şeması hazır.');
}

module.exports = { pool, initSchema };
