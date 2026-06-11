/**
 * Migration 006 — Lotes de entrega
 *
 * Cria a tabela de lotes de entrega e adiciona campos de vínculo/ordenação
 * em orders para suportar preparação de rota, aceite do motoboy e liberação
 * pela cozinha.
 */

async function getColumns(db, tableName) {
  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map((row) => row.name));
}

async function ensureColumn(db, tableName, columnName, sqlDefinition) {
  const columns = await getColumns(db, tableName);
  if (!columns.has(columnName)) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`);
  }
}

module.exports = {
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_batches (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_code           TEXT    NOT NULL DEFAULT '',
        public_token         TEXT    NOT NULL DEFAULT '',
        batch_status         TEXT    NOT NULL DEFAULT 'preparado',
        origin_address       TEXT    NOT NULL DEFAULT '',
        maps_url             TEXT    NOT NULL DEFAULT '',
        driver_name          TEXT    NOT NULL DEFAULT '',
        driver_whatsapp      TEXT    NOT NULL DEFAULT '',
        driver_cpf           TEXT    NOT NULL DEFAULT '',
        vehicle_model        TEXT    NOT NULL DEFAULT '',
        vehicle_plate        TEXT    NOT NULL DEFAULT '',
        accepted_at          TEXT,
        kitchen_confirmed_at TEXT,
        created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await ensureColumn(db, 'orders', 'delivery_batch_id', 'INTEGER');
    await ensureColumn(db, 'orders', 'delivery_sequence', 'INTEGER');

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_delivery_batches_public_token ON delivery_batches(public_token);
      CREATE INDEX IF NOT EXISTS idx_delivery_batches_status ON delivery_batches(batch_status);
      CREATE INDEX IF NOT EXISTS idx_orders_delivery_batch_id ON orders(delivery_batch_id);
      CREATE INDEX IF NOT EXISTS idx_orders_delivery_sequence ON orders(delivery_sequence);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `);
  },

  down: async (db) => {
    await db.exec(`
      DROP INDEX IF EXISTS idx_delivery_batches_public_token;
      DROP INDEX IF EXISTS idx_delivery_batches_status;
      DROP INDEX IF EXISTS idx_orders_delivery_batch_id;
      DROP INDEX IF EXISTS idx_orders_delivery_sequence;
      DROP INDEX IF EXISTS idx_orders_status;
    `);
  },
};
