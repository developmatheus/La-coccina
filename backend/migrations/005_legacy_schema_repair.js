/**
 * Migration 005 — Reparo de schema legado
 *
 * Garante colunas/tabelas esperadas pelo código atual quando o banco já existia
 * antes das migrations serem introduzidas.
 */

async function tableExists(db, tableName) {
  const row = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  );
  return Boolean(row);
}

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
      CREATE TABLE IF NOT EXISTS products (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        price          REAL    NOT NULL,
        desc           TEXT    NOT NULL DEFAULT '',
        image          TEXT    NOT NULL DEFAULT '',
        category       TEXT    NOT NULL DEFAULT 'marmita'
                         CHECK (category IN ('marmita', 'bebida')),
        active         INTEGER NOT NULL DEFAULT 1,
        isDailySpecial INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS marmita_details (
        product_id       INTEGER PRIMARY KEY,
        protein          TEXT    NOT NULL DEFAULT '',
        sides            TEXT    NOT NULL DEFAULT '',
        is_customizable  INTEGER NOT NULL DEFAULT 0,
        min_sides        INTEGER NOT NULL DEFAULT 0,
        max_sides        INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bebida_details (
        product_id INTEGER PRIMARY KEY,
        volume     TEXT NOT NULL DEFAULT '',
        serve_type TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS accompaniments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        extra_price REAL    NOT NULL DEFAULT 0,
        active      INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS product_accompaniments (
        product_id       INTEGER NOT NULL,
        accompaniment_id INTEGER NOT NULL,
        is_default       INTEGER NOT NULL DEFAULT 0,
        is_available     INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (product_id, accompaniment_id),
        FOREIGN KEY (product_id)       REFERENCES products(id)       ON DELETE CASCADE,
        FOREIGN KEY (accompaniment_id) REFERENCES accompaniments(id) ON DELETE CASCADE
      );
    `);

    await ensureColumn(db, 'products', 'desc', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'products', 'image', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'products', 'category', "TEXT NOT NULL DEFAULT 'marmita'");
    await ensureColumn(db, 'products', 'active', 'INTEGER NOT NULL DEFAULT 1');
    await ensureColumn(db, 'products', 'isDailySpecial', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'products', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

    await ensureColumn(db, 'marmita_details', 'protein', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'marmita_details', 'sides', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'marmita_details', 'is_customizable', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'marmita_details', 'min_sides', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'marmita_details', 'max_sides', 'INTEGER NOT NULL DEFAULT 0');

    await ensureColumn(db, 'bebida_details', 'volume', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'bebida_details', 'serve_type', "TEXT NOT NULL DEFAULT ''");

    await ensureColumn(db, 'accompaniments', 'extra_price', 'REAL NOT NULL DEFAULT 0');
    await ensureColumn(db, 'accompaniments', 'active', 'INTEGER NOT NULL DEFAULT 1');
    await ensureColumn(db, 'accompaniments', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'accompaniments', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

    await ensureColumn(db, 'product_accompaniments', 'is_default', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'product_accompaniments', 'is_available', 'INTEGER NOT NULL DEFAULT 1');

    if (await tableExists(db, 'orders')) {
      await ensureColumn(db, 'orders', 'status', "TEXT NOT NULL DEFAULT 'novo'");
      await ensureColumn(db, 'orders', 'kanban_order', 'INTEGER NOT NULL DEFAULT 0');
      await ensureColumn(db, 'orders', 'order_token', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db, 'orders', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
      await db.exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
    }
  },

  down: async () => {
    // Reparo não possui rollback destrutivo.
  },
};
