/**
 * Autenticação do admin — token assinado com validade de 4 horas.
 */

const crypto = require('crypto');

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret || secret.length < 16) {
    if (isProd) {
      console.error('❌ SESSION_SECRET ausente ou fraca em produção. Encerrando.');
      process.exit(1);
    }
    console.warn('⚠️ SESSION_SECRET fraca ou ausente — defina uma chave longa no .env');
    return secret || 'defina-SESSION_SECRET-no-env';
  }
  return secret;
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const signature = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isValidToken(token) {
  if (!token || !token.includes('.')) return false;

  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

  if (signature.length !== expected.length) return false;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
  }

  next();
}

module.exports = { createSessionToken, requireAdmin, isValidToken };
