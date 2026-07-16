// Şifre hashleme ve token imzalama — sadece Node'un yerleşik 'crypto' modülüyle.
// bcryptjs/jsonwebtoken paketlerine ihtiyaç yok.
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'DEV-ONLY-DEGISTIR-BU-ANAHTARI';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  try {
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const checkBuf = Buffer.from(check, 'hex');
    // zamanlama saldırılarına karşı sabit zamanlı karşılaştırma
    return hashBuf.length === checkBuf.length && crypto.timingSafeEqual(hashBuf, checkBuf);
  } catch {
    return false;
  }
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

// Basit JWT benzeri imzalı token: header.payload.signature (HMAC-SHA256)
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const p1 = b64url(JSON.stringify(header));
  const p2 = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(`${p1}.${p2}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${p1}.${p2}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p1, p2, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SECRET).update(`${p1}.${p2}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Zamanlama saldırılarına karşı sabit zamanlı karşılaştırma (verifyPassword'daki gibi).
  // Uzunluklar farklıysa timingSafeEqual hata fırlatır, önce onu kontrol ediyoruz.
  const sigBuf = Buffer.from(sig || '');
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(p2));
    if (payload.exp && Date.now() > payload.exp) return null; // süresi dolmuş
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
