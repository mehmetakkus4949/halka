// Kategoriye göre farklı yarıçap genişleme takvimleri.
// Kayıp kişi/hayvan çok daha uzağa gidebilir ve daha acil olduğu için
// bisiklet/araca göre daha hızlı ve daha geniş yayılır.
const STAGES_BY_CATEGORY = {
  bisiklet: [
    { label: '500 m', minutes: 0 },
    { label: '2 km', minutes: 15 },
    { label: '5 km', minutes: 60 },
    { label: '20 km', minutes: 180 },
  ],
  motor: [
    { label: '500 m', minutes: 0 },
    { label: '3 km', minutes: 10 },
    { label: '10 km', minutes: 30 },
    { label: '40 km', minutes: 90 },
  ],
  arac: [
    { label: '500 m', minutes: 0 },
    { label: '2 km', minutes: 15 },
    { label: '5 km', minutes: 60 },
    { label: '20 km', minutes: 180 },
  ],
  evcil: [
    { label: '500 m', minutes: 0 },
    { label: '2 km', minutes: 10 },
    { label: '10 km', minutes: 45 },
    { label: '30 km', minutes: 120 },
  ],
  kisi: [
    { label: '1 km', minutes: 0 },
    { label: '5 km', minutes: 10 },
    { label: '20 km', minutes: 30 },
    { label: '50 km', minutes: 90 },
  ],
};

const CATEGORIES = Object.keys(STAGES_BY_CATEGORY);

// Geriye dönük uyumluluk için: eski yerler hâlâ "STAGES" tek dizi bekleyebilir.
const STAGES = STAGES_BY_CATEGORY.bisiklet;

function getStages(category) {
  return STAGES_BY_CATEGORY[category] || STAGES_BY_CATEGORY.bisiklet;
}

function stageForElapsedMinutes(category, elapsedMin) {
  const stages = getStages(category);
  let idx = 0;
  for (let i = 0; i < stages.length; i++) {
    if (elapsedMin >= stages[i].minutes) idx = i;
  }
  return idx;
}

module.exports = { STAGES, STAGES_BY_CATEGORY, CATEGORIES, getStages, stageForElapsedMinutes };
