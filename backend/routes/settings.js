const express = require('express');

const db = require('../db');
const {
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();
const EARTH_RADIUS_KM = 6371;
const DEFAULT_DELIVERY_AREA_FEE = 0;

async function getConfigValue(key) {
  const [rows] = await db.execute('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || '';
}

function normalizeDriverCancellationMode(value) {
  return value === 'admin_confirmation' ? 'admin_confirmation' : 'auto';
}

function normalizeDeliveryManagementEnabled(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeFeatureToggle(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeHighlightMode(value, fallback = 'border') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['border', 'badge', 'full'].includes(normalized) ? normalized : fallback;
}

function normalizeColorToken(value, fallback) {
  const normalized = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}

function normalizeDisplayMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['compacto', 'confortavel'].includes(normalized) ? normalized : 'confortavel';
}

function normalizeLocalServiceSettings(raw = {}) {
  return {
    enabled: normalizeFeatureToggle(raw.enabled),
    label: String(raw.label || '').trim() || 'Atendimento Local',
    color: normalizeColorToken(raw.color, '#d97706'),
    kanbanLocalHighlightMode: normalizeHighlightMode(raw.kanbanLocalHighlightMode, 'full'),
    kanbanDeliveryHighlightMode: normalizeHighlightMode(raw.kanbanDeliveryHighlightMode, 'border'),
    readyColumnEnabled: normalizeFeatureToggle(raw.readyColumnEnabled),
    commandPrefix: String(raw.commandPrefix || '').trim().slice(0, 10) || 'CMD',
    autoGenerateCommandCode: normalizeFeatureToggle(raw.autoGenerateCommandCode),
    requireWaiter: normalizeFeatureToggle(raw.requireWaiter),
    requireTable: normalizeFeatureToggle(raw.requireTable),
    allowTableTransfer: normalizeFeatureToggle(raw.allowTableTransfer),
    allowSplitPayment: normalizeFeatureToggle(raw.allowSplitPayment),
    pwaDisplayMode: normalizeDisplayMode(raw.pwaDisplayMode),
    primaryAccent: normalizeColorToken(raw.primaryAccent, '#f59e0b'),
  };
}

async function getLocalServiceSettings() {
  return normalizeLocalServiceSettings({
    enabled: await getConfigValue('localServiceEnabled'),
    label: await getConfigValue('localServiceLabel'),
    color: await getConfigValue('localServiceColor'),
    kanbanLocalHighlightMode: await getConfigValue('kanbanLocalHighlightMode'),
    kanbanDeliveryHighlightMode: await getConfigValue('kanbanDeliveryHighlightMode'),
    readyColumnEnabled: await getConfigValue('localReadyColumnEnabled'),
    commandPrefix: await getConfigValue('localCommandPrefix'),
    autoGenerateCommandCode: await getConfigValue('localAutoGenerateCommandCode'),
    requireWaiter: await getConfigValue('localRequireWaiter'),
    requireTable: await getConfigValue('localRequireTable'),
    allowTableTransfer: await getConfigValue('localAllowTableTransfer'),
    allowSplitPayment: await getConfigValue('localAllowSplitPayment'),
    pwaDisplayMode: await getConfigValue('localPwaDisplayMode'),
    primaryAccent: await getConfigValue('localPwaPrimaryAccent'),
  });
}

function slugifyArea(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toTitleCase(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeFee(value) {
  const normalized = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(normalized) && normalized >= 0 ? Number(normalized.toFixed(2)) : DEFAULT_DELIVERY_AREA_FEE;
}

function normalizeDeliveryArea(area, index = 0) {
  const city = toTitleCase(area?.city || '');
  const district = toTitleCase(area?.district || '');
  const fee = normalizeFee(area?.fee);
  const active = area?.active !== false;
  const id = String(area?.id || `${slugifyArea(city)}__${slugifyArea(district)}__${index}`).trim();

  return {
    id,
    city,
    district,
    fee,
    active,
  };
}

function isValidDeliveryArea(area) {
  return Boolean(area.city && area.district && Number.isFinite(area.fee) && area.fee >= 0);
}

function parseDeliveryAreas(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map();
    parsed
      .map((area, index) => normalizeDeliveryArea(area, index))
      .filter(isValidDeliveryArea)
      .forEach((area) => {
        const key = `${slugifyArea(area.city)}__${slugifyArea(area.district)}`;
        if (!unique.has(key)) unique.set(key, { ...area, id: area.id || key });
      });
    return Array.from(unique.values());
  } catch {
    return [];
  }
}

async function getDeliveryAreas() {
  return parseDeliveryAreas(await getConfigValue('deliveryAreas'));
}

function serializePublicDeliveryArea(area) {
  return {
    id: area.id,
    city: area.city,
    district: area.district,
    fee: area.fee,
    label: `${area.city} - ${area.district}`,
  };
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function toDegrees(value) {
  return value * (180 / Math.PI);
}

function offsetPoint(lat, lng, distanceKm, bearingDegrees) {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(lat);
  const lng1 = toRadians(lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: Number(toDegrees(lat2).toFixed(6)),
    lng: Number(toDegrees(lng2).toFixed(6)),
  };
}

function generateSamplePoints(origin, radiusKm) {
  const samples = [{ lat: origin.lat, lng: origin.lng }];
  const safeRadius = Math.max(1, Math.min(Number(radiusKm) || 0, 30));
  const ringStepKm = safeRadius <= 4 ? 1 : safeRadius <= 10 ? 2 : 3;
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];

  for (let distance = ringStepKm; distance <= safeRadius; distance += ringStepKm) {
    const roundedDistance = Number(distance.toFixed(2));
    bearings.forEach((bearing) => {
      samples.push(offsetPoint(origin.lat, origin.lng, roundedDistance, bearing));
    });
  }

  return samples;
}

async function googleGeocodeAddress(address, apiKey) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('region', 'br');

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.status !== 'OK' || !data.results?.[0]) {
    throw new Error(data.error_message || `Nao foi possivel localizar o endereco base (${data.status || response.status}).`);
  }

  const location = data.results[0].geometry?.location;
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    throw new Error('Google Maps nao retornou coordenadas validas para o endereco base.');
  }

  return {
    address,
    lat: Number(location.lat),
    lng: Number(location.lng),
  };
}

function pickAddressComponent(components, candidateTypes = []) {
  return components.find((component) => candidateTypes.some((type) => component.types?.includes(type)))?.long_name || '';
}

async function googleReverseGeocode(lat, lng, apiKey) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('region', 'br');

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || !['OK', 'ZERO_RESULTS'].includes(data.status)) {
    throw new Error(data.error_message || `Falha ao consultar o ponto ${lat},${lng}.`);
  }

  const components = data.results?.[0]?.address_components || [];
  const city = pickAddressComponent(components, ['administrative_area_level_2', 'locality']);
  const district = pickAddressComponent(components, ['sublocality', 'sublocality_level_1', 'neighborhood']);

  if (!city || !district) return null;

  return {
    city: toTitleCase(city),
    district: toTitleCase(district),
    source: 'google-grid-reverse-geocode',
  };
}

router.get('/admin', requireAdmin, async (_req, res) => {
  try {
    const restaurantOriginAddress = await getConfigValue('restaurantOriginAddress');
    const driverCancellationMode = normalizeDriverCancellationMode(await getConfigValue('driverCancellationMode'));
    const deliveryManagementEnabled = normalizeDeliveryManagementEnabled(await getConfigValue('deliveryManagementEnabled'));
    const showRouteProviderPicker = normalizeFeatureToggle(await getConfigValue('showRouteProviderPicker'));
    const showDriverCallButton = normalizeFeatureToggle(await getConfigValue('showDriverCallButton'));
    const deliveryAreas = await getDeliveryAreas();
    const localServiceSettings = await getLocalServiceSettings();
    const googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

    res.json({
      deliveryManagementEnabled,
      restaurantOriginAddress,
      driverCancellationMode,
      showRouteProviderPicker,
      showDriverCallButton,
      deliveryAreas,
      localServiceSettings,
      googleMapsApiKeyConfigured: Boolean(googleMapsApiKey),
      googleMapsApiKey,
    });
  } catch (err) {
    console.error('Erro ao carregar configurações:', err.message);
    res.status(500).json({ error: 'Erro ao carregar configurações' });
  }
});

router.put('/admin', requireAdmin, async (req, res) => {
  const deliveryManagementEnabled = normalizeDeliveryManagementEnabled(req.body.deliveryManagementEnabled);
  const restaurantOriginAddress = String(req.body.restaurantOriginAddress || '').trim();
  const driverCancellationMode = normalizeDriverCancellationMode(req.body.driverCancellationMode);
  const showRouteProviderPicker = normalizeFeatureToggle(req.body.showRouteProviderPicker);
  const showDriverCallButton = normalizeFeatureToggle(req.body.showDriverCallButton);
  const localServiceSettings = normalizeLocalServiceSettings(req.body.localServiceSettings || {});
  const deliveryAreas = Array.isArray(req.body.deliveryAreas)
    ? req.body.deliveryAreas.map((area, index) => normalizeDeliveryArea(area, index)).filter(isValidDeliveryArea)
    : [];

  if (deliveryManagementEnabled && restaurantOriginAddress.length < 8) {
    return res.status(400).json({ error: 'Informe um endereço-base válido para entregas.' });
  }

  try {
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['deliveryManagementEnabled', deliveryManagementEnabled ? 'true' : 'false']
    );
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['driverCancellationMode', driverCancellationMode]
    );
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['restaurantOriginAddress', restaurantOriginAddress]
    );
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['showRouteProviderPicker', showRouteProviderPicker ? 'true' : 'false']
    );
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['showDriverCallButton', showDriverCallButton ? 'true' : 'false']
    );
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['deliveryAreas', JSON.stringify(deliveryAreas)]
    );
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localServiceEnabled', localServiceSettings.enabled ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localServiceLabel', localServiceSettings.label]);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localServiceColor', localServiceSettings.color]);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['kanbanLocalHighlightMode', localServiceSettings.kanbanLocalHighlightMode]);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['kanbanDeliveryHighlightMode', localServiceSettings.kanbanDeliveryHighlightMode]);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localReadyColumnEnabled', localServiceSettings.readyColumnEnabled ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localCommandPrefix', localServiceSettings.commandPrefix]);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localAutoGenerateCommandCode', localServiceSettings.autoGenerateCommandCode ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localRequireWaiter', localServiceSettings.requireWaiter ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localRequireTable', localServiceSettings.requireTable ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localAllowTableTransfer', localServiceSettings.allowTableTransfer ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localAllowSplitPayment', localServiceSettings.allowSplitPayment ? 'true' : 'false']);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localPwaDisplayMode', localServiceSettings.pwaDisplayMode]);
    await db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['localPwaPrimaryAccent', localServiceSettings.primaryAccent]);
    res.json({
      success: true,
      deliveryManagementEnabled,
      restaurantOriginAddress,
      driverCancellationMode,
      showRouteProviderPicker,
      showDriverCallButton,
      deliveryAreas,
      localServiceSettings,
    });
  } catch (err) {
    console.error('Erro ao salvar configurações:', err.message);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

router.post('/admin/delivery-areas/suggest', requireAdmin, async (req, res) => {
  const originAddress = String(req.body.originAddress || '').trim();
  const radiusKm = Number(req.body.radiusKm);
  const googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

  if (!originAddress || originAddress.length < 8) {
    return res.status(400).json({ error: 'Informe um endereco base valido para gerar sugestoes.' });
  }

  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 30) {
    return res.status(400).json({ error: 'Informe um raio valido entre 0.5 km e 30 km.' });
  }

  if (!googleMapsApiKey) {
    return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY nao configurada no servidor.' });
  }

  try {
    const origin = await googleGeocodeAddress(originAddress, googleMapsApiKey);
    const points = generateSamplePoints(origin, radiusKm);
    const suggestionsMap = new Map();

    for (const point of points) {
      try {
        const suggestion = await googleReverseGeocode(point.lat, point.lng, googleMapsApiKey);
        if (!suggestion) continue;
        const key = `${slugifyArea(suggestion.city)}__${slugifyArea(suggestion.district)}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, {
            id: key,
            city: suggestion.city,
            district: suggestion.district,
            fee: DEFAULT_DELIVERY_AREA_FEE,
            active: true,
            source: suggestion.source,
          });
        }
      } catch {
        // Ignora falhas pontuais de reverse geocode para manter a sugestao best effort.
      }
    }

    const suggestions = Array.from(suggestionsMap.values()).sort((a, b) =>
      `${a.city} ${a.district}`.localeCompare(`${b.city} ${b.district}`, 'pt-BR')
    );

    res.json({
      origin,
      radiusKm: Number(radiusKm.toFixed(2)),
      samplePointCount: points.length,
      suggestions,
    });
  } catch (err) {
    console.error('Erro ao sugerir areas de entrega:', err.message);
    res.status(500).json({ error: err.message || 'Erro ao sugerir areas de entrega.' });
  }
});

router.get('/delivery-areas', async (_req, res) => {
  try {
    const areas = (await getDeliveryAreas())
      .filter((area) => area.active)
      .sort((a, b) => `${a.city} ${a.district}`.localeCompare(`${b.city} ${b.district}`, 'pt-BR'))
      .map(serializePublicDeliveryArea);

    res.json({ areas });
  } catch (err) {
    console.error('Erro ao carregar areas de entrega publicas:', err.message);
    res.status(500).json({ error: 'Erro ao carregar areas de entrega' });
  }
});

router.get('/public-delivery', async (_req, res) => {
  const googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

  if (!googleMapsApiKey) {
    return res.status(503).json({ error: 'Google Maps não configurado no servidor.' });
  }

  res.json({ googleMapsApiKey });
});

module.exports = router;
