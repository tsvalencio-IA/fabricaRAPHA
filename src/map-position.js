const NULL_ISLAND_EPSILON = 0.0001;

function coordinateNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isValidPosition(position) {
  if (!position || typeof position !== 'object') return false;

  const latitude = coordinateNumber(position.latitude);
  const longitude = coordinateNumber(position.longitude);
  if (latitude === null || longitude === null) return false;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;

  // Muitos rastreadores usam 0,0 enquanto ainda nao possuem um fix GPS.
  // Tratar esse placeholder como uma posicao real desloca o mapa para o oceano.
  return Math.abs(latitude) > NULL_ISLAND_EPSILON || Math.abs(longitude) > NULL_ISLAND_EPSILON;
}

export function getLatLng(position) {
  if (!isValidPosition(position)) return null;
  return [Number(position.latitude), Number(position.longitude)];
}
