const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePositiveId,
  parsePrice,
  sanitizeAccompanimentInput,
  sanitizeOrderInput,
  sanitizeProductInput,
} = require('../utils/sanitize');

test('parsePositiveId accepts only positive integers', () => {
  assert.equal(parsePositiveId('12'), 12);
  assert.equal(parsePositiveId(0), null);
  assert.equal(parsePositiveId('-1'), null);
  assert.equal(parsePositiveId('1.5'), null);
});

test('parsePrice accepts decimal commas and rounds to cents', () => {
  assert.equal(parsePrice('29,90'), 29.9);
  assert.equal(parsePrice(12.345), 12.35);
  assert.equal(parsePrice('-0,01'), null);
  assert.equal(parsePrice('not a price'), null);
});

test('sanitizeProductInput trims and normalizes a valid product', () => {
  assert.deepEqual(sanitizeProductInput({
    name: '  Marmita da casa  ',
    price: '32,90',
    desc: '  Feita no dia  ',
    category: 'marmita',
    image: '/uploads/marmita-01.webp',
    protein: '  Frango  ',
    sides: 'Arroz, feijão',
  }), {
    name: 'Marmita da casa',
    price: 32.9,
    desc: 'Feita no dia',
    category: 'marmita',
    image: '/uploads/marmita-01.webp',
    details: { protein: 'Frango', sides: 'Arroz, feijão' },
  });
});

test('sanitizeProductInput rejects invalid category, image path, and name', () => {
  assert.match(sanitizeProductInput({ name: 'Prato', price: 20, category: 'outro' }).error, /Categoria/);
  assert.match(sanitizeProductInput({ name: 'Prato', price: 20, image: '/uploads/../private.png' }).error, /imagem/);
  assert.match(sanitizeProductInput({ name: ' ', price: 20 }).error, /Nome/);
});

test('sanitizeOrderInput normalizes details and bounds item quantities', () => {
  const result = sanitizeOrderInput({
    service_channel: 'DELIVERY',
    customer: '  Cliente de teste  ',
    phone: '(48) 99900-1111 abc',
    total: '45,90',
    items: [
      { id: '2', name: '  Marmita  ', price: '29,90', qty: 120 },
      { id: 0, name: 'Item inválido', price: 1, qty: 1 },
    ],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.serviceChannel, 'delivery');
  assert.equal(result.customer, 'Cliente de teste');
  assert.equal(result.total, 45.9);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], { id: 2, name: 'Marmita', price: 29.9, qty: 99 });
});

test('sanitizeOrderInput rejects unsupported and incomplete orders', () => {
  assert.match(sanitizeOrderInput({ customer: 'Cliente', phone: '48999999999', serviceChannel: 'other' }).error, /Canal/);
  assert.match(sanitizeOrderInput({ customer: '', phone: '48999999999' }).error, /Nome/);
  assert.match(sanitizeOrderInput({ customer: 'Cliente', phone: '' }).error, /telefone/);
});

test('sanitizeAccompanimentInput trims its name and bounds sort order', () => {
  assert.deepEqual(sanitizeAccompanimentInput({ name: '  Salada  ', extra_price: '2,50', sort_order: 5000 }), {
    name: 'Salada',
    extra_price: 2.5,
    sort_order: 999,
  });
  assert.match(sanitizeAccompanimentInput({ name: ' ' }).error, /Nome/);
});
