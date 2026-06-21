const crypto = require('crypto');

async function getColumns(db, tableName) {
  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map((row) => row.name));
}

module.exports = {
  up: async (db) => {
    const columns = await getColumns(db, 'service_tables');
    if (!columns.has('qr_token')) {
      await db.exec(`ALTER TABLE service_tables ADD COLUMN qr_token TEXT NOT NULL DEFAULT ''`);
      
      // Criar tokens aleatórios para as mesas já existentes (ex: abc123def456)
      const rows = await db.all(`SELECT id FROM service_tables`);
      for (const row of rows) {
        const token = crypto.randomBytes(6).toString('hex');
        await db.run(`UPDATE service_tables SET qr_token = ? WHERE id = ?`, [token, row.id]);
      }
      
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_service_tables_qr_token ON service_tables(qr_token)`);
    }
  },

  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_service_tables_qr_token`);
    // O SQLite não suporta bem DROP COLUMN, então apenas removemos o índice
  },
};
