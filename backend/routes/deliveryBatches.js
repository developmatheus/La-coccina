const express = require('express');
const crypto = require('crypto');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notifyClients } = require('../menuEvents');
const { parsePositiveId } = require('../utils/sanitize');

const router = express.Router();

const VALID_BATCH_STATUSES = ['preparado', 'aceito_motoboy', 'liberado_cozinha'];
const DRIVER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DRIVER_FAILURE_REASONS = new Set(['cliente_ausente', 'endereco_incorreto', 'pedido_cancelado', 'outro']);

async function getTableColumns(conn, tableName) {
  try {
    const rows = await conn.all(`PRAGMA table_info(${tableName})`);
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

async function ensureColumn(conn, tableName, columnName, sqlDefinition) {
  const columns = await getTableColumns(conn, tableName);
  if (!columns.has(columnName)) {
    await conn.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`);
  }
}

async function ensureDeliveryBatchSchema() {
  const conn = await db.raw();

  await conn.exec(`
    CREATE TABLE IF NOT EXISTS delivery_batches (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_code           TEXT    NOT NULL DEFAULT '',
      public_token         TEXT    NOT NULL DEFAULT '',
      batch_status         TEXT    NOT NULL DEFAULT 'preparado',
      origin_address       TEXT    NOT NULL DEFAULT '',
      maps_url             TEXT    NOT NULL DEFAULT '',
      driver_name          TEXT    NOT NULL DEFAULT '',
      driver_whatsapp      TEXT    NOT NULL DEFAULT '',
      driver_cpf           TEXT    NOT NULL DEFAULT '',
      vehicle_model        TEXT    NOT NULL DEFAULT '',
      vehicle_plate        TEXT    NOT NULL DEFAULT '',
      accepted_at          TEXT,
      kitchen_confirmed_at TEXT,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await ensureColumn(conn, 'orders', 'delivery_batch_id', 'INTEGER');
  await ensureColumn(conn, 'orders', 'delivery_sequence', 'INTEGER');
  await ensureColumn(conn, 'orders', 'address_lat', 'REAL');
  await ensureColumn(conn, 'orders', 'address_lng', 'REAL');
  await ensureColumn(conn, 'orders', 'address_geocoded_at', 'TEXT');
  await ensureColumn(conn, 'orders', 'delivery_failed_reason', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'orders', 'delivery_failed_note', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'orders', 'delivered_at', 'TEXT');
  await ensureColumn(conn, 'orders', 'delivery_attempted_at', 'TEXT');
  await ensureColumn(conn, 'orders', 'delivery_actor_name', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'delivery_batches', 'current_order_id', 'INTEGER');
  await ensureColumn(conn, 'delivery_batches', 'driver_session_token', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'delivery_batches', 'driver_session_expires_at', 'TEXT');

  await conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_delivery_batches_public_token ON delivery_batches(public_token);
    CREATE INDEX IF NOT EXISTS idx_delivery_batches_status ON delivery_batches(batch_status);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_batch_id ON orders(delivery_batch_id);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_sequence ON orders(delivery_sequence);
  `);
}

function generatePublicToken() {
  return crypto.randomBytes(12).toString('hex');
}

function generateDriverSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function toSessionExpiryIso() {
  return new Date(Date.now() + DRIVER_SESSION_TTL_MS).toISOString();
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function normalizeResolvedStops(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((stop) => {
      const id = Number(stop?.id);
      const lat = Number(stop?.lat);
      const lng = Number(stop?.lng);
      if (!Number.isInteger(id) || id <= 0) return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { id, lat, lng };
    })
    .filter(Boolean);
}

function normalizeFailureReason(value) {
  const reason = String(value || '').trim().toLowerCase();
  return DRIVER_FAILURE_REASONS.has(reason) ? reason : '';
}

function parseSessionExpiry(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function secureTokenEquals(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseDriverSessionFromRequest(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function normalizeDriverIdentity(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizePhoneIdentity(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePlateIdentity(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function getConfigValue(key) {
  const [rows] = await db.execute('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || '';
}

async function loadBatchByToken(token) {
  await ensureDeliveryBatchSchema();
  const [rows] = await db.execute(
    `SELECT id, batch_code, public_token, batch_status, origin_address, maps_url,
            driver_name, driver_whatsapp, driver_cpf, vehicle_model, vehicle_plate,
            accepted_at, kitchen_confirmed_at, created_at, updated_at,
            current_order_id, driver_session_token, driver_session_expires_at
       FROM delivery_batches
      WHERE public_token = ?`,
    [token]
  );
  return rows[0] || null;
}

async function loadBatchOrders(batchId) {
  await ensureDeliveryBatchSchema();
  const [rows] = await db.execute(
    `SELECT id, customer, address, phone, payment, total, items, obs, status,
            delivery_sequence, created_at, updated_at,
            address_lat, address_lng, address_geocoded_at,
            delivery_failed_reason, delivery_failed_note,
            delivered_at, delivery_attempted_at, delivery_actor_name
       FROM orders
      WHERE delivery_batch_id = ?
      ORDER BY COALESCE(delivery_sequence, 999999) ASC, created_at ASC`,
    [batchId]
  );
  return rows.map((row) => ({
    ...row,
    items: JSON.parse(row.items || '[]'),
    addressLat: row.address_lat,
    addressLng: row.address_lng,
    addressGeocodedAt: row.address_geocoded_at,
    deliveryFailedReason: row.delivery_failed_reason,
    deliveryFailedNote: row.delivery_failed_note,
    deliveredAt: row.delivered_at,
    deliveryAttemptedAt: row.delivery_attempted_at,
    deliveryActorName: row.delivery_actor_name,
    deliveryFailed: Boolean(row.delivery_failed_reason || row.delivery_failed_note || row.delivery_attempted_at),
  }));
}

function sortBatchOrders(orders) {
  return (orders || []).slice().sort((left, right) => {
    const seqDiff = (left.delivery_sequence || 999999) - (right.delivery_sequence || 999999);
    if (seqDiff) return seqDiff;
    return new Date(`${left.created_at || ''}Z`).getTime() - new Date(`${right.created_at || ''}Z`).getTime();
  });
}

function isOperationalFailure(order) {
  return Boolean(
    order?.deliveryFailed ||
    order?.delivery_failed_reason ||
    order?.delivery_failed_note ||
    order?.delivery_attempted_at ||
    order?.deliveryAttemptedAt
  );
}

function isRouteEligible(order) {
  if (!order) return false;
  if (order.status === 'entregue' || order.status === 'cancelado') return false;
  if (isOperationalFailure(order)) return false;
  return true;
}

function serializeRouteStop(order) {
  if (!order) return null;
  return {
    orderId: Number(order.id),
    sequence: order.delivery_sequence ?? null,
    customerName: order.customer || '',
    address: order.address || '',
    address_lat: Number.isFinite(Number(order.addressLat ?? order.address_lat))
      ? Number(order.addressLat ?? order.address_lat)
      : null,
    address_lng: Number.isFinite(Number(order.addressLng ?? order.address_lng))
      ? Number(order.addressLng ?? order.address_lng)
      : null,
    phone: order.phone || '',
    amount: Number(order.total || 0),
    paymentMethod: order.payment || '',
    status: order.status || '',
    obs: order.obs || '',
  };
}

function buildStopLocation(stop) {
  if (!stop) return '';
  const lat = Number(stop.address_lat);
  const lng = Number(stop.address_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat},${lng}`;
  }
  return encodeURIComponent(stop.address || '');
}

function buildGoogleMapsCurrentUrl(stop) {
  if (!stop) return '';
  const lat = Number(stop.address_lat);
  const lng = Number(stop.address_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  if (!stop.address) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`;
}

function buildGoogleMapsWindowUrl(routeWindow) {
  const windowStops = Array.isArray(routeWindow) ? routeWindow.filter(Boolean).slice(0, 4) : [];
  if (!windowStops.length) return '';
  if (windowStops.length === 1) {
    return buildGoogleMapsCurrentUrl(windowStops[0]);
  }

  const destination = buildStopLocation(windowStops[windowStops.length - 1]);
  const waypoints = windowStops.slice(0, -1).map(buildStopLocation).filter(Boolean);
  if (!destination) return '';

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', destination);
  if (waypoints.length) {
    url.searchParams.set('waypoints', waypoints.join('|'));
  }
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

function buildWazeCurrentUrl(stop) {
  if (!stop) return '';
  const lat = Number(stop.address_lat);
  const lng = Number(stop.address_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  if (!stop.address) return '';
  return `https://waze.com/ul?q=${encodeURIComponent(stop.address)}&navigate=yes`;
}

function getRouteWindow(batchOrders, currentOrderId, limit = 3) {
  const ordered = sortBatchOrders(batchOrders);
  const eligible = ordered.filter(isRouteEligible);
  if (!eligible.length) {
    return {
      currentOrderId: null,
      currentStop: null,
      nextStops: [],
      routeWindow: [],
      links: {
        googleMapsCurrent: '',
        googleMapsWindow: '',
        wazeCurrent: '',
      },
    };
  }

  const normalizedCurrentId = Number(currentOrderId) || null;
  let currentOrder = normalizedCurrentId
    ? eligible.find((order) => Number(order.id) === normalizedCurrentId)
    : null;

  if (!currentOrder && normalizedCurrentId) {
    const currentIndexInOrdered = ordered.findIndex((order) => Number(order.id) === normalizedCurrentId);
    if (currentIndexInOrdered >= 0) {
      currentOrder = ordered.slice(currentIndexInOrdered + 1).find(isRouteEligible) || null;
    }
  }

  if (!currentOrder) {
    currentOrder = eligible[0];
  }

  const currentIndex = eligible.findIndex((order) => Number(order.id) === Number(currentOrder.id));
  const nextOrders = eligible.slice(currentIndex + 1, currentIndex + 1 + Math.max(0, Number(limit) || 3));
  const routeWindow = [currentOrder, ...nextOrders].map(serializeRouteStop).filter(Boolean);
  const currentStop = routeWindow[0] || null;

  return {
    currentOrderId: currentStop?.orderId || null,
    currentStop,
    nextStops: routeWindow.slice(1),
    routeWindow,
    links: {
      googleMapsCurrent: buildGoogleMapsCurrentUrl(currentStop),
      googleMapsWindow: buildGoogleMapsWindowUrl(routeWindow),
      wazeCurrent: buildWazeCurrentUrl(currentStop),
    },
  };
}

async function serializeBatch(batch) {
  const orders = await loadBatchOrders(batch.id);
  const routeWindow = getRouteWindow(orders, batch.current_order_id, 3);
  return {
    id: batch.id,
    batchCode: batch.batch_code,
    publicToken: batch.public_token,
    batchStatus: batch.batch_status,
    originAddress: batch.origin_address,
    mapsUrl: batch.maps_url,
    driver: {
      name: batch.driver_name,
      whatsapp: batch.driver_whatsapp,
      cpf: batch.driver_cpf,
      vehicleModel: batch.vehicle_model,
      vehiclePlate: batch.vehicle_plate,
    },
    acceptedAt: batch.accepted_at,
    kitchenConfirmedAt: batch.kitchen_confirmed_at,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    currentOrderId: routeWindow.currentOrderId,
    currentStop: routeWindow.currentStop,
    nextStops: routeWindow.nextStops,
    routeWindow: routeWindow.routeWindow,
    links: routeWindow.links,
    orders,
  };
}

async function issueDriverSession(conn, batchId) {
  const driverSessionToken = generateDriverSessionToken();
  const driverSessionExpiresAt = toSessionExpiryIso();
  await conn.run(
    `UPDATE delivery_batches
        SET driver_session_token = ?,
            driver_session_expires_at = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [driverSessionToken, driverSessionExpiresAt, batchId]
  );
  return { driverSessionToken, driverSessionExpiresAt };
}

async function requireDriverSession(req, token) {
  const batch = await loadBatchByToken(token);
  if (!batch) {
    return { error: { status: 404, body: { error: 'Lote não encontrado.' } } };
  }

  const sessionToken = parseDriverSessionFromRequest(req);
  if (!sessionToken) {
    return { error: { status: 401, body: { error: 'Sessão do motoboy ausente.' } } };
  }

  if (!secureTokenEquals(batch.driver_session_token, sessionToken)) {
    return { error: { status: 401, body: { error: 'Sessão do motoboy inválida.' } } };
  }

  if (parseSessionExpiry(batch.driver_session_expires_at) <= Date.now()) {
    return { error: { status: 401, body: { error: 'Sessão do motoboy expirada.' } } };
  }

  return { batch };
}

async function loadBatchOrderById(batchId, orderId) {
  const [rows] = await db.execute(
    `SELECT id, status, delivery_sequence, delivery_failed_reason, delivery_failed_note,
            delivered_at, delivery_attempted_at
       FROM orders
      WHERE delivery_batch_id = ? AND id = ?`,
    [batchId, orderId]
  );
  return rows[0] || null;
}

async function nextOpenOrderId(conn, batchId, currentOrderId) {
  const rows = await conn.all(
    `SELECT id, status, delivery_sequence, created_at,
            delivery_failed_reason, delivery_failed_note, delivery_attempted_at
       FROM orders
      WHERE delivery_batch_id = ?
      ORDER BY COALESCE(delivery_sequence, 999999) ASC, created_at ASC`,
    [batchId]
  );

  return getRouteWindow(rows, currentOrderId, 3).currentOrderId || null;
}

async function nextBatchCode(conn) {
  const row = await conn.get('SELECT id FROM delivery_batches ORDER BY id DESC LIMIT 1');
  const nextId = (row?.id || 0) + 1;
  return `L${String(nextId).padStart(3, '0')}`;
}

router.post('/prepare', requireAdmin, async (req, res) => {
  const orderIds = normalizeIds(req.body.orderIds);
  const orderedOrderIds = normalizeIds(req.body.orderedOrderIds);
  const mapsUrl = String(req.body.mapsUrl || '').trim();
  const originAddress = String(req.body.originAddress || '').trim();
  const resolvedStops = normalizeResolvedStops(req.body.resolvedStops);

  if (!orderIds.length || !orderedOrderIds.length) {
    return res.status(400).json({ error: 'Selecione pedidos válidos para montar o lote.' });
  }
  if (orderIds.length !== orderedOrderIds.length) {
    return res.status(400).json({ error: 'A ordenação do lote está inconsistente.' });
  }
  if (new Set(orderIds).size !== orderIds.length || new Set(orderedOrderIds).size !== orderedOrderIds.length) {
    return res.status(400).json({ error: 'Há pedidos duplicados no lote.' });
  }
  if (orderIds.some((id) => !orderedOrderIds.includes(id))) {
    return res.status(400).json({ error: 'A ordenação não corresponde aos pedidos selecionados.' });
  }
  if (resolvedStops.some((stop) => !orderIds.includes(stop.id))) {
    return res.status(400).json({ error: 'As coordenadas informadas não correspondem aos pedidos selecionados.' });
  }
  if (!mapsUrl) return res.status(400).json({ error: 'A rota do Google Maps é obrigatória.' });

  try {
    await ensureDeliveryBatchSchema();
    const configuredOrigin = await getConfigValue('restaurantOriginAddress');
    const googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

    if (!googleMapsApiKey) {
      return res.status(400).json({ error: 'GOOGLE_MAPS_API_KEY não configurada no servidor.' });
    }
    if (!configuredOrigin) {
      return res.status(400).json({ error: 'Configure o endereço-base do restaurante antes de preparar a rota.' });
    }
    if (originAddress !== configuredOrigin) {
      return res.status(400).json({ error: 'O endereço-base informado não confere com a configuração atual.' });
    }

    const placeholders = orderIds.map(() => '?').join(', ');
    const [rows] = await db.execute(
      `SELECT id, status, delivery_batch_id
         FROM orders
        WHERE id IN (${placeholders})`,
      orderIds
    );

    if (rows.length !== orderIds.length) {
      return res.status(404).json({ error: 'Um ou mais pedidos do lote não foram encontrados.' });
    }

    const invalid = rows.find((row) => row.status !== 'preparando_rota');
    if (invalid) {
      return res.status(400).json({ error: 'Todos os pedidos precisam estar na coluna Preparando Rota.' });
    }

    const alreadyAssigned = rows.find((row) => row.delivery_batch_id);
    if (alreadyAssigned) {
      return res.status(400).json({ error: 'Há pedidos já vinculados a outro lote ativo.' });
    }

    const conn = await db.raw();
    const publicToken = generatePublicToken();
    const batchCode = await nextBatchCode(conn);

    await conn.exec('BEGIN');
    try {
      const batchResult = await conn.run(
        `INSERT INTO delivery_batches (batch_code, public_token, batch_status, origin_address, maps_url, current_order_id)
         VALUES (?, ?, 'preparado', ?, ?, ?)`,
        [batchCode, publicToken, originAddress, mapsUrl, orderedOrderIds[0] || null]
      );

      const batchId = batchResult.lastID;
      const resolvedMap = new Map(resolvedStops.map((stop) => [stop.id, stop]));
      for (let i = 0; i < orderedOrderIds.length; i++) {
        const resolved = resolvedMap.get(orderedOrderIds[i]);
        await conn.run(
          `UPDATE orders
              SET delivery_batch_id = ?,
                  delivery_sequence = ?,
                  address_lat = COALESCE(?, address_lat),
                  address_lng = COALESCE(?, address_lng),
                  address_geocoded_at = CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN datetime('now') ELSE address_geocoded_at END,
                  updated_at = datetime('now')
            WHERE id = ?`,
          [
            batchId,
            i + 1,
            resolved?.lat ?? null,
            resolved?.lng ?? null,
            resolved?.lat ?? null,
            resolved?.lng ?? null,
            orderedOrderIds[i],
          ]
        );
      }

      await conn.exec('COMMIT');

      notifyClients('delivery-batch-prepared');
      res.json({
        success: true,
        batchId,
        batchCode,
        publicToken,
        publicUrl: `/delivery-batch.html?token=${publicToken}`,
        mapsUrl,
      });
    } catch (innerErr) {
      await conn.exec('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    console.error('Erro ao preparar lote de entrega:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    res.status(500).json({ error: 'Erro ao preparar lote de entrega', detail: err.message });
  }
});

router.post('/public/:token/accept', async (req, res) => {
  const token = String(req.params.token || '').trim();
  const name = String(req.body.name || '').trim();
  const whatsapp = String(req.body.whatsapp || '').trim();
  const cpf = String(req.body.cpf || '').trim();
  const vehicleModel = String(req.body.vehicleModel || '').trim();
  const vehiclePlate = String(req.body.vehiclePlate || '').trim().toUpperCase();

  if (!token || token.length > 64) {
    return res.status(400).json({ error: 'Token de lote inválido.' });
  }
  if (!name || !whatsapp || !cpf || !vehicleModel || !vehiclePlate) {
    return res.status(400).json({ error: 'Preencha todos os dados obrigatórios do motoboy.' });
  }

  try {
    const batch = await loadBatchByToken(token);
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (!VALID_BATCH_STATUSES.includes(batch.batch_status)) {
      return res.status(400).json({ error: 'Lote em estado inválido.' });
    }
    if (batch.batch_status === 'liberado_cozinha') {
      return res.status(400).json({ error: 'Este lote já foi liberado pela cozinha.' });
    }

    const conn = await db.raw();
    await conn.exec('BEGIN');
    try {
      await conn.run(
        `UPDATE delivery_batches
            SET driver_name = ?,
                driver_whatsapp = ?,
                driver_cpf = ?,
                vehicle_model = ?,
                vehicle_plate = ?,
                accepted_at = datetime('now'),
                batch_status = 'aceito_motoboy',
                current_order_id = COALESCE(current_order_id, (
                  SELECT id
                    FROM orders
                   WHERE delivery_batch_id = ?
                   ORDER BY COALESCE(delivery_sequence, 999999) ASC, created_at ASC
                   LIMIT 1
                )),
                updated_at = datetime('now')
          WHERE id = ?`,
        [name, whatsapp, cpf, vehicleModel, vehiclePlate, batch.id, batch.id]
      );

      const session = await issueDriverSession(conn, batch.id);
      await conn.exec('COMMIT');

      notifyClients('delivery-batch-accepted');
      const updated = await loadBatchByToken(token);
      res.json({ success: true, batch: await serializeBatch(updated), ...session });
    } catch (innerErr) {
      await conn.exec('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    console.error('Erro ao registrar aceite do motoboy:', err.message);
    res.status(500).json({ error: 'Erro ao registrar aceite do motoboy' });
  }
});

router.post('/public/:token/session', async (req, res) => {
  const token = String(req.params.token || '').trim();
  const name = normalizeDriverIdentity(req.body.name);
  const whatsapp = normalizePhoneIdentity(req.body.whatsapp);
  const vehiclePlate = normalizePlateIdentity(req.body.vehiclePlate);

  if (!token || token.length > 64) {
    return res.status(400).json({ error: 'Token de lote inválido.' });
  }

  try {
    const batch = await loadBatchByToken(token);
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (!batch.driver_name || !batch.driver_whatsapp || !batch.vehicle_plate) {
      return res.status(400).json({ error: 'Lote ainda não possui motoboy vinculado.' });
    }

    const matchesDriver =
      normalizeDriverIdentity(batch.driver_name) === name &&
      normalizePhoneIdentity(batch.driver_whatsapp) === whatsapp &&
      normalizePlateIdentity(batch.vehicle_plate) === vehiclePlate;

    if (!matchesDriver) {
      return res.status(403).json({ error: 'Os dados informados não conferem com o motoboy vinculado ao lote.' });
    }

    const conn = await db.raw();
    const session = await issueDriverSession(conn, batch.id);
    const updated = await loadBatchByToken(token);
    res.json({ success: true, batch: await serializeBatch(updated), ...session });
  } catch (err) {
    console.error('Erro ao renovar sessão do motoboy:', err.message);
    res.status(500).json({ error: 'Erro ao renovar sessão do motoboy' });
  }
});

router.post('/:id/confirm-kitchen', requireAdmin, async (req, res) => {
  const batchId = parsePositiveId(req.params.id);
  if (!batchId) return res.status(400).json({ error: 'Lote inválido.' });

  try {
    await ensureDeliveryBatchSchema();
    const [rows] = await db.execute(
      `SELECT id, batch_code, public_token, batch_status
         FROM delivery_batches
        WHERE id = ?`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (batch.batch_status !== 'aceito_motoboy') {
      return res.status(400).json({ error: 'O lote precisa ser aceito pelo motoboy antes da liberação da cozinha.' });
    }

    const orders = await loadBatchOrders(batchId);
    if (!orders.length) {
      return res.status(400).json({ error: 'O lote não possui pedidos válidos.' });
    }

    const invalidOrder = orders.find((order) => ['entregue', 'cancelado'].includes(order.status));
    if (invalidOrder) {
      return res.status(400).json({ error: 'Há pedidos finalizados nesse lote; revise antes de liberar.' });
    }

    const conn = await db.raw();
    await conn.exec('BEGIN');
    try {
      await conn.run(
        `UPDATE delivery_batches
            SET batch_status = 'liberado_cozinha',
                kitchen_confirmed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
        [batchId]
      );

      for (const order of orders) {
        await conn.run(
          `UPDATE orders
              SET status = 'a_caminho',
                  updated_at = datetime('now')
            WHERE id = ?`,
          [order.id]
        );
      }

      await conn.exec('COMMIT');
      notifyClients('delivery-batch-released');
      notifyClients('order-status-changed');
      const updated = await loadBatchByToken(batch.public_token);
      res.json({ success: true, batch: await serializeBatch(updated) });
    } catch (innerErr) {
      await conn.exec('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    console.error('Erro ao confirmar saída do lote:', err.message);
    res.status(500).json({ error: 'Erro ao confirmar saída do lote' });
  }
});

router.get('/public/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length > 64) {
    return res.status(400).json({ error: 'Token de lote inválido.' });
  }

  try {
    const batch = await loadBatchByToken(token);
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    res.json(await serializeBatch(batch));
  } catch (err) {
    console.error('Erro ao carregar lote público:', err.message);
    res.status(500).json({ error: 'Erro ao carregar lote' });
  }
});

router.patch('/public/:token/current-stop', async (req, res) => {
  const token = String(req.params.token || '').trim();
  const orderId = parsePositiveId(req.body.orderId);

  if (!token || token.length > 64) {
    return res.status(400).json({ error: 'Token de lote inválido.' });
  }
  if (!orderId) {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }

  try {
    const session = await requireDriverSession(req, token);
    if (session.error) {
      return res.status(session.error.status).json(session.error.body);
    }

    const batch = session.batch;
    const order = await loadBatchOrderById(batch.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não pertence a este lote.' });
    }
    if (!isRouteEligible(order)) {
      return res.status(400).json({ error: 'A parada informada não está disponível como próxima entrega do motoboy.' });
    }

    await db.execute(
      `UPDATE delivery_batches
          SET current_order_id = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [orderId, batch.id]
    );

    const updated = await loadBatchByToken(token);
    const serialized = await serializeBatch(updated);
    res.json({ success: true, currentOrderId: serialized.currentOrderId, batch: serialized });
  } catch (err) {
    console.error('Erro ao atualizar parada atual do lote:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar parada atual do lote' });
  }
});

router.patch('/public/:token/orders/:orderId/status', async (req, res) => {
  const token = String(req.params.token || '').trim();
  const orderId = parsePositiveId(req.params.orderId);
  const action = String(req.body.action || '').trim().toLowerCase();
  const reason = normalizeFailureReason(req.body.reason);
  const note = String(req.body.note || '').trim().slice(0, 280);
  const shouldAdvance = req.body.advance !== false;

  if (!token || token.length > 64) {
    return res.status(400).json({ error: 'Token de lote inválido.' });
  }
  if (!orderId) {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
  if (!['delivered', 'failed'].includes(action)) {
    return res.status(400).json({ error: 'Ação de status inválida.' });
  }
  if (action === 'failed' && !reason) {
    return res.status(400).json({ error: 'Informe o motivo da não entrega.' });
  }

  try {
    const session = await requireDriverSession(req, token);
    if (session.error) {
      return res.status(session.error.status).json(session.error.body);
    }

    const batch = session.batch;
    if (!['aceito_motoboy', 'liberado_cozinha'].includes(batch.batch_status)) {
      return res.status(400).json({ error: 'Lote não está disponível para atualização operacional.' });
    }

    const order = await loadBatchOrderById(batch.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não pertence a este lote.' });
    }
    if (order.status === 'cancelado') {
      return res.status(400).json({ error: 'Pedido cancelado não pode ser atualizado pelo motoboy.' });
    }

    const actorName = batch.driver_name || '';
    const conn = await db.raw();
    await conn.exec('BEGIN');
    try {
      if (action === 'delivered') {
        if (order.status !== 'entregue') {
          await conn.run(
            `UPDATE orders
                SET status = 'entregue',
                    delivered_at = datetime('now'),
                    delivery_failed_reason = '',
                    delivery_failed_note = '',
                    delivery_attempted_at = NULL,
                    delivery_actor_name = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [actorName, orderId]
          );
        }
      } else {
        const alreadySameFailure =
          order.status === 'a_caminho' &&
          order.delivery_failed_reason === reason &&
          order.delivery_failed_note === note &&
          Boolean(order.delivery_attempted_at);

        if (!alreadySameFailure) {
          await conn.run(
            `UPDATE orders
                SET status = 'a_caminho',
                    delivery_failed_reason = ?,
                    delivery_failed_note = ?,
                    delivery_attempted_at = datetime('now'),
                    delivered_at = NULL,
                    delivery_actor_name = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [reason, note, actorName, orderId]
          );
        }
      }

      const nextOrderId = shouldAdvance ? await nextOpenOrderId(conn, batch.id, orderId) : orderId;
      await conn.run(
        `UPDATE delivery_batches
            SET current_order_id = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [nextOrderId, batch.id]
      );

      await conn.exec('COMMIT');
      notifyClients('order-status-changed');
      const updated = await loadBatchByToken(token);
      const serialized = await serializeBatch(updated);
      res.json({
        success: true,
        action,
        currentOrderId: serialized.currentOrderId,
        batch: serialized,
      });
    } catch (innerErr) {
      await conn.exec('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    console.error('Erro ao atualizar status operacional do pedido:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar status operacional do pedido' });
  }
});

router.get('/:id', requireAdmin, async (req, res) => {
  const batchId = parsePositiveId(req.params.id);
  if (!batchId) return res.status(400).json({ error: 'Lote inválido.' });

  try {
    await ensureDeliveryBatchSchema();
    const [rows] = await db.execute(
      `SELECT id, batch_code, public_token, batch_status, origin_address, maps_url,
              driver_name, driver_whatsapp, driver_cpf, vehicle_model, vehicle_plate,
              accepted_at, kitchen_confirmed_at, created_at, updated_at
         FROM delivery_batches
        WHERE id = ?`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    res.json(await serializeBatch(batch));
  } catch (err) {
    console.error('Erro ao consultar lote:', err.message);
    res.status(500).json({ error: 'Erro ao consultar lote' });
  }
});

module.exports = router;
