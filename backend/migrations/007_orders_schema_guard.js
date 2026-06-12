/**
 * Migration 007 — Guarda defensiva do schema de orders
 *
 * Recria a tabela orders quando ela estiver ausente e garante todas as colunas
 * necessárias para o kanban e o módulo de entrega em bancos legados/parciais.
 */

const crypto = require('crypto');

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
      CREATE TABLE IF NOT EXISTS orders (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        customer          TEXT    NOT NULL,
        address           TEXT    NOT NULL DEFAULT '',
        phone             TEXT    NOT NULL DEFAULT '',
        payment           TEXT    NOT NULL DEFAULT '',
        total             REAL    NOT NULL DEFAULT 0,
        items             TEXT    NOT NULL DEFAULT '[]',
        obs               TEXT    NOT NULL DEFAULT '',
        status            TEXT    NOT NULL DEFAULT 'novo',
        kanban_order      INTEGER NOT NULL DEFAULT 0,
        order_token       TEXT    NOT NULL DEFAULT '',
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        delivery_batch_id INTEGER,
        delivery_sequence INTEGER
      );
    `);

    await ensureColumn(db, 'orders', 'customer', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'address', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'phone', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'payment', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'total', 'REAL NOT NULL DEFAULT 0');
    await ensureColumn(db, 'orders', 'items', "TEXT NOT NULL DEFAULT '[]'");
    await ensureColumn(db, 'orders', 'obs', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'status', "TEXT NOT NULL DEFAULT 'novo'");
    await ensureColumn(db, 'orders', 'kanban_order', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'orders', 'order_token', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
    await ensureColumn(db, 'orders', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
    await ensureColumn(db, 'orders', 'delivery_batch_id', 'INTEGER');
    await ensureColumn(db, 'orders', 'delivery_sequence', 'INTEGER');

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_delivery_batch_id ON orders(delivery_batch_id);
      CREATE INDEX IF NOT EXISTS idx_orders_delivery_sequence ON orders(delivery_sequence);
    `);

    const rows = await db.all("SELECT id FROM orders WHERE COALESCE(order_token, '') = ''");
    for (const row of rows) {
      const token = `${row.id}-${crypto.randomBytes(5).toString('hex')}`;
      await db.run('UPDATE orders SET order_token = ? WHERE id = ?', [token, row.id]);
    }
  },

  down: async (db) => {
    await db.exec(`
      DROP INDEX IF EXISTS idx_orders_status;
      DROP INDEX IF EXISTS idx_orders_delivery_batch_id;
      DROP INDEX IF EXISTS idx_orders_delivery_sequence;
    `);
  },
};
