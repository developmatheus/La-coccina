/**
 * ============================================================================
 * LA COCCINA — Servidor API
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config({
  path: path.join(__dirname, 'config', '.env')
});

const productsRouter = require('./routes/products');
const authRouter = require('./routes/auth');
const { requireAdmin } = require('./middleware/auth');
const { upload } = require('./middleware/upload');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

const frontendDir = path.join(__dirname, '..', 'Frontend');
const frontendIndex = path.join(frontendDir, 'index.html');
const hasFrontend = fs.existsSync(frontendIndex);
const serveFrontend =
  process.env.SERVE_FRONTEND !== 'false' &&
  (isProd || process.env.SERVE_FRONTEND === 'true' || hasFrontend);

if (isProd) {
  app.set('trust proxy', 1);
}

const defaultOrigins = [
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];

const envOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  }
}));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use('/api/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15
}));

app.use('/uploads', express.static(
  path.join(__dirname, 'uploads'),
  { dotfiles: 'deny', index: false, maxAge: '7d' }
));

app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try {
    const db = require('./db');
    await db.execute('SELECT 1');
    dbOk = true;
  } catch { /* db offline */ }
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk, timestamp: new Date().toISOString() });
});

app.use('/api/login', authRouter);

app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  }
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

app.use('/api/products', productsRouter);

if (serveFrontend && hasFrontend) {
  const assetsDir = path.join(frontendDir, 'ASSETS');

  if (fs.existsSync(assetsDir)) {
    app.use('/assets', express.static(assetsDir, { maxAge: isProd ? '1h' : 0 }));
    console.log(`📂 Assets (/assets → ASSETS): ${assetsDir}`);
  }

  app.use(express.static(frontendDir, { index: 'index.html', maxAge: isProd ? '1h' : 0 }));
  app.get('/', (_req, res) => res.sendFile(frontendIndex));
  console.log(`📂 Site estático: ${frontendDir}`);
} else if (serveFrontend && !hasFrontend) {
  console.error(`❌ Pasta Frontend não encontrada em: ${frontendDir}`);
}

app.use((err, _req, res, _next) => {
  if (err.message === 'Origem não permitida pelo CORS') {
    return res.status(403).json({ error: 'CORS Error: Origem não permitida' });
  }

  console.error('🔥 Erro no servidor:', err);
  res.status(500).json({ error: 'Erro interno no servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 LA COCCINA — API ONLINE
  -----------------------------------------
  URL:  http://localhost:${PORT}
  Ambiente: ${isProd ? 'Produção' : 'Desenvolvimento'}
  Frontend: ${serveFrontend ? 'Ativado' : 'Desativado'}
  -----------------------------------------
  `);
});
