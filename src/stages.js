const STAGES = [
  { label: '500 m', minutes: 0 },
  { label: '2 km', minutes: 15 },
  { label: '5 km', minutes: 60 },
  { label: '20 km', minutes: 180 },
];

const CATEGORIES = ['bisiklet', 'arac', 'evcil', 'kisi'];

function stageForElapsedMinutes(elapsedMin) {
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsedMin >= STAGES[i].minutes) idx = i;
  }
  return idx;
}

module.exports = { STAGES, CATEGORIES, stageForElapsedMinutes };
