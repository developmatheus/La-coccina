/**
 * Migration 010 — Atendimento local para restaurante/pizzaria
 *
 * Expande `orders` para suportar canais de atendimento e cria os cadastros
 * de mesas e garçons para a operação local em tablet.
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
      CREATE TABLE IF NOT EXISTS service_tables (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        sector     TEXT    NOT NULL DEFAULT '',
        seats      INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS service_waiters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        code       TEXT    NOT NULL DEFAULT '',
        active     INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await ensureColumn(db, 'orders', 'service_channel', "TEXT NOT NULL DEFAULT 'delivery'");
    await ensureColumn(db, 'orders', 'table_id', 'INTEGER');
    await ensureColumn(db, 'orders', 'waiter_id', 'INTEGER');
    await ensureColumn(db, 'orders', 'command_code', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'local_service_status', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'opened_at', 'TEXT');
    await ensureColumn(db, 'orders', 'served_at', 'TEXT');
    await ensureColumn(db, 'orders', 'closed_at', 'TEXT');
    await ensureColumn(db, 'orders', 'closed_payment_method', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'orders', 'closed_total', 'REAL NOT NULL DEFAULT 0');
    await ensureColumn(db, 'orders', 'service_tag_color', "TEXT NOT NULL DEFAULT ''");

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_service_channel ON orders(service_channel);
      CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
      CREATE INDEX IF NOT EXISTS idx_orders_waiter_id ON orders(waiter_id);
      CREATE INDEX IF NOT EXISTS idx_orders_command_code ON orders(command_code);
      CREATE INDEX IF NOT EXISTS idx_service_tables_active ON service_tables(active);
      CREATE INDEX IF NOT EXISTS idx_service_waiters_active ON service_waiters(active);
    `);

    const tablesCount = await db.get(`SELECT COUNT(*) AS total FROM service_tables`);
    if (Number(tablesCount?.total || 0) === 0) {
      await db.run(
        `INSERT INTO service_tables (name, sector, seats, active, sort_order)
         VALUES ('Mesa 1', '', 4, 1, 1),
                ('Mesa 2', '', 4, 1, 2),
                ('Mesa 3', '', 4, 1, 3)`
      );
    }

    const waitersCount = await db.get(`SELECT COUNT(*) AS total FROM service_waiters`);
    if (Number(waitersCount?.total || 0) === 0) {
      await db.run(
        `INSERT INTO service_waiters (name, code, active, sort_order)
         VALUES ('Garçom 1', 'G1', 1, 1),
                ('Garçom 2', 'G2', 1, 2)`
      );
    }

    await db.run(
      `UPDATE orders
          SET service_channel = CASE
            WHEN COALESCE(service_channel, '') = '' THEN 'delivery'
            ELSE service_channel
          END`
    );
  },

  down: async (db) => {
    await db.exec(`
      DROP INDEX IF EXISTS idx_orders_service_channel;
      DROP INDEX IF EXISTS idx_orders_table_id;
      DROP INDEX IF EXISTS idx_orders_waiter_id;
      DROP INDEX IF EXISTS idx_orders_command_code;
      DROP INDEX IF EXISTS idx_service_tables_active;
      DROP INDEX IF EXISTS idx_service_waiters_active;
      DROP TABLE IF EXISTS service_tables;
      DROP TABLE IF EXISTS service_waiters;
    `);
  },
};
