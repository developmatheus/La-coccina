/**
 * Rollback da última migration aplicada — La Coccina
 *
 * Uso:
 *   node scripts/migrate-rollback.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });

const path = require('path');
const db = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

(async () => {
  try {
    const conn = await db.raw();

    const last = await conn.get(
      'SELECT name FROM _migrations ORDER BY id DESC LIMIT 1'
    );

    if (!last) {
      console.log('Nenhuma migration aplicada. Nada a reverter.');
      process.exit(0);
    }

    const file = last.name;
    const migration = require(path.join(MIGRATIONS_DIR, file));

    process.stdout.write(`  → Revertendo ${file}... `);
    await migration.down(conn);
    await conn.run('DELETE FROM _migrations WHERE name = ?', [file]);
    console.log('✅');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro no rollback:', err.message);
    process.exit(1);
  }
})();
