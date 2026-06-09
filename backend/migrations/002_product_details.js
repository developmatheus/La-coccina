/**
 * Migration 002 — Detalhes específicos por categoria
 * marmita_details: proteína principal + acompanhamentos
 * bebida_details:  volume + tipo de serviço
 */

module.exports = {
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS marmita_details (
        product_id INTEGER PRIMARY KEY,
        protein    TEXT NOT NULL DEFAULT '',
        sides      TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bebida_details (
        product_id INTEGER PRIMARY KEY,
        volume     TEXT NOT NULL DEFAULT '',
        serve_type TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );
    `);
  },

  down: async (db) => {
    await db.exec(`
      DROP TABLE IF EXISTS bebida_details;
      DROP TABLE IF EXISTS marmita_details;
    `);
  },
};
