import assert from 'node:assert/strict';
import test from 'node:test';
import { getLatLng, isValidPosition } from '../src/map-position.js';

test('aceita coordenadas GPS validas em numero ou texto', () => {
  assert.equal(isValidPosition({ latitude: -20.812249, longitude: -49.375975 }), true);
  assert.equal(isValidPosition({ latitude: '-23.55052', longitude: '-46.633308' }), true);
  assert.deepEqual(getLatLng({ latitude: '-23.55052', longitude: '-46.633308' }), [-23.55052, -46.633308]);
});

test('rejeita placeholders, campos vazios e limites invalidos', () => {
  assert.equal(isValidPosition({ latitude: 0, longitude: 0 }), false);
  assert.equal(isValidPosition({ latitude: '', longitude: '' }), false);
  assert.equal(isValidPosition({ latitude: 91, longitude: 0 }), false);
  assert.equal(isValidPosition({ latitude: 0, longitude: -181 }), false);
  assert.equal(isValidPosition(null), false);
});

test('nao produz LatLng para uma posicao invalida', () => {
  assert.equal(getLatLng({ latitude: 'erro', longitude: -49 }), null);
});
