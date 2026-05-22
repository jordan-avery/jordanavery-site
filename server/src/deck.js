const COLORS = ['red', 'yellow', 'blue', 'green'];

function buildDeck(deckNum) {
  const cards = [];
  for (const color of COLORS) {
    cards.push({ id: `d${deckNum}-${color}-0`, color, type: 'number', value: 0 });
    for (let n = 1; n <= 9; n++) {
      cards.push({ id: `d${deckNum}-${color}-${n}-a`, color, type: 'number', value: n });
      cards.push({ id: `d${deckNum}-${color}-${n}-b`, color, type: 'number', value: n });
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      cards.push({ id: `d${deckNum}-${color}-${type}-a`, color, type, value: null });
      cards.push({ id: `d${deckNum}-${color}-${type}-b`, color, type, value: null });
    }
  }
  for (const letter of ['a', 'b', 'c', 'd']) {
    cards.push({ id: `d${deckNum}-wild-${letter}`, color: 'wild', type: 'wild', value: null });
    cards.push({ id: `d${deckNum}-wild4-${letter}`, color: 'wild', type: 'wild4', value: null });
  }
  return cards;
}

export function createFullDeck() {
  return [...buildDeck(1), ...buildDeck(2)];
}

export function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getCardTypeKey(card) {
  if (card.type === 'wild') return 'wild';
  if (card.type === 'wild4') return 'wild4';
  if (card.type === 'number') return `${card.color}-${card.value}`;
  return `${card.color}-${card.type}`;
}
