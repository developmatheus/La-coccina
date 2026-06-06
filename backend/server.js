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

// -----------------------------------------------------------------------------
// TRUST PROXY
// -----------------------------------------------------------------------------

if (isProd) {
  app.set('trust proxy', 1);
}

// -----------------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------------

const allowedOrigins = [
  'https://https://la-coccina-production.up.railway.app',
  'https://la-coccina-production.up.railway.app',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];

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

// -----------------------------------------------------------------------------
// EXPRESS
// -----------------------------------------------------------------------------

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: '1mb'
}));

// -----------------------------------------------------------------------------
// HELMET
// -----------------------------------------------------------------------------

app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: {
    policy: 'cross-origin'
  },

  contentSecurityPolicy: false
}));

// -----------------------------------------------------------------------------
// RATE LIMIT
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// UPLOADS
// -----------------------------------------------------------------------------

app.use('/uploads', express.static(
  path.join(__dirname, 'uploads'),
  {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d'
  }
));

// -----------------------------------------------------------------------------
// API ROUTES
// -----------------------------------------------------------------------------

app.use('/api/login', authRouter);

app.post(
  '/api/upload',
  requireAdmin,
  upload.single('image'),
  (req, res) => {

    if (!req.file) {
      return res.status(400).json({
        error: 'Nenhuma imagem enviada'
      });
    }

    res.json({
      imageUrl: `/uploads/${req.file.filename}`
    });
  }
);

app.use('/api/products', productsRouter);

// -----------------------------------------------------------------------------
// FRONTEND STATIC
// -----------------------------------------------------------------------------

if (serveFrontend && hasFrontend) {

  const assetsDir = path.join(frontendDir, 'ASSETS');

  if (fs.existsSync(assetsDir)) {

    app.use('/assets', express.static(
      assetsDir,
      {
        maxAge: isProd ? '1h' : 0
      }
    ));

    console.log(`📂 Assets (/assets → ASSETS): ${assetsDir}`);
  }

  app.use(express.static(
    frontendDir,
    {
      index: 'index.html',
      maxAge: isProd ? '1h' : 0
    }
  ));

  app.get('/', (_req, res) => {
    res.sendFile(frontendIndex);
  });

  console.log(`📂 Site estático: ${frontendDir}`);

} else if (serveFrontend && !hasFrontend) {

  console.error(`❌ Pasta Frontend não encontrada em: ${frontendDir}`);
}

// -----------------------------------------------------------------------------
// ERROR HANDLER
// -----------------------------------------------------------------------------

app.use((err, _req, res, _next) => {

  if (err.message === 'Origem não permitida pelo CORS') {
    return res.status(403).json({
      error: 'Acesso negado'
    });
  }

  console.error('Erro:', err.message);

  res.status(500).json({
    error: isProd
      ? 'Erro interno do servidor'
      : err.message
  });
});

// -----------------------------------------------------------------------------
// START
// -----------------------------------------------------------------------------

const server = app.listen(PORT, () => {

  const publicUrl =
    process.env.PUBLIC_URL ||
    `http://localhost:${PORT}`;

  console.log(`🚀 Servidor iniciado`);
  console.log(`📍 Local: ${publicUrl}`);

  if (serveFrontend && hasFrontend) {
    console.log(`🛒 Loja: ${publicUrl}/index.html`);
    console.log(`🔐 Admin: ${publicUrl}/admin/login.html`);
  }
});

server.on('error', (err) => {

  if (err.code === 'EADDRINUSE') {

    console.error(
      `❌ Porta ${PORT} em uso`
    );

    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});

module.exports = app;