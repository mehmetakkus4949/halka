// Sıfır bağımlılıklı Çember API sunucusu.
// Sadece Node'un yerleşik modülleriyle yazıldı: http, node:sqlite, crypto.
// Çalıştırmak için: node src/server.js  (npm install GEREKMEZ)
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth-utils');
const { STAGES, CATEGORIES, stageForElapsedMinutes } = require('./stages');
const { haversineKm } = require('./geo');

const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());

// Frontend dosyaları (index.html, manifest.json, service-worker.js, icons/) burada,
// backend klasörünün bir üstünde duruyor.
const FRONTEND_DIR = path.join(__dirname, '..', '..');
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

  // Dizin dışına çıkmayı engelle (basit path-traversal koruması)
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403); return res.end('Yasak.');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı.'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- basit bellek içi hız sınırlama (IP başına) ----------
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

// ---------- yardımcılar ----------
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

function elapsedMinutes(createdAtIso) {
  const created = new Date(createdAtIso.replace(' ', 'T') + 'Z').getTime();
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

// ---------- yarıçap genişleme görevi: gerçek zamana göre çalışır ----------
function radiusTick() {
  const rows = db.prepare("SELECT id, created_at, stage_idx FROM alerts WHERE status = 'aktif'").all();
  const update = db.prepare("UPDATE alerts SET stage_idx = ?, updated_at = datetime('now') WHERE id = ?");
  for (const row of rows) {
    const elapsed = elapsedMinutes(row.created_at);
    const correct = stageForElapsedMinutes(elapsed);
    if (correct !== row.stage_idx) {
      update.run(correct, row.id);
      console.log(`[yarıçap] bildirim #${row.id} -> aşama ${correct} (${elapsed} dk geçti)`);
    }
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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return sendJson(res, 409, { error: 'Bu e-posta ile zaten bir hesap var.' });

  const hash = hashPassword(password);
  const info = db.prepare('INSERT INTO users (ad, soyad, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(ad.trim(), soyad.trim(), email.toLowerCase().trim(), hash);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
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

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendJson(res, 401, { error: 'E-posta veya şifre hatalı.' });
  }
  const token = signToken({ sub: user.id, email: user.email });
  sendJson(res, 200, { token, user: publicUser(user) });
}

function handleMe(req, res) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authUser.id);
  if (!user) return sendJson(res, 404, { error: 'Kullanıcı bulunamadı.' });
  sendJson(res, 200, { user: publicUser(user) });
}

function handleListAlerts(req, res, query) {
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (query.status) { sql += ' AND status = ?'; params.push(query.status); }
  if (query.category) { sql += ' AND category = ?'; params.push(query.category); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params);
  const tipCounts = db.prepare('SELECT alert_id, COUNT(*) c FROM tips GROUP BY alert_id').all();
  const tipMap = Object.fromEntries(tipCounts.map(t => [t.alert_id, t.c]));

  const viewerLat = query.lat !== undefined ? Number(query.lat) : null;
  const viewerLng = query.lng !== undefined ? Number(query.lng) : null;

  let alerts = rows.map(r => serializeAlert(r, tipMap[r.id], viewerLat, viewerLng));
  if (viewerLat !== null && viewerLng !== null) {
    alerts.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }
  sendJson(res, 200, { alerts });
}

function handleGetAlert(req, res, id, query) {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  if (!alert) return sendJson(res, 404, { error: 'Bildirim bulunamadı.' });
  const tips = db.prepare(`
    SELECT tips.id, tips.text, tips.created_at, users.ad, users.soyad
    FROM tips JOIN users ON users.id = tips.user_id
    WHERE alert_id = ? ORDER BY tips.created_at DESC
  `).all(id);
  const viewerLat = query.lat !== undefined ? Number(query.lat) : null;
  const viewerLng = query.lng !== undefined ? Number(query.lng) : null;
  sendJson(res, 200, {
    alert: serializeAlert(alert, tips.length, viewerLat, viewerLng),
    tips: tips.map(t => ({ id: t.id, text: t.text, createdAt: t.created_at, by: `${t.ad} ${t.soyad}`.trim() })),
  });
}

async function handleCreateAlert(req, res, ip) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  if (!checkRateLimit(ip, 'create', 10, 10 * 60 * 1000)) {
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

  const info = db.prepare(`
    INSERT INTO alerts (user_id, category, title, description, details_json, lat, lng, photo_data_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    authUser.id, category, title.trim().slice(0, 200), (description || '').trim().slice(0, 2000),
    JSON.stringify(details || {}), typeof lat === 'number' ? lat : null, typeof lng === 'number' ? lng : null,
    photo,
  );
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(info.lastInsertRowid);
  sendJson(res, 201, { alert: serializeAlert(alert, 0, lat, lng) });
}

async function handleAddTip(req, res, id, ip) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  if (!checkRateLimit(ip, 'create', 10, 10 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Kısa sürede çok fazla işlem yapıldı.' });
  }
  const body = await readJsonBody(req);
  if (!body.text || !body.text.trim()) return sendJson(res, 400, { error: 'İpucu metni boş olamaz.' });
  const alert = db.prepare('SELECT id FROM alerts WHERE id = ?').get(id);
  if (!alert) return sendJson(res, 404, { error: 'Bildirim bulunamadı.' });

  const info = db.prepare('INSERT INTO tips (alert_id, user_id, text) VALUES (?, ?, ?)')
    .run(id, authUser.id, body.text.trim().slice(0, 1000));
  const tip = db.prepare(`
    SELECT tips.id, tips.text, tips.created_at, users.ad, users.soyad
    FROM tips JOIN users ON users.id = tips.user_id WHERE tips.id = ?
  `).get(info.lastInsertRowid);
  sendJson(res, 201, { tip: { id: tip.id, text: tip.text, createdAt: tip.created_at, by: `${tip.ad} ${tip.soyad}`.trim() } });
}

function handleMarkFound(req, res, id) {
  const authUser = getAuthUser(req);
  if (!authUser) return sendJson(res, 401, { error: 'Yetkilendirme gerekli.' });
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  if (!alert) return sendJson(res, 404, { error: 'Bildirim bulunamadı.' });
  if (alert.user_id !== authUser.id) return sendJson(res, 403, { error: 'Sadece bildirim sahibi bunu kapatabilir.' });
  db.prepare("UPDATE alerts SET status = 'bulundu', updated_at = datetime('now') WHERE id = ?").run(id);
  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  sendJson(res, 200, { alert: serializeAlert(updated, 0) });
}

// ---------- ana sunucu ----------
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const origin = req.headers.origin;
  const allowOrigin = CORS_ORIGINS.includes('*') ? '*' : (CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    if (path === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }
    if (path === '/api/auth/register' && req.method === 'POST') return await handleRegister(req, res, ip);
    if (path === '/api/auth/login' && req.method === 'POST') return await handleLogin(req, res, ip);
    if (path === '/api/auth/me' && req.method === 'GET') return handleMe(req, res);

    if (path === '/api/alerts' && req.method === 'GET') return handleListAlerts(req, res, query);
    if (path === '/api/alerts' && req.method === 'POST') return await handleCreateAlert(req, res, ip);

    const alertMatch = path.match(/^\/api\/alerts\/(\d+)$/);
    if (alertMatch && req.method === 'GET') return handleGetAlert(req, res, Number(alertMatch[1]), query);

    const tipMatch = path.match(/^\/api\/alerts\/(\d+)\/tips$/);
    if (tipMatch && req.method === 'POST') return await handleAddTip(req, res, Number(tipMatch[1]), ip);

    const foundMatch = path.match(/^\/api\/alerts\/(\d+)\/found$/);
    if (foundMatch && req.method === 'PATCH') return handleMarkFound(req, res, Number(foundMatch[1]));

    if (path.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Bulunamadı.' });
    }
    if (req.method === 'GET') {
      return serveStaticFile(req, res, path);
    }
    sendJson(res, 404, { error: 'Bulunamadı.' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Sunucu hatası.' });
  }
});

server.listen(PORT, () => {
  if (!process.env.JWT_SECRET) {
    console.warn('\n[UYARI] JWT_SECRET ortam değişkeni ayarlanmamış, varsayılan (güvensiz) anahtar kullanılıyor.');
    console.warn('İnternete açık bir yere deploy ediyorsan bunu MUTLAKA ayarla, yoksa oturum tokenları tahmin edilebilir olur.\n');
  }
  console.log(`Çember API + arayüz http://localhost:${PORT} adresinde çalışıyor`);
  console.log(`Uygulamayı kullanmak için tarayıcıda şunu aç: http://localhost:${PORT}`);
  console.log('(index.html dosyasını file:// ile açmak yerine bunu kullan — konum servisi ancak böyle güvenilir çalışır)');
  radiusTick();
  setInterval(radiusTick, 60 * 1000);
});

module.exports = server;
