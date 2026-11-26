const placeImages = Object.freeze({
  coast: '/assets/coast.svg',
  hills: '/assets/hills.svg',
});
const fallbackImage = '/assets/fallback.svg';

function safeImagePath(value) {
  return Object.values(placeImages).includes(value) ? value : fallbackImage;
}

module.exports = { fallbackImage, placeImages, safeImagePath };
