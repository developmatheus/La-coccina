/**
 * Upload de imagens — apenas tipos seguros e tamanho limitado.
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z.]/g, '');
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error('Formato de imagem não permitido'));
      return;
    }
    cb(null, true);
  },
});

module.exports = { upload, ALLOWED_MIMES, uploadsDir };
