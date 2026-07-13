// Örnek veriyle veritabanını doldurur. Çalıştır: node src/seed.js (DATABASE_URL ayarlı olmalı)
const { pool, initSchema } = require('./db');
const { hashPassword } = require('./auth-utils');

async function seed() {
  await initSchema();

  const existing = await pool.query('SELECT COUNT(*) c FROM users');
  if (Number(existing.rows[0].c) > 0) {
    console.log('Veritabanında zaten veri var, seed atlanıyor.');
    await pool.end();
    return;
  }

  const hash = hashPassword('sifre1234');
  const userResult = await pool.query(
    'INSERT INTO users (ad, soyad, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
    ['Demo', 'Kullanıcı', 'demo@cember.app', hash]
  );
  const userId = userResult.rows[0].id;

  const insertAlert = (category, title, description, details, stageIdx, minutesAgo) =>
    pool.query(`
      INSERT INTO alerts (user_id, category, title, description, details_json, status, stage_idx, created_at)
      VALUES ($1, $2, $3, $4, $5, 'aktif', $6, NOW() - ($7 || ' minutes')::interval)
    `, [userId, category, title, description, JSON.stringify(details), stageIdx, String(minutesAgo)]);

  await insertAlert('bisiklet', 'Kırmızı şehir bisikleti çalındı',
    'Apartman girişindeki bisiklet standından çalındı. Gidon üzerinde siyah bant var.',
    { marka: 'Bianchi', renk: 'Kırmızı', seri: '—' }, 2, 68);

  await insertAlert('evcil', 'Kahverengi golden retriever kayboldu',
    'Park yürüyüşü sırasında tasması koptu ve kaçtı. Boynunda mavi tasma var.',
    { tur: 'Köpek', isim: 'Zeki', cins: 'Golden retriever', renk: 'Kahverengi' }, 3, 210);

  await insertAlert('arac', 'Gri Fiat Egea çalındı',
    'Site otoparkından gece saatlerinde çalındı, plaka bilgisi polis raporunda mevcut.',
    { plaka: '35 ABC 123', marka: 'Fiat Egea', renk: 'Gri', yil: '2019' }, 1, 8);

  console.log('Seed tamamlandı. Demo kullanıcı: demo@cember.app / sifre1234');
  await pool.end();
}

seed().catch((e) => { console.error(e); process.exit(1); });
