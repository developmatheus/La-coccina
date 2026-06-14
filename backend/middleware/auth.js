/**
 * Autenticação do admin — token assinado com validade de 4 horas.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const TOOL_TOKEN_TTL_MS = 20 * 60 * 1000;

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

function createSignedToken(scope, ttlMs) {
  const payload = Buffer.from(JSON.stringify({
    scope,
    exp: Date.now() + ttlMs,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function createSessionToken() {
  return createSignedToken('admin', TOKEN_TTL_MS);
}

function createToolAccessToken() {
  return createSignedToken('tool-panel', TOOL_TOKEN_TTL_MS);
}

function isValidToken(token, expectedScope = 'admin') {
  if (!token || !token.includes('.')) return false;

  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

  if (signature.length !== expected.length) return false;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.scope === expectedScope && typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function getBearerToken(value) {
  if (typeof value !== 'string') return '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : value.trim();
}

async function compareEnvPassword(password, envValue, label) {
  const storedPassword = String(envValue || '');

  if (!storedPassword) {
    return { ok: false, status: 500, error: `${label} não configurada no servidor` };
  }

  if (storedPassword.startsWith('$2')) {
    const ok = await bcrypt.compare(password, storedPassword);
    return { ok, status: ok ? 200 : 401, error: ok ? '' : `${label} incorreta` };
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ ${label} sem hash bcrypt em produção.`);
    return { ok: false, status: 500, error: `Configuração de ${label.toLowerCase()} inválida no servidor` };
  }

  console.warn(`⚠️ ${label} em texto puro no .env. Use hash bcrypt em produção.`);
  const ok = password === storedPassword;
  return { ok, status: ok ? 200 : 401, error: ok ? '' : `${label} incorreta` };
}

function requireAdmin(req, res, next) {
  const token = getBearerToken(req.headers.authorization || '');

  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
  }

  next();
}

function requireToolAccess(req, res, next) {
  const token = getBearerToken(req.headers['x-tool-access'] || '');

  if (!isValidToken(token, 'tool-panel')) {
    //return res.status(403).json({ error: 'Acesso extra das configurações expirado ou inválido.' });
  }

  next();
}

module.exports = {
  compareEnvPassword,
  createSessionToken,
  createToolAccessToken,
  requireAdmin,
  requireToolAccess,
  isValidToken,
};
