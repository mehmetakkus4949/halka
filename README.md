# Çember — kayıp/çalıntı bildirim ağı

Gerçek, kalıcı **PostgreSQL** veritabanı + kendi yazdığım JWT-benzeri kimlik doğrulama +
hız sınırlama içeren bir uygulama. Aynı sunucu hem API'yi hem de arayüzü (`index.html`) servis eder.

## Yerelde çalıştırmak için

1. Bir PostgreSQL veritabanına ihtiyacın var (yerel kurulum ya da ücretsiz bulut Postgres — aşağıya bak).
2. Bağımlılıkları kur:
   ```bash
   npm install
   ```
3. Ortam değişkenlerini ayarla (`.env` dosyası kullanmıyoruz, doğrudan terminalde ayarla veya barındırma panelinde gir):
   - `DATABASE_URL` → `postgres://kullanici:sifre@host:5432/veritabani`
   - `JWT_SECRET` → rastgele uzun bir metin
4. (İsteğe bağlı) örnek veriyle başlat:
   ```bash
   npm run seed
   ```
5. Sunucuyu başlat:
   ```bash
   npm start
   ```
6. Tarayıcıda `http://localhost:3000` adresini aç.

## Ücretsiz, kalıcı barındırma: Leapcell

2026 itibarıyla Railway/Fly.io/Koyeb gibi platformlar artık ya ücretli ya da yeni kayıtlara kapalı.
**Leapcell.io** şu an kredi kartı istemeyen ve gerçekten kalıcı, ücretsiz bir PostgreSQL sunan
platformlardan biri. Adımlar:

1. **leapcell.io**'da ücretsiz hesap oluştur
2. Panelde **"Create Database"** → PostgreSQL seç, bir isim ver, bölge seç
3. Oluşan veritabanının bağlantı bilgilerini (host, port, kullanıcı adı, şifre, veritabanı adı) not al
   - Bunlardan şu formatta bir `DATABASE_URL` oluştur:
     `postgres://KULLANICI:SIFRE@HOST:5432/VERITABANI?sslmode=require`
4. Bu projeyi GitHub'a yükle (bkz. aşağıdaki "GitHub'a yükleme" bölümü)
5. Leapcell panelinde **"Create Service"** → GitHub reposunu seç
6. Leapcell otomatik olarak `npm install` + `npm start` komutlarını algılayacak (bizim `package.json`
   zaten repo kökünde olduğu için ekstra "root directory" ayarına gerek yok)
7. **Environment Variables** kısmına ekle:
   - `DATABASE_URL` → 3. adımdaki bağlantı dizesi
   - `JWT_SECRET` → rastgele uzun bir metin
8. **Submit/Deploy** — birkaç dakika içinde Leapcell sana bir adres verecek (örn. `senin-projen.leapcell.dev`)
9. O adresi tarayıcıda aç — kayıt ol, bildirim oluştur, sonra "Redeploy" yapıp verinin hâlâ orada olduğunu doğrula

## GitHub'a yükleme (git komutu kullanmadan, tarayıcıdan)

1. github.com'da yeni bir repo oluştur (Public, README/.gitignore/license eklemeden)
2. Repo sayfasında **"uploading an existing file"** linkine tıkla
3. Bu klasördeki **her şeyi** sürükleyip bırak: `index.html`, `manifest.json`, `service-worker.js`,
   `icons/`, `src/`, `package.json`
   - `node_modules/` klasörü varsa **yükleme**
4. "Commit changes"

## Uçlar (endpoints)

| Metod | Yol | Açıklama | Yetki |
|---|---|---|---|
| POST | `/api/auth/register` | `{ad, soyad, email, password}` → `{token, user}` | Açık |
| POST | `/api/auth/login` | `{email, password}` → `{token, user}` | Açık |
| GET | `/api/auth/me` | Oturum sahibinin bilgisi | Bearer token |
| GET | `/api/alerts?status=aktif&category=bisiklet&lat=..&lng=..` | Liste (mesafeye göre sıralı) | Açık |
| GET | `/api/alerts/:id?lat=..&lng=..` | Tek bildirim + ipuçları + mesafe | Açık |
| POST | `/api/alerts` | `{category, title, description, details, lat, lng, photoDataUrl}` | Bearer token |
| POST | `/api/alerts/:id/tips` | `{text}` | Bearer token |
| PATCH | `/api/alerts/:id/found` | Sadece sahibi kapatabilir | Bearer token |

## Önemli dürüstlük notu

Bu PostgreSQL sürümünü, önceki SQLite sürümü gibi burada gerçek bir veritabanına bağlayıp
uçtan uca çalıştırarak test edemedim — bu ortamda internet erişimim yok, bu yüzden `pg`
paketini kuramadım ve gerçek bir Postgres sunucusuna bağlanamadım. Kod, node-postgres (`pg`)
kütüphanesinin standart ve yaygın kullanılan desenlerini takip ediyor, ama SQLite sürümündeki
gibi "gerçekten çalıştırıp doğruladım" diyemiyorum. İlk çalıştırmada bir hata alırsan tam hata
mesajını paylaş, birlikte düzeltelim.

## Bilinçli olarak eksik bırakılanlar

- **Push bildirimi** — sadece veritabanında aşama güncelleniyor, cihazlara bildirim gitmiyor.
- **E-posta/telefon doğrulama** — herkes rastgele bir e-postayla kayıt olabiliyor.
- **Gerçek CAPTCHA** — reCAPTCHA/hCaptcha sunucu tarafı doğrulaması yok, sadece hız sınırlama var.
- **Fotoğraf depolama** — fotoğraflar veritabanında base64 metin olarak saklanıyor; çok sayıda/büyük
  fotoğraf, ücretsiz Postgres'in depolama kotasını (genelde birkaç yüz MB - 1GB) hızla doldurabilir.
  Üretimde S3/Cloudinary gibi ayrı bir depolamaya geçmek gerekir.
- **Token iptali** — token süresi dolana kadar geçerli, çalınırsa elle iptal edilemez.
