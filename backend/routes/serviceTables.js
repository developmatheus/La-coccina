const express = require('express');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { parsePositiveId, trimString } = require('../utils/sanitize');

const router = express.Router();

function normalizeTablePayload(body = {}) {
  const name = trimString(body.name, 80);
  const sector = trimString(body.sector, 80);
  const seats = Math.max(0, Math.min(99, Math.floor(Number(body.seats) || 0)));
  const active = body.active !== false;
  const sortOrder = Math.max(0, Math.min(9999, Math.floor(Number(body.sort_order ?? body.sortOrder) || 0)));

  if (!name) {
    return { error: 'Nome da mesa é obrigatório.' };
  }

  return {
    name,
    sector,
    seats,
    active,
    sortOrder,
  };
}

router.get('/', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, sector, seats, active, sort_order, created_at
         FROM service_tables
        ORDER BY active DESC, sort_order ASC, name ASC`
    );
    res.json(rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      sector: row.sector || '',
      seats: Number(row.seats || 0),
      active: Boolean(row.active),
      sortOrder: Number(row.sort_order || 0),
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error('Erro ao listar mesas:', err.message);
    res.status(500).json({ error: 'Erro ao listar mesas.' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const parsed = normalizeTablePayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      `INSERT INTO service_tables (name, sector, seats, active, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [parsed.name, parsed.sector, parsed.seats, parsed.active ? 1 : 0, parsed.sortOrder]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Erro ao criar mesa:', err.message);
    res.status(500).json({ error: 'Erro ao criar mesa.' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  const parsed = normalizeTablePayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      `UPDATE service_tables
          SET name = ?, sector = ?, seats = ?, active = ?, sort_order = ?
        WHERE id = ?`,
      [parsed.name, parsed.sector, parsed.seats, parsed.active ? 1 : 0, parsed.sortOrder, id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Mesa não encontrada.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar mesa:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar mesa.' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  try {
    const [openOrders] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM orders
        WHERE table_id = ?
          AND COALESCE(closed_at, '') = ''`,
      [id]
    );
    if (Number(openOrders[0]?.total || 0) > 0) {
      return res.status(409).json({ error: 'Há comandas abertas vinculadas a esta mesa.' });
    }

    await db.execute('UPDATE service_tables SET active = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao desativar mesa:', err.message);
    res.status(500).json({ error: 'Erro ao desativar mesa.' });
  }
});

module.exports = router;
