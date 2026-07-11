# Çember API

Gerçek, dosya tabanlı SQLite veritabanı + kendi yazdığım JWT-benzeri kimlik doğrulama +
hız sınırlama içeren bir backend. Coğrafi mesafe hesabı ve fotoğraf yükleme desteği var.

## İki çalışma modu

**A) `npm install` ile (önerilen — better-sqlite3 kullanır)**
```bash
cd backend
npm install
npm run seed     # opsiyonel: demo kullanıcı + örnek bildirimler
npm start        # http://localhost:3000
```

**B) `npm install` yapmadan (Node'un yerleşik SQLite'ı ile, otomatik düşer)**
```bash
cd backend
node src/seed.js   # opsiyonel
node src/server.js
```
Bu modda Node 22.5+ gerekir (`node --version` ile kontrol et). `node:sqlite` hâlâ deneysel
bir özelliktir; `npm install` yapabiliyorsan (A) seçeneği daha sağlamdır.

Sunucu açılışta hangi motoru kullandığını loglar: `[db] motor: better-sqlite3 ...` veya
`[db] motor: node:sqlite (yerleşik, better-sqlite3 kurulu değil) ...`

Demo hesap (seed çalıştırdıysan): `demo@cember.app` / `sifre1234`

Veritabanı `backend/data/cember.db` dosyasında saklanır.

## Uçlar (endpoints)

| Metod | Yol | Açıklama | Yetki |
|---|---|---|---|
| POST | `/api/auth/register` | `{ad, soyad, email, password}` → `{token, user}` | Açık |
| POST | `/api/auth/login` | `{email, password}` → `{token, user}` | Açık |
| GET | `/api/auth/me` | Oturum sahibinin bilgisi | Bearer token |
| GET | `/api/alerts?status=aktif&category=bisiklet&lat=..&lng=..` | Liste (lat/lng verilirse mesafeye göre sıralı) | Açık |
| GET | `/api/alerts/:id?lat=..&lng=..` | Tek bildirim + ipuçları + mesafe | Açık |
| POST | `/api/alerts` | `{category, title, description, details, lat, lng, photoDataUrl}` | Bearer token |
| POST | `/api/alerts/:id/tips` | `{text}` | Bearer token |
| PATCH | `/api/alerts/:id/found` | Sadece sahibi kapatabilir | Bearer token |

## Coğrafi mesafe

`lat`/`lng` gönderirsen (bildirim oluştururken) ve listelerken kendi `lat`/`lng`'ini query
parametresi olarak verirsen, `src/geo.js`'teki Haversine formülüyle gerçek kilometre mesafesi
hesaplanır ve liste o mesafeye göre yakından uzağa sıralanır (`distanceKm` alanı). Koordinat
yoksa `distanceKm: null` döner — frontend bunu "mesafe bilinmiyor" olarak gösterir.

## Fotoğraf yükleme

Frontend, seçilen fotoğrafı tarayıcıda (canvas ile) maks. 900px kenara küçültüp JPEG olarak
sıkıştırır, sonra `photoDataUrl` (base64 data-URL) alanı olarak gönderir. Backend bunu
`alerts.photo_data_url` sütununda saklar. Basit ve bağımlılıksız ama küçük ölçek içindir —
ciddi bir üründe fotoğrafları S3/Cloudinary gibi bir nesne depolamaya yazıp veritabanına sadece
URL'yi kaydetmek çok daha verimlidir (veritabanı şişmez, CDN'den hızlı servis edilir).

## Kendi kendine test etmek istersen

```bash
curl http://localhost:3000/api/health

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"ad":"Test","soyad":"Kullanici","email":"test@ornek.com","password":"sifre12345"}'

# veritabanını doğrudan sorgula
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('./data/cember.db');
console.log(db.prepare('SELECT * FROM users').all());
console.log(db.prepare('SELECT id,title,lat,lng,photo_data_url FROM alerts').all());
"
```
(better-sqlite3 kurulduysa yukarıdaki node:sqlite yerine `require('better-sqlite3')` kullan.)

## Frontend'i buna bağlama

`../index.html` içindeki `API_BASE_URL` sabitini backend adresine ayarla (varsayılan
`http://localhost:3000`). Uygulama açılışta `/api/health`'e bakar; sunucu ayaktaysa gerçek
API'yi kullanır, kullanıcının konumunu ister (izin verirse mesafe hesabı çalışır), değilse
otomatik olarak yerel demo moduna düşer.

## Bilinçli olarak eksik bırakılanlar

- **Push bildirimi** — sadece veritabanında aşama güncelleniyor, cihazlara bildirim gitmiyor (Firebase Cloud Messaging gerekir).
- **E-posta/telefon doğrulama** — herkes rastgele bir e-postayla kayıt olabiliyor.
- **Gerçek CAPTCHA** — reCAPTCHA/hCaptcha sunucu tarafı doğrulaması yok, sadece basit hız sınırlama var.
- **Token iptali** — token süresi dolana kadar geçerli, çalınırsa elle iptal edilemez.
- **Fotoğraf depolama ölçeklenebilirliği** — base64 + SQLite küçük ölçek için yeterli, büyük kullanıcı sayısında obje depolamaya geçilmeli.
- **HTTPS ve gerçek hosting** — Render, Railway, Fly.io gibi bir servise deploy edilmeli; şu an sadece `localhost`.
