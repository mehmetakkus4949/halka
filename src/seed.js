// Örnek veriyle veritabanını doldurur. Çalıştır: npm run seed
const db = require('./db');
const { hashPassword } = require('./auth-utils');

const existing = db.prepare('SELECT COUNT(*) c FROM users').get();
if (existing.c > 0) {
  console.log('Veritabanında zaten veri var, seed atlanıyor.');
  console.log('Sıfırdan başlamak için backend/data/cember.db dosyasını silin.');
  process.exit(0);
}

const hash = hashPassword('sifre1234');
const info = db.prepare('INSERT INTO users (ad, soyad, email, password_hash) VALUES (?, ?, ?, ?)')
  .run('Demo', 'Kullanıcı', 'demo@cember.app', hash);
const userId = info.lastInsertRowid;

const insertAlert = db.prepare(`
  INSERT INTO alerts (user_id, category, title, description, details_json, status, stage_idx, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

insertAlert.run(
  userId, 'bisiklet', 'Kırmızı şehir bisikleti çalındı',
  'Apartman girişindeki bisiklet standından çalındı. Gidon üzerinde siyah bant var.',
  JSON.stringify({ marka: 'Bianchi', renk: 'Kırmızı', seri: '—' }),
  'aktif', 2, '-68 minutes'
);
insertAlert.run(
  userId, 'evcil', 'Kahverengi golden retriever kayboldu',
  'Park yürüyüşü sırasında tasması koptu ve kaçtı. Boynunda mavi tasma var.',
  JSON.stringify({ tur: 'Köpek', isim: 'Zeki', cins: 'Golden retriever', renk: 'Kahverengi' }),
  'aktif', 3, '-210 minutes'
);
insertAlert.run(
  userId, 'arac', 'Gri Fiat Egea çalındı',
  'Site otoparkından gece saatlerinde çalındı, plaka bilgisi polis raporunda mevcut.',
  JSON.stringify({ plaka: '35 ABC 123', marka: 'Fiat Egea', renk: 'Gri', yil: '2019' }),
  'aktif', 1, '-8 minutes'
);

console.log('Seed tamamlandı. Demo kullanıcı: demo@cember.app / sifre1234');
