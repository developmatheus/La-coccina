/**
 * Rotas de pedidos — criação, tracking público e Kanban do gestor.
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');
const { requireAdmin }       = require('../middleware/auth');
const { notifyClients }      = require('../menuEvents');
const { sanitizeOrderInput } = require('../utils/sanitize');
const { parsePositiveId }    = require('../utils/sanitize');

const VALID_STATUSES = ['novo', 'em_producao', 'aguardando_envio', 'preparando_rota', 'a_caminho', 'entregue', 'cancelado'];
const STATUS_ALIASES = {
  aguardando_entrega: 'aguardando_envio',
  separando_rota: 'preparando_rota',
  preparacao_rota: 'preparando_rota',
  preparo_rota: 'preparando_rota',
  em_rota: 'a_caminho',
  em_entrega: 'a_caminho',
  saiu_para_entrega: 'a_caminho',
};
const STATUS_ORDER = {
  novo: 1,
  em_producao: 2,
  aguardando_envio: 3,
  preparando_rota: 4,
  a_caminho: 5,
  entregue: 6,
  cancelado: 7,
};

const STATUS_LABEL = {
  novo:             'Novo Pedido',
  em_producao:      'Em Produção',
  aguardando_envio: 'Aguardando Envio',
  preparando_rota:  'Preparando Rota',
  a_caminho:        'A Caminho',
  entregue:         'Entregue',
  cancelado:        'Cancelado',
};

function normalizeStatusInput(status) {
  const key = String(status || '').trim();
  return STATUS_ALIASES[key] || key;
}

function parseOrderItems(rawItems) {
  if (Array.isArray(rawItems)) return rawItems;
  if (rawItems && typeof rawItems === 'object') {
    return Array.isArray(rawItems.items) ? rawItems.items : [];
  }
  if (typeof rawItems !== 'string') return [];

  const trimmed = rawItems.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) return parsed.items;
  } catch {
    // Mantem o kanban operacional mesmo com pedidos legados malformados.
  }

  return [];
}

function compareOrdersForKanban(a, b) {
  const statusDiff = (STATUS_ORDER[a.status] || 999) - (STATUS_ORDER[b.status] || 999);
  if (statusDiff) return statusDiff;

  if (a.status === 'a_caminho') {
    const batchDiff = String(a.delivery_batch_code || '').localeCompare(String(b.delivery_batch_code || ''), 'pt-BR', { numeric: true });
    if (batchDiff) return batchDiff;

    const seqDiff = (a.delivery_sequence ?? 999999) - (b.delivery_sequence ?? 999999);
    if (seqDiff) return seqDiff;
  } else {
    const kanbanDiff = (a.kanban_order ?? 999999) - (b.kanban_order ?? 999999);
    if (kanbanDiff) return kanbanDiff;
  }

  return new Date(`${a.created_at}Z`).getTime() - new Date(`${b.created_at}Z`).getTime();
}

function generateToken(id) {
  return `${id}-${crypto.randomBytes(5).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Público — criar pedido (retorna id + token para rastreio)
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const parsed = sanitizeOrderInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      `INSERT INTO orders (customer, address, phone, payment, total, items, obs, status, kanban_order, order_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'novo', 0, '')`,
      [parsed.customer, parsed.address, parsed.phone, parsed.payment,
       parsed.total, JSON.stringify(parsed.items), parsed.obs]
    );
    const id    = result.insertId;
    const token = generateToken(id);
    await db.execute('UPDATE orders SET order_token = ? WHERE id = ?', [token, id]);

    notifyClients('order-created');
    res.json({ success: true, id, token });
  } catch (err) {
    console.error('Erro ao salvar pedido:', err.message);
    res.status(500).json({ error: 'Erro ao salvar pedido' });
  }
});

// ---------------------------------------------------------------------------
// Público — rastrear pedido pelo token (sem autenticação)
// ---------------------------------------------------------------------------
router.get('/track/:token', async (req, res) => {
  const token = String(req.params.token).trim();
  if (!token || token.length > 40) return res.status(400).json({ error: 'Token inválido' });

  try {
    const [rows] = await db.execute(
      `SELECT id, customer, status, updated_at, created_at FROM orders WHERE order_token = ?`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });

    const o = rows[0];
    res.json({
      id:         o.id,
      customer:   o.customer,
      status:     o.status,
      statusLabel: STATUS_LABEL[o.status] || o.status,
      updatedAt:  o.updated_at,
      createdAt:  o.created_at,
    });
  } catch (err) {
    console.error('Erro ao rastrear pedido:', err.message);
    res.status(500).json({ error: 'Erro ao rastrear pedido' });
  }
});

// ---------------------------------------------------------------------------
// Admin — listar pedidos para o Kanban
// ---------------------------------------------------------------------------
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT o.id, o.customer, o.address, o.phone, o.payment, o.total, o.items, o.obs,
              o.status, o.kanban_order, o.order_token, o.created_at, o.updated_at,
              o.delivery_batch_id, o.delivery_sequence,
              b.batch_code AS delivery_batch_code,
              b.public_token AS delivery_batch_public_token,
              b.batch_status AS delivery_batch_status,
              b.vehicle_plate AS delivery_vehicle_plate
         FROM orders o
         LEFT JOIN delivery_batches b ON b.id = o.delivery_batch_id
        WHERE o.status NOT IN ('entregue', 'cancelado')
        ORDER BY o.created_at ASC`
    );
    const normalizedRows = rows
      .map((order) => {
        const normalizedStatus = normalizeStatusInput(order.status);
        return {
          ...order,
          status: normalizedStatus,
          items: parseOrderItems(order.items),
        };
      })
      .sort(compareOrdersForKanban);

    res.json(normalizedRows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

// Admin — histórico (entregues + cancelados)
router.get('/history', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, customer, total, status, created_at, updated_at
       FROM orders WHERE status IN ('entregue', 'cancelado')
       ORDER BY updated_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// ---------------------------------------------------------------------------
// Admin — atualizar status de um pedido (Kanban move)
// ---------------------------------------------------------------------------
router.put('/:id/status', requireAdmin, async (req, res) => {
  const id     = parsePositiveId(req.params.id);
  const status = normalizeStatusInput(req.body.status);

  if (!id)                          return res.status(400).json({ error: 'ID inválido' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Status inválido' });

  try {
    const [result] = await db.execute(
      `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

    notifyClients('order-status-changed');
    res.json({ success: true, status, statusLabel: STATUS_LABEL[status] });
  } catch (err) {
    console.error('Erro ao atualizar status:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// ---------------------------------------------------------------------------
// Admin — reordenar dentro de uma coluna (drag & drop)
// ---------------------------------------------------------------------------
router.put('/reorder', requireAdmin, async (req, res) => {
  // body: { ids: [1, 5, 3] } — ordem desejada dentro da coluna
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Lista de ids inválida' });

  try {
    for (let i = 0; i < ids.length; i++) {
      await db.execute('UPDATE orders SET kanban_order = ? WHERE id = ?', [i, ids[i]]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reordenar' });
  }
});

module.exports = router;
