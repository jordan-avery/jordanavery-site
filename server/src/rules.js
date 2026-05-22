export function canPlayOnTurn(card, currentColor, topCard, pendingDrawType) {
  if (pendingDrawType) {
    if (pendingDrawType === '+2') return card.type === 'draw2';
    if (pendingDrawType === '+4') return card.type === 'wild4';
    return false;
  }
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === currentColor) return true;
  if (topCard.type === 'number' && card.type === 'number' && card.value === topCard.value) return true;
  if (topCard.type !== 'number' && topCard.type !== 'wild' && topCard.type !== 'wild4' &&
      card.type === topCard.type) return true;
  return false;
}

export function canPlayOutOfTurn(card, topCard, currentColor) {
  if (card.type === 'wild' && topCard.type === 'wild') return true;
  if (card.type === 'wild4' && topCard.type === 'wild4') return true;
  if (card.type === 'number' && topCard.type === 'number') {
    return card.color === currentColor && card.value === topCard.value;
  }
  if (['skip', 'reverse', 'draw2'].includes(card.type)) {
    return card.color === currentColor && card.type === topCard.type;
  }
  return false;
}

export function canStackDraw(card, pendingDrawType) {
  if (pendingDrawType === '+2') return card.type === 'draw2';
  if (pendingDrawType === '+4') return card.type === 'wild4';
  return false;
}

export function hasEligibleCard(hand, currentColor, topCard, pendingDrawType) {
  return hand.some(card => canPlayOnTurn(card, currentColor, topCard, pendingDrawType));
}

export function canPlayInStarting(card, currentColor, topCard) {
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === currentColor) return true;
  if (topCard.type === 'number' && card.type === 'number' && card.value === topCard.value) return true;
  if (topCard.type !== 'number' && topCard.type !== 'wild' && topCard.type !== 'wild4' &&
      card.type === topCard.type) return true;
  return false;
}
