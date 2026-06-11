const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

require('dotenv').config({
  path: path.join(__dirname, 'config', '.env')
});

const configuredDbPath = process.env.DB_PATH && process.env.DB_PATH.trim();
const dbPath = configuredDbPath
  ? path.resolve(configuredDbPath)
  : path.join(__dirname, 'data', 'lacoccina.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let _db = null;

async function getDb() {
  if (!_db) {
    if (!configuredDbPath) {
      console.warn(`⚠️ DB_PATH não definido. Usando fallback local: ${dbPath}`);
    }
    _db = await open({ filename: dbPath, driver: sqlite3.Database });
    await _db.run('PRAGMA journal_mode = WAL');
    await _db.run('PRAGMA foreign_keys = ON');
    console.log(`✅ SQLite conectado: ${dbPath}`);
  }
  return _db;
}

// Interface compatível com mysql2: .execute(sql, params) → [rows, meta]
const db = {
  execute: async (sql, params = []) => {
    const conn = await getDb();
    const upper = sql.trimStart().toUpperCase();
    if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA')) {
      const rows = await conn.all(sql, params);
      return [rows, {}];
    }
    const result = await conn.run(sql, params);
    const meta = { insertId: result.lastID, affectedRows: result.changes };
    return [meta, meta];
  },

  raw: getDb,
};

// Testar conexão ao iniciar
getDb().catch((err) => {
  console.error('❌ Erro ao abrir banco SQLite:', err.message);
});

module.exports = db;