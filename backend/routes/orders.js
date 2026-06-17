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

const VALID_STATUSES = ['novo', 'em_producao', 'pronto_para_servir', 'aguardando_envio', 'preparando_rota', 'a_caminho', 'entregue', 'cancelado'];
const STATUS_ALIASES = {
  aguardando_entrega: 'aguardando_envio',
  separando_rota: 'preparando_rota',
  preparacao_rota: 'preparando_rota',
  preparo_rota: 'preparando_rota',
  em_rota: 'a_caminho',
  em_entrega: 'a_caminho',
  saiu_para_entrega: 'a_caminho',
  pronto_para_servico: 'pronto_para_servir',
  pronto_servir: 'pronto_para_servir',
};
const STATUS_ORDER = {
  novo: 1,
  em_producao: 2,
  pronto_para_servir: 3,
  aguardando_envio: 4,
  preparando_rota: 5,
  a_caminho: 6,
  entregue: 7,
  cancelado: 8,
};

const STATUS_LABEL = {
  novo:             'Novo Pedido',
  em_producao:      'Em Produção',
  pronto_para_servir: 'Pronto para Servir',
  aguardando_envio: 'Aguardando Envio',
  preparando_rota:  'Preparando Rota',
  a_caminho:        'A Caminho',
  entregue:         'Entregue',
  cancelado:        'Cancelado',
};

const LOCAL_SERVICE_STATUS_LABEL = {
  '': 'Sem etapa local',
  aberta: 'Comanda aberta',
  aguardando_preparo: 'Aguardando preparo',
  pronto_para_servir: 'Pronto para servir',
  em_atendimento: 'Em atendimento',
  fechado: 'Fechado',
};

function normalizeStatusInput(status) {
  const key = String(status || '').trim();
  return STATUS_ALIASES[key] || key;
}

function normalizeServiceChannel(value) {
  return String(value || '').trim().toLowerCase() === 'local' ? 'local' : 'delivery';
}

function normalizeLocalServiceStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['aberta', 'aguardando_preparo', 'pronto_para_servir', 'em_atendimento', 'fechado'].includes(status)
    ? status
    : '';
}

async function getConfigValue(key) {
  const [rows] = await db.execute('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || '';
}

function normalizeConfigBoolean(value, fallback = false) {
  if (value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function getLocalServiceSettings() {
  return {
    enabled: normalizeConfigBoolean(await getConfigValue('localServiceEnabled')),
    label: String(await getConfigValue('localServiceLabel') || 'Atendimento Local').trim() || 'Atendimento Local',
    color: String(await getConfigValue('localServiceColor') || '#d97706').trim() || '#d97706',
    requireWaiter: normalizeConfigBoolean(await getConfigValue('localRequireWaiter')),
    requireTable: normalizeConfigBoolean(await getConfigValue('localRequireTable')),
    autoGenerateCommandCode: normalizeConfigBoolean(await getConfigValue('localAutoGenerateCommandCode')),
    commandPrefix: String(await getConfigValue('localCommandPrefix') || 'CMD').trim().slice(0, 10) || 'CMD',
    allowTableTransfer: normalizeConfigBoolean(await getConfigValue('localAllowTableTransfer')),
    allowSplitPayment: normalizeConfigBoolean(await getConfigValue('localAllowSplitPayment')),
  };
}

async function assertLocalServiceEnabled(res) {
  const localSettings = await getLocalServiceSettings();
  if (!localSettings.enabled) {
    res.status(409).json({ error: 'O módulo de atendimento local está desabilitado.' });
    return null;
  }
  return localSettings;
}

function generateCommandCode(prefix = 'CMD') {
  return `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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
  const tablesTableExists = await hasTable('service_tables');
  const waitersTableExists = await hasTable('service_waiters');
  const orderCol = (columnName, fallbackSql) => (orderColumns.has(columnName) ? `o.${columnName}` : `${fallbackSql} AS ${columnName}`);

  const hasBatchId = orderColumns.has('delivery_batch_id');
  const hasSequence = orderColumns.has('delivery_sequence');
  const hasStatus = orderColumns.has('status');
  const hasCreatedAt = orderColumns.has('created_at');
  const hasTableJoin = tablesTableExists && orderColumns.has('table_id');
  const hasWaiterJoin = waitersTableExists && orderColumns.has('waiter_id');
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
    orderCol('service_channel', "'delivery'"),
    orderCol('table_id', 'NULL'),
    orderCol('waiter_id', 'NULL'),
    orderCol('command_code', "''"),
    orderCol('local_service_status', "''"),
    orderCol('closed_at', 'NULL'),
    orderCol('served_at', 'NULL'),
    orderCol('closed_payment_method', "''"),
    orderCol('closed_total', '0'),
    orderCol('service_tag_color', "''"),
    hasTableJoin ? "t.name AS table_name" : "'' AS table_name",
    hasWaiterJoin ? "w.name AS waiter_name" : "'' AS waiter_name",
    hasWaiterJoin ? "w.code AS waiter_code" : "'' AS waiter_code",
    hasDeliveryJoin ? 'b.batch_code AS delivery_batch_code' : "'' AS delivery_batch_code",
    hasDeliveryJoin ? 'b.public_token AS delivery_batch_public_token' : "'' AS delivery_batch_public_token",
    hasDeliveryJoin ? 'b.batch_status AS delivery_batch_status' : "'' AS delivery_batch_status",
    hasDeliveryJoin ? 'b.vehicle_plate AS delivery_vehicle_plate' : "'' AS delivery_vehicle_plate",
  ];

  return `
      SELECT ${selectFields.join(',\n             ')}
        FROM orders o
        ${hasTableJoin ? 'LEFT JOIN service_tables t ON t.id = o.table_id' : ''}
        ${hasWaiterJoin ? 'LEFT JOIN service_waiters w ON w.id = o.waiter_id' : ''}
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

function buildLocalOrderPayload(order) {
  return {
    id: Number(order.id),
    customer: order.customer,
    phone: order.phone || '',
    payment: order.payment || '',
    total: Number(order.total || 0),
    closedTotal: Number(order.closed_total || order.closedTotal || 0),
    obs: order.obs || '',
    status: normalizeStatusInput(order.status),
    statusLabel: STATUS_LABEL[normalizeStatusInput(order.status)] || order.status,
    serviceChannel: normalizeServiceChannel(order.service_channel || order.serviceChannel),
    tableId: order.table_id ? Number(order.table_id) : null,
    tableName: order.table_name || '',
    waiterId: order.waiter_id ? Number(order.waiter_id) : null,
    waiterName: order.waiter_name || '',
    waiterCode: order.waiter_code || '',
    commandCode: order.command_code || '',
    localServiceStatus: normalizeLocalServiceStatus(order.local_service_status || order.localServiceStatus),
    localServiceStatusLabel: LOCAL_SERVICE_STATUS_LABEL[normalizeLocalServiceStatus(order.local_service_status || order.localServiceStatus)] || 'Sem etapa local',
    serviceTagColor: order.service_tag_color || '',
    items: parseOrderItems(order.items),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    openedAt: order.opened_at || order.created_at,
    servedAt: order.served_at || null,
    closedAt: order.closed_at || null,
    closedPaymentMethod: order.closed_payment_method || '',
  };
}

async function getLocalOrderById(id) {
  const [rows] = await db.execute(
    `SELECT o.*,
            t.name AS table_name,
            w.name AS waiter_name,
            w.code AS waiter_code
       FROM orders o
       LEFT JOIN service_tables t ON t.id = o.table_id
       LEFT JOIN service_waiters w ON w.id = o.waiter_id
      WHERE o.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function createOrderRecord(parsed, localSettings) {
  const serviceChannel = normalizeServiceChannel(parsed.serviceChannel);
  const isLocal = serviceChannel === 'local';
  const commandCode = isLocal
    ? (parsed.commandCode || (localSettings.autoGenerateCommandCode ? generateCommandCode(localSettings.commandPrefix) : ''))
    : '';
  const localServiceStatus = isLocal
    ? normalizeLocalServiceStatus(parsed.localServiceStatus) || 'aberta'
    : '';
  const serviceTagColor = isLocal ? (parsed.serviceTagColor || localSettings.color || '') : '';

  const [result] = await db.execute(
    `INSERT INTO orders (
      customer, address, phone, payment, total, items, obs, status, kanban_order, order_token,
      service_channel, table_id, waiter_id, command_code, local_service_status, opened_at, service_tag_color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'novo', 0, '', ?, ?, ?, ?, ?, datetime('now'), ?)`,
    [
      parsed.customer,
      isLocal ? '' : parsed.address,
      parsed.phone,
      parsed.payment,
      parsed.total,
      JSON.stringify(parsed.items),
      parsed.obs,
      serviceChannel,
      parsed.tableId,
      parsed.waiterId,
      commandCode,
      localServiceStatus,
      serviceTagColor,
    ]
  );

  const id = result.insertId;
  const token = generateToken(id);
  await db.execute('UPDATE orders SET order_token = ? WHERE id = ?', [token, id]);

  return { id, token, commandCode };
}

// ---------------------------------------------------------------------------
// Público — criar pedido (retorna id + token para rastreio)
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const parsed = sanitizeOrderInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const localSettings = await getLocalServiceSettings();
    const isLocal = normalizeServiceChannel(parsed.serviceChannel) === 'local';
    if (isLocal && localSettings.requireTable && !parsed.tableId) {
      return res.status(400).json({ error: 'Selecione uma mesa para o atendimento local.' });
    }
    if (isLocal && localSettings.requireWaiter && !parsed.waiterId) {
      return res.status(400).json({ error: 'Selecione um garçom para o atendimento local.' });
    }

    const { id, token, commandCode } = await createOrderRecord(parsed, localSettings);

    notifyClients('order-created');
    res.json({ success: true, id, token, commandCode });
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

router.post('/local', requireAdmin, async (req, res) => {
  const parsed = sanitizeOrderInput({ ...req.body, serviceChannel: 'local' });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const localSettings = await assertLocalServiceEnabled(res);
    if (!localSettings) return;
    if (localSettings.requireTable && !parsed.tableId) {
      return res.status(400).json({ error: 'Selecione uma mesa para abrir a comanda.' });
    }
    if (localSettings.requireWaiter && !parsed.waiterId) {
      return res.status(400).json({ error: 'Selecione um garçom para abrir a comanda.' });
    }

    const created = await createOrderRecord(parsed, localSettings);
    const order = await getLocalOrderById(created.id);
    notifyClients('order-created');
    res.status(201).json({ success: true, ...created, order: buildLocalOrderPayload(order) });
  } catch (err) {
    console.error('Erro ao criar comanda local:', err.message);
    res.status(500).json({ error: 'Erro ao criar comanda local.' });
  }
});

router.get('/local/open', requireAdmin, async (_req, res) => {
  try {
    const localSettings = await assertLocalServiceEnabled(res);
    if (!localSettings) return;
    const [rows] = await db.execute(
      `SELECT o.*,
              t.name AS table_name,
              w.name AS waiter_name,
              w.code AS waiter_code
         FROM orders o
         LEFT JOIN service_tables t ON t.id = o.table_id
         LEFT JOIN service_waiters w ON w.id = o.waiter_id
        WHERE o.service_channel = 'local'
          AND COALESCE(o.closed_at, '') = ''
        ORDER BY datetime(COALESCE(o.opened_at, o.created_at)) DESC, o.id DESC`
    );

    res.json({
      items: rows.map((row) => buildLocalOrderPayload(row)),
    });
  } catch (err) {
    console.error('Erro ao listar comandas abertas:', err.message);
    res.status(500).json({ error: 'Erro ao listar comandas abertas.' });
  }
});

router.post('/local/:id/items', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  const parsed = sanitizeOrderInput({ ...req.body, customer: req.body.customer || 'Cliente local', serviceChannel: 'local' });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const localSettings = await assertLocalServiceEnabled(res);
    if (!localSettings) return;
    const order = await getLocalOrderById(id);
    if (!order || normalizeServiceChannel(order.service_channel) !== 'local') {
      return res.status(404).json({ error: 'Comanda local não encontrada.' });
    }
    if (order.closed_at) {
      return res.status(409).json({ error: 'A comanda já foi fechada.' });
    }

    const currentItems = parseOrderItems(order.items);
    const mergedItems = [...currentItems, ...parsed.items];
    const addedTotal = parsed.items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 1)), 0);
    const updatedTotal = parsed.total > 0 ? parsed.total : Number(order.total || 0) + addedTotal;
    await db.execute(
      `UPDATE orders
          SET items = ?, total = ?, obs = ?, updated_at = datetime('now'),
              status = CASE WHEN status = 'pronto_para_servir' THEN 'em_producao' ELSE status END,
              local_service_status = 'aguardando_preparo'
        WHERE id = ?`,
      [JSON.stringify(mergedItems), updatedTotal, parsed.obs || order.obs || '', id]
    );

    const updated = await getLocalOrderById(id);
    notifyClients('order-created');
    res.json({ success: true, order: buildLocalOrderPayload(updated) });
  } catch (err) {
    console.error('Erro ao adicionar itens à comanda:', err.message);
    res.status(500).json({ error: 'Erro ao adicionar itens à comanda.' });
  }
});

router.post('/local/:id/close', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  try {
    const localSettings = await assertLocalServiceEnabled(res);
    if (!localSettings) return;
    const order = await getLocalOrderById(id);
    if (!order || normalizeServiceChannel(order.service_channel) !== 'local') {
      return res.status(404).json({ error: 'Comanda local não encontrada.' });
    }
    if (order.closed_at) {
      return res.status(409).json({ error: 'A comanda já está fechada.' });
    }

    const payment = String(req.body.payment || '').trim() || order.payment || 'dinheiro';
    const closedTotal = Number(req.body.closedTotal ?? req.body.total ?? order.total ?? 0);
    const splitPayments = Array.isArray(req.body.splitPayments) ? req.body.splitPayments : [];
    if (!localSettings.allowSplitPayment && splitPayments.length > 1) {
      return res.status(400).json({ error: 'Pagamento dividido está desabilitado para este cliente.' });
    }

    await db.execute(
      `UPDATE orders
          SET payment = ?, closed_payment_method = ?, closed_total = ?, closed_at = datetime('now'),
              local_service_status = 'fechado', status = 'entregue', updated_at = datetime('now')
        WHERE id = ?`,
      [payment, payment, closedTotal, id]
    );

    const updated = await getLocalOrderById(id);
    notifyClients('order-status-changed');
    res.json({ success: true, order: buildLocalOrderPayload(updated) });
  } catch (err) {
    console.error('Erro ao fechar comanda local:', err.message);
    res.status(500).json({ error: 'Erro ao fechar comanda local.' });
  }
});

router.post('/local/:id/reopen', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  try {
    const localSettings = await assertLocalServiceEnabled(res);
    if (!localSettings) return;
    const order = await getLocalOrderById(id);
    if (!order || normalizeServiceChannel(order.service_channel) !== 'local') {
      return res.status(404).json({ error: 'Comanda local não encontrada.' });
    }

    await db.execute(
      `UPDATE orders
          SET closed_at = NULL, closed_payment_method = '', local_service_status = 'em_atendimento',
              status = 'em_producao', updated_at = datetime('now')
        WHERE id = ?`,
      [id]
    );

    const updated = await getLocalOrderById(id);
    notifyClients('order-status-changed');
    res.json({ success: true, order: buildLocalOrderPayload(updated) });
  } catch (err) {
    console.error('Erro ao reabrir comanda local:', err.message);
    res.status(500).json({ error: 'Erro ao reabrir comanda local.' });
  }
});

router.post('/local/:id/transfer-table', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  const tableId = parsePositiveId(req.body.tableId);
  if (!id || !tableId) return res.status(400).json({ error: 'Comanda ou mesa inválida.' });

  try {
    const localSettings = await assertLocalServiceEnabled(res);
    if (!localSettings) return;
    if (!localSettings.allowTableTransfer) {
      return res.status(403).json({ error: 'Troca de mesa está desabilitada para este cliente.' });
    }

    const order = await getLocalOrderById(id);
    if (!order || normalizeServiceChannel(order.service_channel) !== 'local') {
      return res.status(404).json({ error: 'Comanda local não encontrada.' });
    }

    await db.execute(
      `UPDATE orders
          SET table_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [tableId, id]
    );

    const updated = await getLocalOrderById(id);
    res.json({ success: true, order: buildLocalOrderPayload(updated) });
  } catch (err) {
    console.error('Erro ao transferir mesa da comanda:', err.message);
    res.status(500).json({ error: 'Erro ao transferir mesa da comanda.' });
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
        const serviceChannel = normalizeServiceChannel(order.service_channel);
        const localServiceStatus = normalizeLocalServiceStatus(order.local_service_status);
        return {
          ...order,
          status: normalizedStatus,
          statusLabel: STATUS_LABEL[normalizedStatus] || normalizedStatus,
          serviceChannel,
          localServiceStatus,
          localServiceStatusLabel: LOCAL_SERVICE_STATUS_LABEL[localServiceStatus] || 'Sem etapa local',
          tableId: order.table_id ? Number(order.table_id) : null,
          tableName: order.table_name || '',
          waiterId: order.waiter_id ? Number(order.waiter_id) : null,
          waiterName: order.waiter_name || '',
          waiterCode: order.waiter_code || '',
          commandCode: order.command_code || '',
          serviceTagColor: order.service_tag_color || '',
          closedAt: order.closed_at || null,
          servedAt: order.served_at || null,
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
              o.created_at, o.updated_at, o.delivered_at, o.delivery_followup_state,
              COALESCE(o.service_channel, 'delivery') AS service_channel,
              COALESCE(o.closed_at, '') AS closed_at,
              COALESCE(o.waiter_id, NULL) AS waiter_id
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
      serviceChannelBreakdown: aggregateByKey(normalizedRows, (row) => normalizeServiceChannel(row.service_channel), () => 1)
        .map((item) => ({ ...item, count: item.value, value: undefined })),
      waiterBreakdown: aggregateByKey(
        normalizedRows.filter((row) => normalizeServiceChannel(row.service_channel) === 'local' && row.status === 'entregue'),
        (row) => row.waiter_id ? `Garçom #${row.waiter_id}` : 'Sem garçom',
        () => 1
      ).map((item) => ({ ...item, count: item.value, value: undefined })),
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
              COALESCE(o.service_channel, 'delivery') AS service_channel,
              COALESCE(o.command_code, '') AS command_code,
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
        serviceChannel: normalizeServiceChannel(row.service_channel),
        commandCode: row.command_code || '',
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
    const order = await getLocalOrderById(id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    const serviceChannel = normalizeServiceChannel(order.service_channel);
    let localServiceStatus = normalizeLocalServiceStatus(order.local_service_status);
    let servedAtSql = 'served_at';

    if (serviceChannel === 'local') {
      if (status === 'novo' || status === 'em_producao') {
        localServiceStatus = 'aguardando_preparo';
      } else if (status === 'pronto_para_servir') {
        localServiceStatus = 'pronto_para_servir';
        servedAtSql = "datetime('now')";
      } else if (status === 'entregue') {
        localServiceStatus = order.closed_at ? 'fechado' : 'em_atendimento';
        servedAtSql = "COALESCE(served_at, datetime('now'))";
      }
    }

    const [result] = await db.execute(
      `UPDATE orders
          SET status = ?,
              updated_at = datetime('now'),
              local_service_status = CASE
                WHEN COALESCE(service_channel, 'delivery') = 'local' THEN ?
                ELSE local_service_status
              END,
              served_at = CASE
                WHEN COALESCE(service_channel, 'delivery') = 'local' THEN ${servedAtSql}
                ELSE served_at
              END
        WHERE id = ?`,
      [status, localServiceStatus, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

    notifyClients('order-status-changed');
    res.json({ success: true, status, statusLabel: STATUS_LABEL[status], serviceChannel });
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
