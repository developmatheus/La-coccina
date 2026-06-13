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

async function getTableColumns(tableName) {
  try {
    const [rows] = await db.execute(`PRAGMA table_info(${tableName})`);
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

async function hasTable(tableName) {
  const [rows] = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return rows.length > 0;
}

async function buildKanbanOrdersQuery() {
  const ordersTableExists = await hasTable('orders');
  if (!ordersTableExists) {
    return null;
  }

  const orderColumns = await getTableColumns('orders');
  const deliveryTableExists = await hasTable('delivery_batches');
  const deliveryColumns = deliveryTableExists ? await getTableColumns('delivery_batches') : new Set();
  const orderCol = (columnName, fallbackSql) => (orderColumns.has(columnName) ? `o.${columnName}` : `${fallbackSql} AS ${columnName}`);

  const hasBatchId = orderColumns.has('delivery_batch_id');
  const hasSequence = orderColumns.has('delivery_sequence');
  const hasStatus = orderColumns.has('status');
  const hasCreatedAt = orderColumns.has('created_at');
  const hasDeliveryJoin =
    deliveryTableExists &&
    hasBatchId &&
    deliveryColumns.has('id') &&
    deliveryColumns.has('batch_code') &&
    deliveryColumns.has('public_token') &&
    deliveryColumns.has('batch_status') &&
    deliveryColumns.has('vehicle_plate');

  const selectFields = [
    'o.id',
    orderCol('customer', "''"),
    orderCol('address', "''"),
    orderCol('phone', "''"),
    orderCol('payment', "''"),
    orderCol('total', '0'),
    orderCol('items', "'[]'"),
    orderCol('obs', "''"),
    orderCol('status', "'novo'"),
    orderCol('kanban_order', '0'),
    orderCol('order_token', "''"),
    orderCol('created_at', "datetime('now')"),
    orderCol('updated_at', "datetime('now')"),
    orderCol('delivery_batch_id', 'NULL'),
    orderCol('delivery_sequence', 'NULL'),
    orderCol('address_lat', 'NULL'),
    orderCol('address_lng', 'NULL'),
    orderCol('address_geocoded_at', 'NULL'),
    orderCol('delivery_failed_reason', "''"),
    orderCol('delivery_failed_note', "''"),
    orderCol('delivery_attempted_at', 'NULL'),
    orderCol('delivered_at', 'NULL'),
    orderCol('delivery_actor_name', "''"),
    hasDeliveryJoin ? 'b.batch_code AS delivery_batch_code' : "'' AS delivery_batch_code",
    hasDeliveryJoin ? 'b.public_token AS delivery_batch_public_token' : "'' AS delivery_batch_public_token",
    hasDeliveryJoin ? 'b.batch_status AS delivery_batch_status' : "'' AS delivery_batch_status",
    hasDeliveryJoin ? 'b.vehicle_plate AS delivery_vehicle_plate' : "'' AS delivery_vehicle_plate",
  ];

  return `
      SELECT ${selectFields.join(',\n             ')}
        FROM orders o
        ${hasDeliveryJoin ? 'LEFT JOIN delivery_batches b ON b.id = o.delivery_batch_id' : ''}
       ${hasStatus ? "WHERE o.status NOT IN ('entregue', 'cancelado')" : ''}
       ORDER BY ${hasCreatedAt ? 'o.created_at' : 'o.id'} ASC
    `;
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
    const query = await buildKanbanOrdersQuery();
    if (!query) {
      console.warn('Kanban sem tabela orders disponível; retornando lista vazia.');
      return res.json([]);
    }

    const [rows] = await db.execute(query);
    const normalizedRows = rows
      .map((order) => {
        const normalizedStatus = normalizeStatusInput(order.status);
        return {
          ...order,
          status: normalizedStatus,
          items: parseOrderItems(order.items),
          addressLat: order.address_lat,
          addressLng: order.address_lng,
          addressGeocodedAt: order.address_geocoded_at,
          deliveryFailedReason: order.delivery_failed_reason,
          deliveryFailedNote: order.delivery_failed_note,
          deliveryAttemptedAt: order.delivery_attempted_at,
          deliveredAt: order.delivered_at,
          deliveryActorName: order.delivery_actor_name,
          deliveryFailed: Boolean(order.delivery_failed_reason || order.delivery_failed_note || order.delivery_attempted_at),
        };
      })
      .sort(compareOrdersForKanban);

    res.json(normalizedRows);
  } catch (err) {
    console.error('Erro ao buscar pedidos do kanban:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
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
