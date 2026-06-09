/**
 * Migration 001 — Schema inicial La Coccina
 * Cria as tabelas products, orders e config.
 */

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

      CREATE TABLE IF NOT EXISTS orders (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        customer   TEXT    NOT NULL,
        address    TEXT    NOT NULL DEFAULT '',
        phone      TEXT    NOT NULL,
        payment    TEXT    NOT NULL DEFAULT '',
        total      REAL    NOT NULL DEFAULT 0,
        items      TEXT    NOT NULL DEFAULT '[]',
        obs        TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );

      INSERT OR IGNORE INTO config (key, value) VALUES ('isOpen', 'false');
    `);
  },

  down: async (db) => {
    await db.exec(`
      DROP TABLE IF EXISTS config;
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS products;
    `);
  },
};
