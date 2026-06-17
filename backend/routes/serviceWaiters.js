const express = require('express');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { parsePositiveId, trimString } = require('../utils/sanitize');

const router = express.Router();

function normalizeWaiterPayload(body = {}) {
  const name = trimString(body.name, 120);
  const code = trimString(body.code, 30);
  const active = body.active !== false;
  const sortOrder = Math.max(0, Math.min(9999, Math.floor(Number(body.sort_order ?? body.sortOrder) || 0)));

  if (!name) {
    return { error: 'Nome do garçom é obrigatório.' };
  }

  return {
    name,
    code,
    active,
    sortOrder,
  };
}

router.get('/', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, code, active, sort_order, created_at
         FROM service_waiters
        ORDER BY active DESC, sort_order ASC, name ASC`
    );
    res.json(rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      code: row.code || '',
      active: Boolean(row.active),
      sortOrder: Number(row.sort_order || 0),
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error('Erro ao listar garçons:', err.message);
    res.status(500).json({ error: 'Erro ao listar garçons.' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const parsed = normalizeWaiterPayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      `INSERT INTO service_waiters (name, code, active, sort_order)
       VALUES (?, ?, ?, ?)`,
      [parsed.name, parsed.code, parsed.active ? 1 : 0, parsed.sortOrder]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Erro ao criar garçom:', err.message);
    res.status(500).json({ error: 'Erro ao criar garçom.' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  const parsed = normalizeWaiterPayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      `UPDATE service_waiters
          SET name = ?, code = ?, active = ?, sort_order = ?
        WHERE id = ?`,
      [parsed.name, parsed.code, parsed.active ? 1 : 0, parsed.sortOrder, id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Garçom não encontrado.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar garçom:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar garçom.' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  try {
    const [openOrders] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM orders
        WHERE waiter_id = ?
          AND COALESCE(closed_at, '') = ''`,
      [id]
    );
    if (Number(openOrders[0]?.total || 0) > 0) {
      return res.status(409).json({ error: 'Há comandas abertas vinculadas a este garçom.' });
    }

    await db.execute('UPDATE service_waiters SET active = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao desativar garçom:', err.message);
    res.status(500).json({ error: 'Erro ao desativar garçom.' });
  }
});

module.exports = router;
