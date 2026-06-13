/**
 * Rotas de autenticação do painel admin.
 */

const express = require('express');
const { compareEnvPassword, createSessionToken } = require('../middleware/auth');
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

    const passwordCheck = await compareEnvPassword(password, adminPassword, 'Senha de admin');

    if (!passwordCheck.ok) {
      if (passwordCheck.status === 500) {
        return res.status(500).json({ success: false, error: passwordCheck.error });
      }
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
