/**
 * Runner de migrations — La Coccina
 *
 * Uso:
 *   node scripts/migrate.js           → aplica migrations pendentes
 *   node scripts/migrate.js --status  → lista estado de cada migration
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });

const path = require('path');
const fs = require('fs');
const db = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(conn) {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

async function getApplied(conn) {
  const rows = await conn.all('SELECT name FROM _migrations ORDER BY id ASC');
  return new Set(rows.map((r) => r.name));
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

async function runStatus() {
  const conn = await db.raw();
  await ensureMigrationsTable(conn);
  const applied = await getApplied(conn);
  const files = getMigrationFiles();

  if (files.length === 0) {
    console.log('Nenhuma migration encontrada.');
    return;
  }

  console.log('\n  Estado das migrations:\n');
  for (const file of files) {
    const status = applied.has(file) ? '✅ aplicada' : '⏳ pendente';
    console.log(`  ${status}  ${file}`);
  }
  console.log('');
}

async function runMigrate() {
  const conn = await db.raw();
  await ensureMigrationsTable(conn);
  const applied = await getApplied(conn);
  const files = getMigrationFiles();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('✅ Banco já está atualizado. Nenhuma migration pendente.');
    return;
  }

  for (const file of pending) {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    process.stdout.write(`  → Aplicando ${file}... `);
    await migration.up(conn);
    await conn.run('INSERT INTO _migrations (name) VALUES (?)', [file]);
    console.log('✅');
  }

  console.log(`\n✅ ${pending.length} migration(s) aplicada(s).`);
}

(async () => {
  const isStatus = process.argv.includes('--status');
  try {
    if (isStatus) {
      await runStatus();
    } else {
      await runMigrate();
    }
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro na migration:', err.message);
    process.exit(1);
  }
})();
