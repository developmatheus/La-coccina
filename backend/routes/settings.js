const express = require('express');

const db = require('../db');
const {
  compareEnvPassword,
  createToolAccessToken,
  requireAdmin,
  requireToolAccess,
} = require('../middleware/auth');

const router = express.Router();

async function getConfigValue(key) {
  const [rows] = await db.execute('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || '';
}

router.post('/unlock', requireAdmin, async (req, res) => {
  try {
    const password = String(req.body.password || '');
    const passwordCheck = await compareEnvPassword(
      password,
      process.env.TOOL_PANEL_PASSWORD,
      'Senha extra das configurações'
    );

    if (!passwordCheck.ok) {
      return res.status(passwordCheck.status).json({ error: passwordCheck.error });
    }

    return res.json({ success: true, toolAccessToken: createToolAccessToken() });
  } catch (err) {
    console.error('Erro ao validar senha extra:', err.message);
    return res.status(500).json({ error: 'Erro ao validar senha extra' });
  }
});

router.get('/admin', requireAdmin, requireToolAccess, async (_req, res) => {
  try {
    const restaurantOriginAddress = await getConfigValue('restaurantOriginAddress');
    const googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

    res.json({
      restaurantOriginAddress,
      googleMapsApiKeyConfigured: Boolean(googleMapsApiKey),
      googleMapsApiKey,
    });
  } catch (err) {
    console.error('Erro ao carregar configurações:', err.message);
    res.status(500).json({ error: 'Erro ao carregar configurações' });
  }
});

router.put('/admin', requireAdmin, requireToolAccess, async (req, res) => {
  const restaurantOriginAddress = String(req.body.restaurantOriginAddress || '').trim();

  if (restaurantOriginAddress.length < 8) {
    return res.status(400).json({ error: 'Informe um endereço-base válido para entregas.' });
  }

  try {
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['restaurantOriginAddress', restaurantOriginAddress]
    );
    res.json({ success: true, restaurantOriginAddress });
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
