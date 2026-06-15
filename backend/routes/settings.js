const express = require('express');

const db = require('../db');
const {
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

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

router.get('/admin', requireAdmin, async (_req, res) => {
  try {
    const restaurantOriginAddress = await getConfigValue('restaurantOriginAddress');
    const driverCancellationMode = normalizeDriverCancellationMode(await getConfigValue('driverCancellationMode'));
    const deliveryManagementEnabled = normalizeDeliveryManagementEnabled(await getConfigValue('deliveryManagementEnabled'));
    const googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

    res.json({
      deliveryManagementEnabled,
      restaurantOriginAddress,
      driverCancellationMode,
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
    res.json({ success: true, deliveryManagementEnabled, restaurantOriginAddress, driverCancellationMode });
  } catch (err) {
    console.error('Erro ao salvar configurações:', err.message);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
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
