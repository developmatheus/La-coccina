/**
 * Utilitários de sanitização e validação de entrada.
 */

const ALLOWED_CATEGORIES = new Set(['marmita', 'bebida']);

function trimString(value, maxLen) {
  const s = String(value ?? '').trim();
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function parsePositiveId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

function parsePrice(value) {
  const price = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(price) || price < 0 || price > 99999) return null;
  return Math.round(price * 100) / 100;
}

function isAllowedCategory(category) {
  return ALLOWED_CATEGORIES.has(category);
}

function sanitizeProductInput(body) {
  const name = trimString(body.name, 120);
  const price = parsePrice(body.price);
  const desc = trimString(body.desc, 500);
  const category = trimString(body.category, 20) || 'marmita';
  const image = trimString(body.image, 255);

  if (!name || price === null) {
    return { error: 'Nome e preço válidos são obrigatórios' };
  }
  if (!isAllowedCategory(category)) {
    return { error: 'Categoria inválida' };
  }
  if (image && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(image)) {
    return { error: 'URL de imagem inválida' };
  }

  return { name, price, desc, category, image };
}

function sanitizeOrderInput(body) {
  const customer = trimString(body.customer, 120);
  const address = trimString(body.address, 300);
  const phone = trimString(body.phone, 20).replace(/[^\d+()\s-]/g, '');
  const payment = trimString(body.payment, 30);
  const obs = trimString(body.obs, 500);
  const total = parsePrice(body.total) ?? 0;
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];

  if (!customer || !phone) {
    return { error: 'Nome e telefone são obrigatórios' };
  }

  return { customer, address, phone, payment, obs, total, items };
}

module.exports = {
  ALLOWED_CATEGORIES,
  trimString,
  parsePositiveId,
  parsePrice,
  isAllowedCategory,
  sanitizeProductInput,
  sanitizeOrderInput,
};
