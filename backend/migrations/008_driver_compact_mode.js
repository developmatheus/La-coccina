/**
 * Migration 008 — Modo compacto do motoboy e coordenadas de entrega
 *
 * Adiciona:
 * - coordenadas persistidas por pedido
 * - metadados de tentativa/entrega
 * - sessao do motoboy e parada atual no lote
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
    await ensureColumn(db, 'orders', 'address_lat', 'REAL');
    await ensureColumn(db, 'orders', 'address_lng', 'REAL');
    await ensureColumn(db, 'orders', 'address_geocoded_at', 'TEXT');
    await ensureColumn(db, 'orders', 'delivery_failed_reason', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'delivery_failed_note', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'delivered_at', 'TEXT');
    await ensureColumn(db, 'orders', 'delivery_attempted_at', 'TEXT');
    await ensureColumn(db, 'orders', 'delivery_actor_name', "TEXT NOT NULL DEFAULT ''");

    await ensureColumn(db, 'delivery_batches', 'current_order_id', 'INTEGER');
    await ensureColumn(db, 'delivery_batches', 'driver_session_token', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'delivery_batches', 'driver_session_expires_at', 'TEXT');

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_address_lat_lng ON orders(address_lat, address_lng);
      CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders(delivered_at);
      CREATE INDEX IF NOT EXISTS idx_delivery_batches_current_order_id ON delivery_batches(current_order_id);
    `);
  },

  down: async (db) => {
    await db.exec(`
      DROP INDEX IF EXISTS idx_orders_address_lat_lng;
      DROP INDEX IF EXISTS idx_orders_delivered_at;
      DROP INDEX IF EXISTS idx_delivery_batches_current_order_id;
    `);
  },
};
