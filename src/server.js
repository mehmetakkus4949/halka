// Çember API sunucusu — PostgreSQL (pg) + Node'un yerleşik http modülü.
// Çalıştırmak için: DATABASE_URL ortam değişkenini ayarlayıp `node src/server.js`
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pool, initSchema } = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth-utils');
const { STAGES, CATEGORIES, stageForElapsedMinutes } = require('./stages');
const { haversineKm } = require('./geo');

const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());

const FRONTEND_DIR = path.join(__dirname, '..');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStaticFile(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const filePath = path.normalize(path.join(FRONTEND_DIR, rel));
  // Dizin dışına çıkmayı engelle — sadece prefix değil, tam dizin sınırını kontrol et
  if (filePath !== FRONTEND_DIR && !filePath.startsWith(FRONTEND_DIR + path.sep)) {
    res.writeHead(403); return res.end('Yasak.');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı.'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- bellek içi hız sınırlama (gerçek istemci IP'si bazında) ----------
const rateBuckets = new Map();
function checkRateLimit(ip, key, max, windowMs) {
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const bucket = rateBuckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs; }
  bucket.count++;
  rateBuckets.set(bucketKey, bucket);
  return bucket.count <= max;
}

// Render/Railway/Vercel gibi ters proxy arkasında çalışırken req.socket.remoteAddress
// her zaman proxy'nin kendi IP'sini gösterir — bu da hız sınırlamasının herkes için
// ortak (yanlışlıkla paylaşılan) çalışmasına yol açar. Gerçek istemci IP'si
// X-Forwarded-For başlığında gelir (ilk değer = gerçek istemci).
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 6_000_000) { req.destroy(); reject(new Error('Payload too large')); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Geçersiz JSON gövdesi')); }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return { id: payload.sub, email: payload.email };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return { id: row.id, ad: row.ad, soyad: row.soyad, email: row.email, created_at: row.created_at };
}

function elapsedMinutes(createdAt) {
  const created = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return Math.floor((Date.now() - created) / 60000);
}

function serializeAlert(row, tipCount, viewerLat, viewerLng) {
  const distanceKm = haversineKm(viewerLat, viewerLng, row.lat, row.lng);
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    details: JSON.parse(row.details_json || '{}'),
    lat: row.lat,
    lng: row.lng,
    photoDataUrl: row.photo_data_url || null,
    status: row.status,
    stageIdx: row.stage_idx,
    stageLabel: STAGES[row.stage_idx] ? STAGES[row.stage_idx].label : STAGES[0].label,
    elapsedMinutes: elapsedMinutes(row.created_at),
    distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
    tipCount: tipCount || 0,
    createdAt: row.created_at,
    ownerId: row.user_id,
  };
}

// ---------- yarıçap genişleme görevi ----------
async function radiusTick() {
  try {
    const result = await pool.query("SELECT id, created_at, stage_idx FROM alerts WHERE status = 'aktif'");
    for (const row of result.rows) {
      const elapsed = elapsedMinutes(row.created_at);
      const correct = stageForElapsedMinutes(elapsed);
      if (correct !== row.stage_idx) {
        await pool.query('UPDATE alerts SET stage_idx = $1, updated_at = NOW() WHERE id = $2', [correct, row.id]);
        console.log(`[yarıçap] bildirim #${row.id} -> aşama ${correct} (${elapsed} dk geçti)`);
      }
    }
  } catch (err) {
    console.error('[yarıçap] görev hatası:', err.message);
  }
}

// ---------- route handler'lar ----------
async function handleRegister(req, res, ip) {
  if (!checkRateLimit(ip, 'auth', 20, 15 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Çok fazla deneme yapıldı, biraz sonra tekrar deneyin.' });
  }
  const body = await readJsonBody(req);
  const { ad, soyad, email, password } = body;

  if (!ad || !soyad || !email || !password) {
    return sendJson(res, 400, { error: 'Ad, soyad, e-posta ve şifre gereklidir.' });
  }
  if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Geçerli bir e-posta adresi girin.' });
  if (password.length < 8) return sendJson(res, 400, { error: 'Şifre en az 8 karakter olmalıdır.' });

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return sendJson(res, 409, { error: 'Bu e-posta ile zaten bir hesap var.' });

  const hash = hashPassword(password);
  const result = await pool.query(
    'INSERT INTO users (ad, soyad, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [ad.trim(), soyad.trim(), email.toLowerCase().trim(), hash]
  );
  const user = result.rows[0];
  const token = signToken({ sub: user.id, email: user.email });
  sendJson(res, 201, { token, user: publicUser(user) });
}

async function handleLogin(req, res, ip) {
  if (!checkRateLimit(ip, 'auth', 20, 15 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Çok fazla deneme yapıldı, biraz sonra tekrar deneyin.' });
  }
  const body = await readJsonBody(req);
  const { email, password } = body;
  if (!email || !password) return sendJson(res, 400, { error: 'E-posta ve şifre gereklidir.' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  const user = result.rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendJson(res, 401, { error: 'E-posta veya şifre hatalı.' });
  }
  const token = signToken({ sub: user.id, email: user.email });
  sendJson(res, 200, { token, user: publicUser(user) });
}

async function handleMe(req, res) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [authUser.id]);
  const user = result.rows[0];
  if (!user) return sendJson(res, 404, { error: 'Kullanıcı bulunamadı.' });
  sendJson(res, 200, { user: publicUser(user) });
}

async function handleListAlerts(req, res, query) {
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (query.status) { params.push(query.status); sql += ` AND status = $${params.length}`; }
  if (query.category) { params.push(query.category); sql += ` AND category = $${params.length}`; }
  sql += ' ORDER BY created_at DESC LIMIT 100';

  const rowsResult = await pool.query(sql, params);
  const tipCountsResult = await pool.query('SELECT alert_id, COUNT(*) c FROM tips GROUP BY alert_id');
  const tipMap = Object.fromEntries(tipCountsResult.rows.map(t => [t.alert_id, Number(t.c)]));

  const viewerLat = query.lat !== undefined ? Number(query.lat) : null;
  const viewerLng = query.lng !== undefined ? Number(query.lng) : null;

  let alerts = rowsResult.rows.map(r => serializeAlert(r, tipMap[r.id], viewerLat, viewerLng));
  if (viewerLat !== null && viewerLng !== null) {
    alerts.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }
  sendJson(res, 200, { alerts });
}

async function handleGetAlert(req, res, id, query) {
  const alertResult = await pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
  const alert = alertResult.rows[0];
  if (!alert) return sendJson(res, 404, { error: 'Bildirim bulunamadı.' });

  const tipsResult = await pool.query(`
    SELECT tips.id, tips.text, tips.created_at, users.ad, users.soyad
    FROM tips JOIN users ON users.id = tips.user_id
    WHERE alert_id = $1 ORDER BY tips.created_at DESC
  `, [id]);

  const viewerLat = query.lat !== undefined ? Number(query.lat) : null;
  const viewerLng = query.lng !== undefined ? Number(query.lng) : null;

  sendJson(res, 200, {
    alert: serializeAlert(alert, tipsResult.rows.length, viewerLat, viewerLng),
    tips: tipsResult.rows.map(t => ({ id: t.id, text: t.text, createdAt: t.created_at, by: `${t.ad} ${t.soyad}`.trim() })),
  });
}

async function handleCreateAlert(req, res, ip) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  if (!checkRateLimit(ip, 'create-alert', 10, 10 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Kısa sürede çok fazla bildirim oluşturuldu.' });
  }
  const body = await readJsonBody(req);
  const { category, title, description, details, lat, lng, photoDataUrl } = body;
  if (!CATEGORIES.includes(category)) return sendJson(res, 400, { error: 'Geçersiz kategori.' });
  if (!title || !title.trim()) return sendJson(res, 400, { error: 'Başlık gereklidir.' });

  let photo = null;
  if (photoDataUrl) {
    if (typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:image/')) {
      return sendJson(res, 400, { error: 'Geçersiz fotoğraf formatı.' });
    }
    if (photoDataUrl.length > 4_000_000) {
      return sendJson(res, 400, { error: 'Fotoğraf çok büyük (maksimum ~3MB).' });
    }
    photo = photoDataUrl;
  }

  const result = await pool.query(`
    INSERT INTO alerts (user_id, category, title, description, details_json, lat, lng, photo_data_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
  `, [
    authUser.id, category, title.trim().slice(0, 200), (description || '').trim().slice(0, 2000),
    JSON.stringify(details || {}), typeof lat === 'number' ? lat : null, typeof lng === 'number' ? lng : null,
    photo,
  ]);
  sendJson(res, 201, { alert: serializeAlert(result.rows[0], 0, lat, lng) });
}

async function handleAddTip(req, res, id, ip) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  if (!checkRateLimit(ip, 'create-tip', 15, 10 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Kısa sürede çok fazla işlem yapıldı.' });
  }
  const body = await readJsonBody(req);
  if (!body.text || !body.text.trim()) return sendJson(res, 400, { error: 'İpucu metni boş olamaz.' });

  const alertCheck = await pool.query('SELECT id FROM alerts WHERE id = $1', [id]);
  if (!alertCheck.rows[0]) return sendJson(res, 404, { error: 'Bildirim bulunamadı.' });

  const result = await pool.query(
    'INSERT INTO tips (alert_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
    [id, authUser.id, body.text.trim().slice(0, 1000)]
  );
  const userResult = await pool.query('SELECT ad, soyad FROM users WHERE id = $1', [authUser.id]);
  const u = userResult.rows[0];
  const tip = result.rows[0];
  sendJson(res, 201, { tip: { id: tip.id, text: tip.text, createdAt: tip.created_at, by: `${u.ad} ${u.soyad}`.trim() } });
}

async function handleMarkFound(req, res, id) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  const alertResult = await pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
  const alert = alertResult.rows[0];
  if (!alert) return sendJson(res, 404, { error: 'Bildirim bulunamadı.' });
  if (alert.user_id !== authUser.id) {
    return sendJson(res, 403, { error: 'Sadece bildirim sahibi bunu bulundu olarak işaretleyebilir.' });
  }
  const updated = await pool.query(
    "UPDATE alerts SET status = 'bulundu', updated_at = NOW() WHERE id = $1 RETURNING *", [id]
  );
  sendJson(res, 200, { alert: serializeAlert(updated.rows[0], 0) });
}

// ---------- ana sunucu ----------
const server = http.createServer(async (req, res) => {
  const ip = getClientIp(req);
  const origin = req.headers.origin;
  const allowOrigin = CORS_ORIGINS.includes('*') ? '*' : (CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    if (urlPath === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }
    if (urlPath === '/api/auth/register' && req.method === 'POST') return await handleRegister(req, res, ip);
    if (urlPath === '/api/auth/login' && req.method === 'POST') return await handleLogin(req, res, ip);
    if (urlPath === '/api/auth/me' && req.method === 'GET') return await handleMe(req, res);

    if (urlPath === '/api/alerts' && req.method === 'GET') return await handleListAlerts(req, res, query);
    if (urlPath === '/api/alerts' && req.method === 'POST') return await handleCreateAlert(req, res, ip);

    const alertMatch = urlPath.match(/^\/api\/alerts\/(\d+)$/);
    if (alertMatch && req.method === 'GET') return await handleGetAlert(req, res, Number(alertMatch[1]), query);

    const tipMatch = urlPath.match(/^\/api\/alerts\/(\d+)\/tips$/);
    if (tipMatch && req.method === 'POST') return await handleAddTip(req, res, Number(tipMatch[1]), ip);

    const foundMatch = urlPath.match(/^\/api\/alerts\/(\d+)\/found$/);
    if (foundMatch && req.method === 'PATCH') return await handleMarkFound(req, res, Number(foundMatch[1]));

    if (urlPath.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Bulunamadı.' });
    }
    if (req.method === 'GET') {
      return serveStaticFile(req, res, urlPath);
    }
    sendJson(res, 404, { error: 'Bulunamadı.' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Sunucu hatası.' });
  }
});

async function start() {
  if (!process.env.JWT_SECRET) {
    console.warn('\n[UYARI] JWT_SECRET ortam değişkeni ayarlanmamış, varsayılan (güvensiz) anahtar kullanılıyor.');
    console.warn('İnternete açık bir yere deploy ediyorsan bunu MUTLAKA ayarla.\n');
  }
  await initSchema();
  server.listen(PORT, () => {
    console.log(`Çember API + arayüz http://localhost:${PORT} adresinde çalışıyor`);
    console.log(`Uygulamayı kullanmak için tarayıcıda şunu aç: http://localhost:${PORT}`);
    radiusTick();
    setInterval(radiusTick, 60 * 1000);
    // Süresi dolmuş hız sınırlama kayıtlarını periyodik temizle (bellek şişmesin diye)
    setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of rateBuckets) {
        if (now > bucket.resetAt) rateBuckets.delete(key);
      }
    }, 10 * 60 * 1000);
  });
}

start().catch((err) => {
  console.error('Sunucu başlatılamadı:', err);
  process.exit(1);
});

module.exports = server;
