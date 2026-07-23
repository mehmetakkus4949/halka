// Kategoriye göre zorunlu detay alanları. Frontend'deki CATS yapısının bir aynası —
// backend bunu bağımsız olarak doğrular ki biri isteği doğrudan API'ye gönderip
// frontend doğrulamasını atlatmaya çalışırsa da reddedilsin.
const REQUIRED_FIELDS = {
  bisiklet: [
    { key: 'marka', label: 'Marka / model' },
    { key: 'renk', label: 'Renk' },
  ],
  motor: [
    { key: 'marka', label: 'Marka / model' },
    { key: 'renk', label: 'Renk' },
  ],
  arac: [
    { key: 'plaka', label: 'Plaka' },
    { key: 'marka', label: 'Marka / model' },
    { key: 'renk', label: 'Renk' },
  ],
  evcil: [
    { key: 'tur', label: 'Tür' },
    { key: 'isim', label: 'İsmi' },
    { key: 'renk', label: 'Renk' },
  ],
  kisi: [
    { key: 'yas', label: 'Yaklaşık yaş' },
    { key: 'kiyafet', label: 'Üzerindeki kıyafet' },
  ],
};

// details: kullanıcının gönderdiği { alanAdı: değer } nesnesi.
// Dönüş: eksik alan yoksa null, varsa ilk eksik alanın Türkçe hata mesajı.
function findMissingRequiredField(category, details) {
  const required = REQUIRED_FIELDS[category] || [];
  const d = details || {};
  for (const f of required) {
    const val = d[f.key];
    if (!val || typeof val !== 'string' || !val.trim() || val.trim() === '—') {
      return `"${f.label}" alanı bu kategori için zorunludur.`;
    }
  }
  return null;
}

module.exports = { REQUIRED_FIELDS, findMissingRequiredField };
