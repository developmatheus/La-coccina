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
    await ensureColumn(db, 'orders', 'delivery_followup_state', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'delivery_followup_updated_at', 'TEXT');

    await db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_attempt_logs (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id              INTEGER NOT NULL,
        delivery_batch_id     INTEGER,
        attempt_action        TEXT NOT NULL DEFAULT '',
        order_status_before   TEXT NOT NULL DEFAULT '',
        order_status_after    TEXT NOT NULL DEFAULT '',
        followup_state_before TEXT NOT NULL DEFAULT '',
        followup_state_after  TEXT NOT NULL DEFAULT '',
        actor_name            TEXT NOT NULL DEFAULT '',
        reason                TEXT NOT NULL DEFAULT '',
        note                  TEXT NOT NULL DEFAULT '',
        customer_name         TEXT NOT NULL DEFAULT '',
        address               TEXT NOT NULL DEFAULT '',
        phone                 TEXT NOT NULL DEFAULT '',
        payment_method        TEXT NOT NULL DEFAULT '',
        order_total           REAL NOT NULL DEFAULT 0,
        delivery_sequence     INTEGER,
        attempted_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_order
        ON delivery_attempt_logs(order_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_batch
        ON delivery_attempt_logs(delivery_batch_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_attempted_at
        ON delivery_attempt_logs(attempted_at);
      CREATE INDEX IF NOT EXISTS idx_orders_delivery_followup_state
        ON orders(delivery_followup_state);
    `);
  },

  down: async (db) => {
    await db.exec(`
      DROP INDEX IF EXISTS idx_delivery_attempt_logs_order;
      DROP INDEX IF EXISTS idx_delivery_attempt_logs_batch;
      DROP INDEX IF EXISTS idx_delivery_attempt_logs_attempted_at;
      DROP INDEX IF EXISTS idx_orders_delivery_followup_state;
      DROP TABLE IF EXISTS delivery_attempt_logs;
    `);
  },
};
