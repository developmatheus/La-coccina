/**
 * Migration 003 — Catálogo de acompanhamentos
 *
 * accompaniments          → catálogo global (admin cadastra)
 * product_accompaniments  → relação prato ↔ acompanhamento
 * marmita_details         → adiciona is_customizable, min_sides, max_sides
 */

module.exports = {
  up: async (db) => {
    await db.exec(`
      -- Catálogo global de acompanhamentos
      CREATE TABLE IF NOT EXISTS accompaniments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        extra_price REAL    NOT NULL DEFAULT 0,
        active      INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      -- Relação prato ↔ acompanhamento
      -- is_default: vem marcado por padrão na seleção do cliente
      -- is_available: aparece como opção para este prato
      CREATE TABLE IF NOT EXISTS product_accompaniments (
        product_id       INTEGER NOT NULL,
        accompaniment_id INTEGER NOT NULL,
        is_default       INTEGER NOT NULL DEFAULT 0,
        is_available     INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (product_id, accompaniment_id),
        FOREIGN KEY (product_id)       REFERENCES products(id)       ON DELETE CASCADE,
        FOREIGN KEY (accompaniment_id) REFERENCES accompaniments(id) ON DELETE CASCADE
      );

      -- Adicionar colunas de personalização em marmita_details
      ALTER TABLE marmita_details ADD COLUMN is_customizable INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE marmita_details ADD COLUMN min_sides        INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE marmita_details ADD COLUMN max_sides        INTEGER NOT NULL DEFAULT 0;
    `);
  },

  down: async (db) => {
    // SQLite não suporta DROP COLUMN — as colunas adicionadas em marmita_details ficam.
    await db.exec(`
      DROP TABLE IF EXISTS product_accompaniments;
      DROP TABLE IF EXISTS accompaniments;
    `);
  },
};
