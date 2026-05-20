const test = require('node:test');
const assert = require('node:assert');

test('Pemeriksaan Dasar CI/CD (Basic Math)', () => {
  assert.strictEqual(1 + 1, 2);
});

test('Validasi Pengolahan String', () => {
  const message = "HexaObserve DevOps";
  assert.match(message, /DevOps/);
});
