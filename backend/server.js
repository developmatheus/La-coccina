/**
 * ============================================================================
 * LA COCCINA — Servidor API (Node.js + Express + MySQL)
 * ============================================================================
 * Segurança: Helmet, CORS, rate limit, auth admin, validação de entrada,
 * upload restrito e prepared statements no banco.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const productsRouter = require('./routes/products');
const authRouter = require('./routes/auth');
const { requireAdmin } = require('./middleware/auth');
const { upload } = require('./middleware/upload');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';
const frontendDir = path.join(__dirname, '..', 'Frontend');
const frontendIndex = path.join(frontendDir, 'index.html');
const hasFrontend = fs.existsSync(frontendIndex);

// Site + admin: produção, SERVE_FRONTEND=true, ou pasta Frontend presente (padrão local)
const serveFrontend =
  process.env.SERVE_FRONTEND !== 'false' &&
  (isProd || process.env.SERVE_FRONTEND === 'true' || hasFrontend);

if (isProd) {
  app.set('trust proxy', 1);
}

const corsList = process.env.CORS_ORIGINS || 'http://127.0.0.1:5500,http://localhost:5500,null';
const allowedOrigins = corsList.split(',').map((o) => o.trim()).filter(Boolean);

if (process.env.PUBLIC_URL) {
  const url = process.env.PUBLIC_URL.trim().replace(/\/$/, '');
  if (!allowedOrigins.includes(url)) allowedOrigins.push(url);
}

// ---------------------------------------------------------------------------
// Segurança — cabeçalhos HTTP
// ---------------------------------------------------------------------------
app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origem não permitida pelo CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ---------------------------------------------------------------------------
// Segurança — limite de tamanho e taxa de requisições
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/products/stream',
}));

app.use('/api/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Muitas tentativas. Aguarde e tente novamente.' },
}));

app.use('/api/products/orders', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Muitos pedidos enviados. Tente novamente mais tarde.' },
}));

// ---------------------------------------------------------------------------
// Arquivos estáticos — imagens enviadas pelo admin
// ---------------------------------------------------------------------------
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  dotfiles: 'deny',
  index: false,
  maxAge: '7d',
}));

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------
app.use('/api/login', authRouter);

app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  }
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

app.use('/api/products', productsRouter);

// ---------------------------------------------------------------------------
// Site público + admin (mesmo servidor = todos veem as mesmas alterações)
// ---------------------------------------------------------------------------
if (serveFrontend && hasFrontend) {
  app.use(express.static(frontendDir, { index: 'index.html', maxAge: isProd ? '1h' : 0 }));
  app.get('/', (_req, res) => res.sendFile(frontendIndex));
  console.log(`📂 Site estático: ${frontendDir}`);
} else if (serveFrontend && !hasFrontend) {
  console.error(`❌ Pasta Frontend não encontrada em: ${frontendDir}`);
  console.error('   Envie a pasta Frontend junto com backend/ no servidor.');
}

// ---------------------------------------------------------------------------
// Tratamento de erros
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  if (err.message === 'Origem não permitida pelo CORS') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  console.error('Erro no servidor:', err.message);

  const message = isProd ? 'Erro interno do servidor' : (err.message || 'Erro interno');
  res.status(err.status || 500).json({ error: message });
});

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
  console.log(`🚀 La Coccina — API + ${serveFrontend && hasFrontend ? 'site' : 'somente API'}`);
  console.log(`   Local:  http://localhost:${PORT}`);
  if (process.env.PUBLIC_URL) console.log(`   Online: ${publicUrl}`);
  if (serveFrontend && hasFrontend) {
    console.log(`   Loja:   ${publicUrl}/index.html`);
    console.log(`   Admin:  ${publicUrl}/admin/login.html`);
  } else if (!hasFrontend) {
    console.log('   ⚠️  /index.html não disponível — falta a pasta Frontend ao lado de backend/');
  } else {
    console.log('   ⚠️  Site desligado — defina SERVE_FRONTEND=true no .env');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} em uso. Feche o outro servidor ou rode: npm run stop\n`);
    process.exit(1);
    return;
  }
  console.error(err);
  process.exit(1);
});

module.exports = app;
