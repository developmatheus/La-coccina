/**
 * Migration 004 — Kanban de pedidos
 *
 * Adiciona à tabela orders:
 *   status        → estágio no Kanban
 *   kanban_order  → posição dentro da coluna (drag & drop)
 *   order_token   → token único público para o cliente rastrear o pedido
 *   updated_at    → última atualização de status
 */

module.exports = {
  up: async (db) => {
    await db.exec(`ALTER TABLE orders ADD COLUMN status       TEXT NOT NULL DEFAULT 'novo'`);
    await db.exec(`ALTER TABLE orders ADD COLUMN kanban_order INTEGER NOT NULL DEFAULT 0`);
    await db.exec(`ALTER TABLE orders ADD COLUMN order_token  TEXT NOT NULL DEFAULT ''`);
    await db.exec(`ALTER TABLE orders ADD COLUMN updated_at   TEXT NOT NULL DEFAULT (datetime('now'))`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);

    // Gerar tokens para pedidos existentes (retroativo)
    const rows = await db.all("SELECT id FROM orders WHERE order_token = ''");
    for (const row of rows) {
      const token = `${row.id}-${Math.random().toString(36).slice(2, 10)}`;
      await db.run('UPDATE orders SET order_token = ? WHERE id = ?', [token, row.id]);
    }
  },

  down: async (db) => {
    // SQLite não suporta DROP COLUMN — colunas permanecem no rollback
    await db.exec(`
      DROP INDEX IF EXISTS idx_orders_status;
      DROP INDEX IF EXISTS idx_orders_token;
    `);
  },
};
