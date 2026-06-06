/**
 * Rotas de autenticação do painel admin.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { createSessionToken } = require('../middleware/auth');
const { trimString } = require('../utils/sanitize');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const username = trimString(req.body.username, 80);
    const password = String(req.body.password || '');

const adminUser = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUser || !adminPassword) {
      return res.status(500).json({
        success: false,
        error: 'Credenciais de admin não configuradas no servidor',
      });
    }

    if (username !== adminUser) {
      return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos' });
    }

    let passOk = false;
    if (adminPassword.startsWith('$2')) {
      passOk = await bcrypt.compare(password, adminPassword);
    } else {
      passOk = password === adminPassword;
      console.warn('⚠️ Use senha com hash bcrypt no .env (rode: node scripts/hash-password.js)');
    }

    if (!passOk) {
      return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos' });
    }

    const token = createSessionToken();
    return res.json({ success: true, token });
  } catch (err) {
    console.error('Erro no login:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno no login' });
  }
});

module.exports = router;
