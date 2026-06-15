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
    orderCol('delivery_followup_state', "''"),
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

function normalizeFollowupState(value) {
  const state = String(value || '').trim().toLowerCase();
  return ['delayed', 'cancelled'].includes(state) ? state : '';
}

function parseDateBoundary(value, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw} ${endOfDay ? '23:59:59' : '00:00:00'}`;
  }
  return raw;
}

function escapeLike(value) {
  return String(value || '').replace(/[%_]/g, '\\$&');
}

function buildOrderTimeSeries(rows, field, format = 'day') {
  const map = new Map();
  for (const row of rows) {
    const raw = String(row[field] || '');
    if (!raw) continue;
    const key = format === 'hour' ? raw.slice(0, 13) : raw.slice(0, 10);
    map.set(key, (map.get(key) || 0) + Number(row.total || 0));
  }
  return Array.from(map.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }));
}

function buildCountSeries(rows, field, format = 'day') {
  const map = new Map();
  for (const row of rows) {
    const raw = String(row[field] || '');
    if (!raw) continue;
    const key = format === 'hour' ? raw.slice(0, 13) : raw.slice(0, 10);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([label, count]) => ({ label, count }));
}

function aggregateByKey(rows, keySelector, valueSelector = (row) => Number(row.total || 0)) {
  const map = new Map();
  for (const row of rows) {
    const key = keySelector(row);
    map.set(key, (map.get(key) || 0) + valueSelector(row));
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
}

function summarizeTopProducts(rows) {
  const productMap = new Map();
  for (const row of rows) {
    const items = parseOrderItems(row.items);
    for (const item of items) {
      const name = String(item?.name || item?.productName || 'Produto sem nome').trim() || 'Produto sem nome';
      const qty = Math.max(1, Number(item?.qty || item?.quantity || 1) || 1);
      const revenue = Number(item?.price || item?.unitPrice || 0) * qty;
      const current = productMap.get(name) || { label: name, quantity: 0, revenue: 0 };
      current.quantity += qty;
      current.revenue += revenue;
      productMap.set(name, current);
    }
  }
  return Array.from(productMap.values())
    .map((item) => ({ ...item, revenue: Number(item.revenue.toFixed(2)) }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 10);
}

function buildAttemptMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const orderId = Number(row.order_id);
    if (!map.has(orderId)) {
      map.set(orderId, []);
    }
    map.get(orderId).push({
      id: Number(row.id),
      action: row.attempt_action,
      reason: row.reason,
      note: row.note,
      attemptedAt: row.attempted_at,
      actorName: row.actor_name,
      orderStatusBefore: row.order_status_before,
      orderStatusAfter: row.order_status_after,
      followupStateBefore: row.followup_state_before,
      followupStateAfter: row.followup_state_after,
    });
  }
  return map;
}

function getLatestAttempt(attempts) {
  return Array.isArray(attempts) && attempts.length ? attempts[0] : null;
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

router.get('/followup', requireAdmin, async (req, res) => {
  try {
    const bucket = String(req.query.bucket || 'delivered').trim().toLowerCase() === 'not_delivered'
      ? 'not_delivered'
      : 'delivered';
    const search = String(req.query.search || '').trim();
    const followupState = normalizeFollowupState(req.query.followupState);
    const status = normalizeStatusInput(req.query.status);
    const from = parseDateBoundary(req.query.from, false);
    const to = parseDateBoundary(req.query.to, true);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = (page - 1) * limit;
    const where = [];
    const params = [];

    if (bucket === 'delivered') {
      where.push(`o.status = 'entregue'`);
    } else {
      where.push(`(
        o.delivery_followup_state IN ('delayed', 'cancelled')
        OR o.status = 'cancelado'
        OR o.delivery_failed_reason <> ''
        OR o.delivery_failed_note <> ''
        OR o.delivery_attempted_at IS NOT NULL
      )`);
    }
    if (followupState) {
      where.push('o.delivery_followup_state = ?');
      params.push(followupState);
    }
    if (status && VALID_STATUSES.includes(status)) {
      where.push('o.status = ?');
      params.push(status);
    }
    if (from) {
      where.push('o.created_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('o.created_at <= ?');
      params.push(to);
    }
    if (search) {
      const like = `%${escapeLike(search)}%`;
      where.push(`(
        o.customer LIKE ? ESCAPE '\\'
        OR o.address LIKE ? ESCAPE '\\'
        OR o.phone LIKE ? ESCAPE '\\'
        OR CAST(o.id AS TEXT) LIKE ? ESCAPE '\\'
      )`);
      params.push(like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM orders o
         ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);
    const [rows] = await db.execute(
      `SELECT o.id, o.customer, o.address, o.phone, o.payment, o.total, o.status,
              o.created_at, o.updated_at, o.delivery_failed_reason, o.delivery_failed_note,
              o.delivery_attempted_at, o.delivered_at, o.delivery_actor_name,
              o.delivery_followup_state, b.batch_code, b.driver_name
         FROM orders o
         LEFT JOIN delivery_batches b ON b.id = o.delivery_batch_id
         ${whereSql}
        ORDER BY COALESCE(o.delivered_at, o.delivery_attempted_at, o.updated_at, o.created_at) DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const orderIds = rows.map((row) => Number(row.id)).filter(Boolean);
    let attemptsMap = new Map();
    if (orderIds.length) {
      const placeholders = orderIds.map(() => '?').join(', ');
      const [attemptRows] = await db.execute(
        `SELECT id, order_id, attempt_action, reason, note, attempted_at, actor_name,
                order_status_before, order_status_after, followup_state_before, followup_state_after
           FROM delivery_attempt_logs
          WHERE order_id IN (${placeholders})
          ORDER BY datetime(attempted_at) DESC, id DESC`,
        orderIds
      );
      attemptsMap = buildAttemptMap(attemptRows);
    }
    res.json({
      total,
      page,
      limit,
      items: rows.map((row) => {
        const attempts = attemptsMap.get(Number(row.id)) || [];
        const latestAttempt = getLatestAttempt(attempts);
        return {
          id: Number(row.id),
          customer: row.customer,
          address: row.address,
          phone: row.phone,
          payment: row.payment,
          total: Number(row.total || 0),
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          deliveredAt: row.delivered_at,
          deliveryAttemptedAt: row.delivery_attempted_at,
          deliveryFailedReason: row.delivery_failed_reason,
          deliveryFailedNote: row.delivery_failed_note,
          deliveryActorName: row.delivery_actor_name,
          deliveryFollowupState: normalizeFollowupState(row.delivery_followup_state),
          batchCode: row.batch_code || '',
          driverName: row.driver_name || '',
          attemptsCount: attempts.length,
          latestAttempt,
        };
      }),
    });
  } catch (err) {
    console.error('Erro ao buscar follow-up:', err.message);
    res.status(500).json({ error: 'Erro ao buscar follow-up' });
  }
});

router.get('/:id/delivery-attempts', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const [rows] = await db.execute(
      `SELECT id, order_id, delivery_batch_id, attempt_action, reason, note, actor_name,
              order_status_before, order_status_after,
              followup_state_before, followup_state_after,
              customer_name, address, phone, payment_method, order_total,
              delivery_sequence, attempted_at
         FROM delivery_attempt_logs
        WHERE order_id = ?
        ORDER BY datetime(attempted_at) DESC, id DESC`,
      [id]
    );
    res.json(rows.map((row) => ({
      id: Number(row.id),
      orderId: Number(row.order_id),
      batchId: row.delivery_batch_id ? Number(row.delivery_batch_id) : null,
      action: row.attempt_action,
      reason: row.reason,
      note: row.note,
      actorName: row.actor_name,
      orderStatusBefore: row.order_status_before,
      orderStatusAfter: row.order_status_after,
      followupStateBefore: row.followup_state_before,
      followupStateAfter: row.followup_state_after,
      customerName: row.customer_name,
      address: row.address,
      phone: row.phone,
      paymentMethod: row.payment_method,
      orderTotal: Number(row.order_total || 0),
      deliverySequence: row.delivery_sequence,
      attemptedAt: row.attempted_at,
    })));
  } catch (err) {
    console.error('Erro ao buscar tentativas da entrega:', err.message);
    res.status(500).json({ error: 'Erro ao buscar tentativas da entrega' });
  }
});

router.get('/finance/summary', requireAdmin, async (req, res) => {
  try {
    const from = parseDateBoundary(req.query.from, false);
    const to = parseDateBoundary(req.query.to, true);
    const params = [];
    const where = [];
    if (from) {
      where.push('o.created_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('o.created_at <= ?');
      params.push(to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.execute(
      `SELECT o.id, o.customer, o.payment, o.total, o.status, o.items,
              o.created_at, o.updated_at, o.delivered_at, o.delivery_followup_state
         FROM orders o
         ${whereSql}
        ORDER BY o.created_at DESC`,
      params
    );

    const normalizedRows = rows.map((row) => ({ ...row, total: Number(row.total || 0) }));
    const grossSales = normalizedRows.reduce((sum, row) => sum + row.total, 0);
    const deliveredRows = normalizedRows.filter((row) => row.status === 'entregue');
    const cancelledRows = normalizedRows.filter((row) => row.status === 'cancelado');
    const operationalRows = normalizedRows.filter((row) => !['entregue', 'cancelado'].includes(row.status));
    const deliveredRevenue = deliveredRows.reduce((sum, row) => sum + row.total, 0);
    const cancelledValue = cancelledRows.reduce((sum, row) => sum + row.total, 0);
    const openOperationalValue = operationalRows.reduce((sum, row) => sum + row.total, 0);
    const averageTicket = normalizedRows.length ? grossSales / normalizedRows.length : 0;

    res.json({
      grossSales: Number(grossSales.toFixed(2)),
      deliveredRevenue: Number(deliveredRevenue.toFixed(2)),
      cancelledValue: Number(cancelledValue.toFixed(2)),
      openOperationalValue: Number(openOperationalValue.toFixed(2)),
      ordersCount: normalizedRows.length,
      deliveredCount: deliveredRows.length,
      cancelledCount: cancelledRows.length,
      averageTicket: Number(averageTicket.toFixed(2)),
      paymentBreakdown: aggregateByKey(normalizedRows, (row) => row.payment || 'Nao informado'),
      statusBreakdown: aggregateByKey(normalizedRows, (row) => STATUS_LABEL[row.status] || row.status, () => 1)
        .map((item) => ({ ...item, count: item.value, value: undefined })),
      dailySeries: buildOrderTimeSeries(normalizedRows, 'created_at', 'day'),
      hourlySeries: buildCountSeries(normalizedRows, 'created_at', 'hour'),
      topCustomers: aggregateByKey(normalizedRows, (row) => row.customer || 'Cliente nao informado')
        .slice(0, 10),
      topProducts: summarizeTopProducts(normalizedRows),
    });
  } catch (err) {
    console.error('Erro ao montar resumo financeiro:', err.message);
    res.status(500).json({ error: 'Erro ao montar resumo financeiro' });
  }
});

router.get('/finance/details', requireAdmin, async (req, res) => {
  try {
    const from = parseDateBoundary(req.query.from, false);
    const to = parseDateBoundary(req.query.to, true);
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const params = [];
    const where = [];
    if (from) {
      where.push('o.created_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('o.created_at <= ?');
      params.push(to);
    }
    if (search) {
      const like = `%${escapeLike(search)}%`;
      where.push(`(
        o.customer LIKE ? ESCAPE '\\'
        OR o.address LIKE ? ESCAPE '\\'
        OR o.payment LIKE ? ESCAPE '\\'
        OR CAST(o.id AS TEXT) LIKE ? ESCAPE '\\'
      )`);
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM orders o
         ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);
    const [rows] = await db.execute(
      `SELECT o.id, o.customer, o.payment, o.total, o.status, o.created_at,
              o.updated_at, o.delivered_at, o.delivery_followup_state,
              b.batch_code, b.driver_name
         FROM orders o
         LEFT JOIN delivery_batches b ON b.id = o.delivery_batch_id
         ${whereSql}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({
      total,
      page,
      limit,
      items: rows.map((row) => ({
        id: Number(row.id),
        customer: row.customer,
        payment: row.payment,
        total: Number(row.total || 0),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deliveredAt: row.delivered_at,
        deliveryFollowupState: normalizeFollowupState(row.delivery_followup_state),
        batchCode: row.batch_code || '',
        driverName: row.driver_name || '',
      })),
    });
  } catch (err) {
    console.error('Erro ao listar detalhes financeiros:', err.message);
    res.status(500).json({ error: 'Erro ao listar detalhes financeiros' });
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
