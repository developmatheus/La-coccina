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

  // Detalhes por categoria
  const details = category === 'marmita'
    ? {
        protein: trimString(body.protein, 80),
        sides:   trimString(body.sides, 200),
      }
    : {
        volume:     trimString(body.volume, 30),
        serve_type: trimString(body.serve_type, 30),
      };

  return { name, price, desc, category, image, details };
}

function sanitizeOrderInput(body) {
  const customer = trimString(body.customer, 120);
  const address = trimString(body.address, 300);
  const phone = trimString(body.phone, 20).replace(/[^\d+()\s-]/g, '');
  const payment = trimString(body.payment, 30);
  const obs = trimString(body.obs, 500);
  const total = parsePrice(body.total) ?? 0;
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const items = rawItems
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: Number(item.id) || 0,
      name: trimString(item.name, 120),
      price: parsePrice(item.price) ?? 0,
      qty: Math.max(1, Math.min(99, Math.abs(Math.floor(Number(item.qty) || 1)))),
    }))
    .filter(item => item.id > 0 && item.name);

  if (!customer || !phone) {
    return { error: 'Nome e telefone são obrigatórios' };
  }

  return { customer, address, phone, payment, obs, total, items };
}

function sanitizeAccompanimentInput(body) {
  const name = trimString(body.name, 80);
  const extra_price = parsePrice(body.extra_price ?? 0) ?? 0;
  const sort_order = Math.max(0, Math.min(999, Math.floor(Number(body.sort_order) || 0)));

  if (!name) return { error: 'Nome do acompanhamento é obrigatório' };
  return { name, extra_price, sort_order };
}

function sanitizeProductAccompanimentsInput(body) {
  const is_customizable = body.is_customizable ? 1 : 0;
  const min_sides = Math.max(0, Math.min(20, Math.floor(Number(body.min_sides) || 0)));
  const max_sides = Math.max(0, Math.min(20, Math.floor(Number(body.max_sides) || 0)));
  const items = Array.isArray(body.items) ? body.items : [];
  const sanitizedItems = items
    .filter(i => i && Number.isInteger(Number(i.accompaniment_id)) && Number(i.accompaniment_id) > 0)
    .map(i => ({
      accompaniment_id: Number(i.accompaniment_id),
      is_default:   i.is_default   ? 1 : 0,
      is_available: i.is_available !== false ? 1 : 0,
    }));
  return { is_customizable, min_sides, max_sides, items: sanitizedItems };
}

module.exports = {
  ALLOWED_CATEGORIES,
  trimString,
  parsePositiveId,
  parsePrice,
  isAllowedCategory,
  sanitizeProductInput,
  sanitizeOrderInput,
  sanitizeAccompanimentInput,
  sanitizeProductAccompanimentsInput,
};
