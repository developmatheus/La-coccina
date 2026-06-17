const express = require('express');
const crypto = require('crypto');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notifyClients } = require('../menuEvents');
const { parsePositiveId } = require('../utils/sanitize');

const router = express.Router();

const VALID_BATCH_STATUSES = ['preparado', 'aceito_motoboy', 'liberado_cozinha'];
const DRIVER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DRIVER_NO_ACTIVE_VISIBILITY_GRACE_MS = 2 * 60 * 1000;
const DRIVER_VISIBILITY_EXTENSION_MS = 10 * 60 * 1000;
const DRIVER_FAILURE_REASONS = new Set(['cliente_ausente', 'endereco_incorreto', 'pedido_cancelado', 'outro']);
const FOLLOWUP_STATES = new Set(['delayed', 'cancelled']);

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
  await ensureColumn(conn, 'orders', 'delivery_followup_state', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'orders', 'delivery_followup_updated_at', 'TEXT');
  await ensureColumn(conn, 'delivery_batches', 'current_order_id', 'INTEGER');
  await ensureColumn(conn, 'delivery_batches', 'driver_session_token', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'delivery_batches', 'driver_session_expires_at', 'TEXT');
  await ensureColumn(conn, 'delivery_batches', 'delivery_visibility_grace_started_at', 'TEXT');
  await ensureColumn(conn, 'delivery_batches', 'driver_visibility_extension_requested_at', 'TEXT');
  await ensureColumn(conn, 'delivery_batches', 'driver_visibility_extension_authorized_at', 'TEXT');
  await ensureColumn(conn, 'delivery_batches', 'driver_visibility_extension_expires_at', 'TEXT');

  await conn.exec(`
    CREATE TABLE IF NOT EXISTS delivery_attempt_logs (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id              INTEGER NOT NULL,
      delivery_batch_id     INTEGER,
      attempt_action        TEXT NOT NULL DEFAULT '',
      order_status_before   TEXT NOT NULL DEFAULT '',
      order_status_after    TEXT NOT NULL DEFAULT '',
      followup_state_before TEXT NOT NULL DEFAULT '',
      followup_state_after  TEXT NOT NULL DEFAULT '',
      actor_name            TEXT NOT NULL DEFAULT '',
      reason                TEXT NOT NULL DEFAULT '',
      note                  TEXT NOT NULL DEFAULT '',
      customer_name         TEXT NOT NULL DEFAULT '',
      address               TEXT NOT NULL DEFAULT '',
      phone                 TEXT NOT NULL DEFAULT '',
      payment_method        TEXT NOT NULL DEFAULT '',
      order_total           REAL NOT NULL DEFAULT 0,
      delivery_sequence     INTEGER,
      attempted_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_batches_public_token ON delivery_batches(public_token);
    CREATE INDEX IF NOT EXISTS idx_delivery_batches_status ON delivery_batches(batch_status);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_batch_id ON orders(delivery_batch_id);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_sequence ON orders(delivery_sequence);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_followup_state ON orders(delivery_followup_state);
    CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_order ON delivery_attempt_logs(order_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_batch ON delivery_attempt_logs(delivery_batch_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_attempted_at ON delivery_attempt_logs(attempted_at);
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

function toFutureIso(ms) {
  return new Date(Date.now() + Math.max(0, Number(ms) || 0)).toISOString();
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

function normalizeFailureMode(value) {
  return value === 'cancelled' ? 'cancelled' : 'delayed';
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

async function getDriverCancellationMode() {
  const value = await getConfigValue('driverCancellationMode');
  return value === 'admin_confirmation' ? 'admin_confirmation' : 'auto';
}

async function getDeliveryManagementEnabled() {
  const value = String(await getConfigValue('deliveryManagementEnabled') || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

async function getShowRouteProviderPicker() {
  const value = String(await getConfigValue('showRouteProviderPicker') || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

async function getShowDriverCallButton() {
  const value = String(await getConfigValue('showDriverCallButton') || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

async function loadBatchByToken(token) {
  await ensureDeliveryBatchSchema();
  const [rows] = await db.execute(
    `SELECT id, batch_code, public_token, batch_status, origin_address, maps_url,
            driver_name, driver_whatsapp, driver_cpf, vehicle_model, vehicle_plate,
            accepted_at, kitchen_confirmed_at, created_at, updated_at,
            current_order_id, driver_session_token, driver_session_expires_at,
            delivery_visibility_grace_started_at,
            driver_visibility_extension_requested_at,
            driver_visibility_extension_authorized_at,
            driver_visibility_extension_expires_at
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
            delivered_at, delivery_attempted_at, delivery_actor_name,
            delivery_followup_state, delivery_followup_updated_at
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
    deliveryFollowupState: row.delivery_followup_state,
    deliveryFollowupUpdatedAt: row.delivery_followup_updated_at,
    deliveryFailed: Boolean(row.delivery_failed_reason || row.delivery_failed_note || row.delivery_attempted_at),
  }));
}

async function loadAttemptLogsForBatch(batchId) {
  const [rows] = await db.execute(
    `SELECT id, order_id, delivery_batch_id, attempt_action,
            order_status_before, order_status_after,
            followup_state_before, followup_state_after,
            actor_name, reason, note, customer_name, address,
            phone, payment_method, order_total, delivery_sequence,
            attempted_at
       FROM delivery_attempt_logs
      WHERE delivery_batch_id = ?
      ORDER BY datetime(attempted_at) DESC, id DESC`,
    [batchId]
  );
  return rows;
}

function groupAttemptLogsByOrder(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const orderId = Number(row.order_id);
    if (!map.has(orderId)) {
      map.set(orderId, []);
    }
    map.get(orderId).push({
      id: Number(row.id),
      action: row.attempt_action,
      orderStatusBefore: row.order_status_before,
      orderStatusAfter: row.order_status_after,
      followupStateBefore: row.followup_state_before,
      followupStateAfter: row.followup_state_after,
      actorName: row.actor_name,
      reason: row.reason,
      note: row.note,
      customerName: row.customer_name,
      address: row.address,
      phone: row.phone,
      paymentMethod: row.payment_method,
      orderTotal: Number(row.order_total || 0),
      deliverySequence: row.delivery_sequence,
      attemptedAt: row.attempted_at,
    });
  }
  return map;
}

function sortBatchOrders(orders) {
  return (orders || []).slice().sort((left, right) => {
    const seqDiff = (left.delivery_sequence || 999999) - (right.delivery_sequence || 999999);
    if (seqDiff) return seqDiff;
    return new Date(`${left.created_at || ''}Z`).getTime() - new Date(`${right.created_at || ''}Z`).getTime();
  });
}

function getFollowupState(order) {
  const explicitState = String(order?.deliveryFollowupState ?? order?.delivery_followup_state ?? '').trim().toLowerCase();
  if (FOLLOWUP_STATES.has(explicitState)) return explicitState;
  if ((order?.status || '') === 'cancelado') return 'cancelled';
  if (
    order?.deliveryFailed ||
    order?.delivery_failed_reason ||
    order?.delivery_failed_note ||
    order?.delivery_attempted_at ||
    order?.deliveryAttemptedAt
  ) {
    return 'delayed';
  }
  return '';
}

function isDeferredOrder(order) {
  return FOLLOWUP_STATES.has(getFollowupState(order));
}

function isRouteEligible(order) {
  if (!order) return false;
  if (order.status === 'entregue' || order.status === 'cancelado') return false;
  if (isDeferredOrder(order)) return false;
  return true;
}

function isSelectableCurrentStop(order) {
  if (!order) return false;
  if (order.status === 'entregue') return false;
  return true;
}

function serializeRouteStop(order, attemptHistory = []) {
  if (!order) return null;
  const lat = Number(order.addressLat ?? order.address_lat);
  const lng = Number(order.addressLng ?? order.address_lng);
  return {
    orderId: Number(order.id),
    sequence: order.delivery_sequence ?? null,
    customerName: order.customer || '',
    address: order.address || '',
    address_lat: hasUsableCoords(lat, lng) ? lat : null,
    address_lng: hasUsableCoords(lat, lng) ? lng : null,
    phone: order.phone || '',
    status: order.status || '',
    followupState: getFollowupState(order),
  };
}

function hasUsableCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lat) > 0.000001 || Math.abs(lng) > 0.000001;
}

function buildStopLocation(stop) {
  if (!stop) return '';
  const lat = Number(stop.address_lat);
  const lng = Number(stop.address_lng);
  if (hasUsableCoords(lat, lng)) {
    return `${lat},${lng}`;
  }
  return encodeURIComponent(stop.address || '');
}

function buildGoogleMapsCurrentUrl(stop) {
  if (!stop) return '';
  const lat = Number(stop.address_lat);
  const lng = Number(stop.address_lng);
  if (hasUsableCoords(lat, lng)) {
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
  if (hasUsableCoords(lat, lng)) {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  if (!stop.address) return '';
  return `https://waze.com/ul?q=${encodeURIComponent(stop.address)}&navigate=yes`;
}

function getRouteWindow(batchOrders, currentOrderId, attemptMap = new Map(), limit = Number.MAX_SAFE_INTEGER) {
  const ordered = sortBatchOrders(batchOrders);
  const eligible = ordered.filter(isRouteEligible);
  const deferredOrders = ordered.filter(isDeferredOrder);
  const availableOrders = ordered.filter((order) => isSelectableCurrentStop(order));
  if (!eligible.length) {
    const deferredStops = deferredOrders
      .map((order) => serializeRouteStop(order, attemptMap.get(Number(order.id)) || []))
      .filter(Boolean);
    return {
      currentOrderId: null,
      currentStop: null,
      nextStops: [],
      routeWindow: [],
      deferredStops,
      links: {
        googleMapsCurrent: '',
        googleMapsWindow: '',
        wazeCurrent: '',
      },
    };
  }

  const normalizedCurrentId = Number(currentOrderId) || null;
  let currentOrder = normalizedCurrentId
    ? availableOrders.find((order) => Number(order.id) === normalizedCurrentId)
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
  const nextOrders = currentIndex >= 0
    ? eligible.slice(currentIndex + 1, currentIndex + 1 + Math.max(0, Number(limit) || 3))
    : eligible.slice(0, Math.max(0, Number(limit) || 3));
  const routeWindow = [currentOrder, ...nextOrders]
    .map((order) => serializeRouteStop(order, attemptMap.get(Number(order.id)) || []))
    .filter(Boolean);
  const currentStop = routeWindow[0] || null;
  const deferredStops = deferredOrders
    .map((order) => serializeRouteStop(order, attemptMap.get(Number(order.id)) || []))
    .filter(Boolean);

  return {
    currentOrderId: currentStop?.orderId || null,
    currentStop,
    nextStops: routeWindow.slice(1),
    routeWindow,
    deferredStops,
    links: {
      googleMapsCurrent: buildGoogleMapsCurrentUrl(currentStop),
      googleMapsWindow: buildGoogleMapsWindowUrl(routeWindow),
      wazeCurrent: buildWazeCurrentUrl(currentStop),
    },
  };
}

function serializePublicOrder(order) {
  const lat = Number(order.addressLat ?? order.address_lat);
  const lng = Number(order.addressLng ?? order.address_lng);
  return {
    id: Number(order.id),
    customer: order.customer || '',
    address: order.address || '',
    phone: order.phone || '',
    status: order.status || '',
    delivery_sequence: order.delivery_sequence ?? null,
    addressLat: hasUsableCoords(lat, lng) ? lat : null,
    addressLng: hasUsableCoords(lat, lng) ? lng : null,
    deliveryFollowupState: getFollowupState(order),
  };
}

function parseTimestamp(value) {
  if (!value) return 0;
  const normalized = String(value).includes('Z') ? String(value) : `${String(value)}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildVisibilityControl(batch, routeWindow) {
  const hasActiveDelivery = batch?.batch_status === 'liberado_cozinha' && Boolean(routeWindow?.currentStop);
  const requestedAt = batch?.driver_visibility_extension_requested_at || null;
  const authorizedAt = batch?.driver_visibility_extension_authorized_at || null;
  const extensionExpiresAt = batch?.driver_visibility_extension_expires_at || null;
  const graceStartedAt = batch?.delivery_visibility_grace_started_at || null;
  const extensionExpiresTs = parseTimestamp(extensionExpiresAt);
  const graceStartsTs = parseTimestamp(graceStartedAt);
  const graceExpiresTs = graceStartsTs ? (graceStartsTs + DRIVER_NO_ACTIVE_VISIBILITY_GRACE_MS) : 0;
  const now = Date.now();

  if (batch?.batch_status !== 'liberado_cozinha') {
    return {
      hasActiveDelivery: false,
      isVisible: false,
      visibilityMode: 'pre_release',
      visibleUntil: null,
      restrictedReason: 'A visualização de clientes só é liberada quando a cozinha libera a rota.',
      extensionRequestedAt: requestedAt,
      extensionAuthorizedAt: authorizedAt,
      extensionExpiresAt,
      canRequestExtension: false,
      hasPendingExtensionRequest: Boolean(requestedAt),
    };
  }

  if (hasActiveDelivery) {
    return {
      hasActiveDelivery: true,
      isVisible: true,
      visibilityMode: 'active',
      visibleUntil: null,
      restrictedReason: '',
      extensionRequestedAt: null,
      extensionAuthorizedAt: null,
      extensionExpiresAt: null,
      canRequestExtension: false,
      hasPendingExtensionRequest: false,
    };
  }

  if (extensionExpiresTs > now) {
    return {
      hasActiveDelivery: false,
      isVisible: true,
      visibilityMode: 'extended',
      visibleUntil: new Date(extensionExpiresTs).toISOString(),
      restrictedReason: '',
      extensionRequestedAt: requestedAt,
      extensionAuthorizedAt: authorizedAt,
      extensionExpiresAt: new Date(extensionExpiresTs).toISOString(),
      canRequestExtension: false,
      hasPendingExtensionRequest: false,
    };
  }

  if (graceExpiresTs > now) {
    return {
      hasActiveDelivery: false,
      isVisible: true,
      visibilityMode: 'grace',
      visibleUntil: new Date(graceExpiresTs).toISOString(),
      restrictedReason: '',
      extensionRequestedAt: requestedAt,
      extensionAuthorizedAt: authorizedAt,
      extensionExpiresAt,
      canRequestExtension: !requestedAt,
      hasPendingExtensionRequest: Boolean(requestedAt),
    };
  }

  return {
    hasActiveDelivery: false,
    isVisible: false,
    visibilityMode: 'restricted',
    visibleUntil: null,
    restrictedReason: requestedAt
      ? 'A visualização foi bloqueada. O pedido de extensão aguarda autorização do restaurante.'
      : 'Sem entrega ativa. A visualização dos dados foi bloqueada para atender à LGPD.',
    extensionRequestedAt: requestedAt,
    extensionAuthorizedAt: authorizedAt,
    extensionExpiresAt,
    canRequestExtension: !requestedAt,
    hasPendingExtensionRequest: Boolean(requestedAt),
  };
}

async function recomputeBatchVisibilityState(conn, batchId, preferredCurrentOrderId = null) {
  const batch = await conn.get(
    `SELECT id, batch_status, current_order_id, delivery_visibility_grace_started_at
       FROM delivery_batches
      WHERE id = ?`,
    [batchId]
  );
  if (!batch) return null;

  const orders = await conn.all(
    `SELECT id, status, delivery_sequence, created_at,
            delivery_failed_reason, delivery_failed_note, delivery_attempted_at,
            delivery_followup_state
       FROM orders
      WHERE delivery_batch_id = ?
      ORDER BY COALESCE(delivery_sequence, 999999) ASC, created_at ASC`,
    [batchId]
  );
  const routeWindow = getRouteWindow(orders, preferredCurrentOrderId ?? batch.current_order_id, new Map());
  const hasActiveDelivery = batch.batch_status === 'liberado_cozinha' && Boolean(routeWindow.currentStop);

  if (hasActiveDelivery) {
    await conn.run(
      `UPDATE delivery_batches
          SET current_order_id = ?,
              delivery_visibility_grace_started_at = NULL,
              driver_visibility_extension_requested_at = NULL,
              driver_visibility_extension_authorized_at = NULL,
              driver_visibility_extension_expires_at = NULL,
              updated_at = datetime('now')
        WHERE id = ?`,
      [routeWindow.currentOrderId, batchId]
    );
    return routeWindow.currentOrderId;
  }

  if (batch.batch_status === 'liberado_cozinha') {
    await conn.run(
      `UPDATE delivery_batches
          SET current_order_id = NULL,
              delivery_visibility_grace_started_at = COALESCE(delivery_visibility_grace_started_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ?`,
      [batchId]
    );
    return null;
  }

  await conn.run(
    `UPDATE delivery_batches
        SET current_order_id = ?,
            delivery_visibility_grace_started_at = NULL,
            driver_visibility_extension_requested_at = NULL,
            driver_visibility_extension_authorized_at = NULL,
            driver_visibility_extension_expires_at = NULL,
            updated_at = datetime('now')
      WHERE id = ?`,
    [routeWindow.currentOrderId, batchId]
  );
  return routeWindow.currentOrderId;
}

async function serializeBatch(batch) {
  const orders = await loadBatchOrders(batch.id);
  const attemptMap = groupAttemptLogsByOrder(await loadAttemptLogsForBatch(batch.id));
  const routeWindow = getRouteWindow(orders, batch.current_order_id, attemptMap);
  const driverCancellationMode = await getDriverCancellationMode();
  const deliveryManagementEnabled = await getDeliveryManagementEnabled();
  const showRouteProviderPicker = await getShowRouteProviderPicker();
  const showDriverCallButton = await getShowDriverCallButton();
  const visibility = buildVisibilityControl(batch, routeWindow);
  const stopCount = orders.length;
  const deliveredCount = orders.filter((order) => order.status === 'entregue').length;
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
    stopCount,
    deliveredCount,
    currentStop: routeWindow.currentStop,
    nextStops: routeWindow.nextStops,
    routeWindow: routeWindow.routeWindow,
    deferredStops: routeWindow.deferredStops,
    links: routeWindow.links,
    operationConfig: {
      driverCancellationMode,
      deliveryManagementEnabled,
      showRouteProviderPicker,
      showDriverCallButton,
    },
    visibilityControl: visibility,
    orders,
  };
}

async function serializePublicBatch(batch) {
  const orders = await loadBatchOrders(batch.id);
  const attemptMap = groupAttemptLogsByOrder(await loadAttemptLogsForBatch(batch.id));
  const routeWindow = getRouteWindow(orders, batch.current_order_id, attemptMap);
  const driverCancellationMode = await getDriverCancellationMode();
  const deliveryManagementEnabled = await getDeliveryManagementEnabled();
  const showRouteProviderPicker = await getShowRouteProviderPicker();
  const showDriverCallButton = await getShowDriverCallButton();
  const visibility = buildVisibilityControl(batch, routeWindow);
  const canExposeCustomerData = deliveryManagementEnabled && visibility.isVisible;
  const stopCount = orders.length;
  const deliveredCount = orders.filter((order) => order.status === 'entregue').length;
  const visibleRouteWindow = canExposeCustomerData ? routeWindow : {
    currentOrderId: null,
    currentStop: null,
    nextStops: [],
    routeWindow: [],
    deferredStops: [],
    links: {
      googleMapsCurrent: '',
      googleMapsWindow: '',
      wazeCurrent: '',
    },
  };

  return {
    id: batch.id,
    batchCode: batch.batch_code,
    publicToken: batch.public_token,
    batchStatus: batch.batch_status,
    originAddress: batch.origin_address,
    driver: {
      name: batch.driver_name,
      whatsapp: batch.driver_whatsapp,
      vehiclePlate: batch.vehicle_plate,
    },
    acceptedAt: batch.accepted_at,
    kitchenConfirmedAt: batch.kitchen_confirmed_at,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    stopCount,
    deliveredCount,
    currentOrderId: visibleRouteWindow.currentOrderId,
    currentStop: visibleRouteWindow.currentStop,
    nextStops: visibleRouteWindow.nextStops,
    routeWindow: visibleRouteWindow.routeWindow,
    deferredStops: visibleRouteWindow.deferredStops,
    links: visibleRouteWindow.links,
    operationConfig: {
      driverCancellationMode,
      deliveryManagementEnabled,
      showRouteProviderPicker,
      showDriverCallButton,
    },
    privacy: visibility,
    orders: canExposeCustomerData ? orders.map(serializePublicOrder) : [],
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
    `SELECT id, customer, address, phone, payment, total, obs, status, delivery_sequence,
            created_at, updated_at, delivery_failed_reason, delivery_failed_note,
            delivered_at, delivery_attempted_at, delivery_actor_name,
            delivery_followup_state, delivery_followup_updated_at
       FROM orders
      WHERE delivery_batch_id = ? AND id = ?`,
    [batchId, orderId]
  );
  return rows[0] || null;
}

async function nextOpenOrderId(conn, batchId, currentOrderId) {
  const rows = await conn.all(
    `SELECT id, status, delivery_sequence, created_at,
            delivery_failed_reason, delivery_failed_note, delivery_attempted_at,
            delivery_followup_state
       FROM orders
      WHERE delivery_batch_id = ?
      ORDER BY COALESCE(delivery_sequence, 999999) ASC, created_at ASC`,
    [batchId]
  );

  return getRouteWindow(rows, currentOrderId, new Map()).currentOrderId || null;
}

async function insertAttemptLog(conn, { order, batchId, action, actorName, reason, note, nextStatus, nextFollowupState }) {
  const beforeStatus = String(order.status || '');
  const beforeFollowupState = getFollowupState(order);
  await conn.run(
    `INSERT INTO delivery_attempt_logs (
        order_id, delivery_batch_id, attempt_action,
        order_status_before, order_status_after,
        followup_state_before, followup_state_after,
        actor_name, reason, note, customer_name,
        address, phone, payment_method, order_total,
        delivery_sequence, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      Number(order.id),
      batchId ? Number(batchId) : null,
      action,
      beforeStatus,
      nextStatus,
      beforeFollowupState,
      nextFollowupState,
      actorName || '',
      reason || '',
      note || '',
      order.customer || '',
      order.address || '',
      order.phone || '',
      order.payment || '',
      Number(order.total || 0),
      order.delivery_sequence ?? null,
    ]
  );
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
    const deliveryManagementEnabled = await getDeliveryManagementEnabled();
    if (!deliveryManagementEnabled) {
      return res.status(409).json({ error: 'A gestão de entrega está inativa no administrativo.' });
    }
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
    const deliveryManagementEnabled = await getDeliveryManagementEnabled();
    if (!deliveryManagementEnabled) {
      return res.status(409).json({ error: 'A gestão de entrega está inativa no administrativo.' });
    }
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
                delivery_visibility_grace_started_at = NULL,
                driver_visibility_extension_requested_at = NULL,
                driver_visibility_extension_authorized_at = NULL,
                driver_visibility_extension_expires_at = NULL,
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
      res.json({ success: true, batch: await serializePublicBatch(updated), ...session });
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
    const deliveryManagementEnabled = await getDeliveryManagementEnabled();
    if (!deliveryManagementEnabled) {
      return res.status(409).json({ error: 'A gestão de entrega está inativa no administrativo.' });
    }
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
    res.json({ success: true, batch: await serializePublicBatch(updated), ...session });
  } catch (err) {
    console.error('Erro ao renovar sessão do motoboy:', err.message);
    res.status(500).json({ error: 'Erro ao renovar sessão do motoboy' });
  }
});

router.post('/:id/confirm-kitchen', requireAdmin, async (req, res) => {
  const batchId = parsePositiveId(req.params.id);
  if (!batchId) return res.status(400).json({ error: 'Lote inválido.' });

  try {
    const deliveryManagementEnabled = await getDeliveryManagementEnabled();
    if (!deliveryManagementEnabled) {
      return res.status(409).json({ error: 'A gestão de entrega está inativa no administrativo.' });
    }
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
                delivery_visibility_grace_started_at = NULL,
                driver_visibility_extension_requested_at = NULL,
                driver_visibility_extension_authorized_at = NULL,
                driver_visibility_extension_expires_at = NULL,
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

      await recomputeBatchVisibilityState(conn, batchId);

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
    const deliveryManagementEnabled = await getDeliveryManagementEnabled();
    if (!deliveryManagementEnabled) {
      return res.status(409).json({ error: 'A gestão de entrega está inativa no administrativo.' });
    }
    const batch = await loadBatchByToken(token);
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    res.json(await serializePublicBatch(batch));
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
    const deliveryManagementEnabled = await getDeliveryManagementEnabled();
    if (!deliveryManagementEnabled) {
      return res.status(409).json({ error: 'A gestão de entrega está inativa no administrativo.' });
    }
    const session = await requireDriverSession(req, token);
    if (session.error) {
      return res.status(session.error.status).json(session.error.body);
    }

    const batch = session.batch;
    const visibility = buildVisibilityControl(batch, getRouteWindow(await loadBatchOrders(batch.id), batch.current_order_id, new Map()));
    if (!visibility.isVisible) {
      return res.status(403).json({ error: visibility.restrictedReason || 'Visualização de dados bloqueada no momento.' });
    }
    const order = await loadBatchOrderById(batch.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não pertence a este lote.' });
    }
    if (!isSelectableCurrentStop(order)) {
      return res.status(400).json({ error: 'A parada informada não está disponível para seleção.' });
    }

    const conn = await db.raw();
    await conn.exec('BEGIN');
    try {
      const followupState = getFollowupState(order);
      if (followupState) {
        const nextStatus = order.status === 'cancelado' ? 'a_caminho' : order.status;
        await conn.run(
          `UPDATE orders
              SET status = ?,
                  delivery_followup_state = '',
                  delivery_followup_updated_at = datetime('now'),
                  delivery_failed_reason = '',
                  delivery_failed_note = '',
                  delivery_attempted_at = NULL,
                  delivered_at = NULL,
                  updated_at = datetime('now')
            WHERE id = ?`,
          [nextStatus, orderId]
        );
        await insertAttemptLog(conn, {
          order,
          batchId: batch.id,
          action: 'reopened',
          actorName: batch.driver_name || '',
          reason: '',
          note: '',
          nextStatus,
          nextFollowupState: '',
        });
      }

      await conn.run(
        `UPDATE delivery_batches
            SET current_order_id = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [orderId, batch.id]
      );
      await recomputeBatchVisibilityState(conn, batch.id, orderId);

      await conn.exec('COMMIT');
    } catch (innerErr) {
      await conn.exec('ROLLBACK');
      throw innerErr;
    }

    const updated = await loadBatchByToken(token);
    const serialized = await serializePublicBatch(updated);
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
  const failureMode = normalizeFailureMode(req.body.failureMode);
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
    const visibility = buildVisibilityControl(batch, getRouteWindow(await loadBatchOrders(batch.id), batch.current_order_id, new Map()));
    if (!visibility.isVisible) {
      return res.status(403).json({ error: visibility.restrictedReason || 'Visualização de dados bloqueada no momento.' });
    }

    const order = await loadBatchOrderById(batch.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não pertence a este lote.' });
    }
    const actorName = batch.driver_name || '';
    const driverCancellationMode = await getDriverCancellationMode();
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
                    delivery_followup_state = '',
                    delivery_followup_updated_at = datetime('now'),
                    delivery_actor_name = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [actorName, orderId]
          );
          await insertAttemptLog(conn, {
            order,
            batchId: batch.id,
            action: 'delivered',
            actorName,
            reason: '',
            note,
            nextStatus: 'entregue',
            nextFollowupState: '',
          });
        }
      } else {
        const effectiveNote =
          failureMode === 'cancelled' && driverCancellationMode === 'admin_confirmation'
            ? ['Cancelamento pendente de confirmação do admin.', note].filter(Boolean).join(' ')
            : note;
        const alreadySameFailure =
          order.status === 'a_caminho' &&
          order.delivery_failed_reason === reason &&
          order.delivery_failed_note === effectiveNote &&
          Boolean(order.delivery_attempted_at);

        if (!alreadySameFailure) {
          const nextStatus = failureMode === 'cancelled' && driverCancellationMode === 'auto'
            ? 'cancelado'
            : 'a_caminho';
          const nextFollowupState = failureMode === 'cancelled' && driverCancellationMode === 'auto'
            ? 'cancelled'
            : 'delayed';
          await conn.run(
            `UPDATE orders
                SET status = ?,
                    delivery_failed_reason = ?,
                    delivery_failed_note = ?,
                    delivery_attempted_at = datetime('now'),
                    delivered_at = NULL,
                    delivery_followup_state = ?,
                    delivery_followup_updated_at = datetime('now'),
                    delivery_actor_name = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [nextStatus, reason, effectiveNote, nextFollowupState, actorName, orderId]
          );
          await insertAttemptLog(conn, {
            order,
            batchId: batch.id,
            action: nextFollowupState === 'cancelled' ? 'cancelled' : 'delayed',
            actorName,
            reason,
            note: effectiveNote,
            nextStatus,
            nextFollowupState,
          });
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
      await recomputeBatchVisibilityState(conn, batch.id, nextOrderId);

      await conn.exec('COMMIT');
      notifyClients('order-status-changed');
      const updated = await loadBatchByToken(token);
      const serialized = await serializePublicBatch(updated);
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

router.post('/public/:token/request-visibility-extension', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length > 64) {
    return res.status(400).json({ error: 'Token de lote inválido.' });
  }

  try {
    const session = await requireDriverSession(req, token);
    if (session.error) {
      return res.status(session.error.status).json(session.error.body);
    }

    const batch = session.batch;
    const routeWindow = getRouteWindow(await loadBatchOrders(batch.id), batch.current_order_id, new Map());
    const visibility = buildVisibilityControl(batch, routeWindow);
    if (visibility.hasActiveDelivery) {
      return res.status(400).json({ error: 'Há entrega ativa no lote. A extensão só pode ser pedida quando a rota estiver sem parada atual.' });
    }
    if (batch.batch_status !== 'liberado_cozinha') {
      return res.status(400).json({ error: 'A extensão só pode ser pedida após a liberação da cozinha.' });
    }
    if (visibility.extensionExpiresAt && parseTimestamp(visibility.extensionExpiresAt) > Date.now()) {
      const updated = await loadBatchByToken(token);
      return res.json({ success: true, alreadyExtended: true, batch: await serializePublicBatch(updated) });
    }
    if (visibility.hasPendingExtensionRequest) {
      const updated = await loadBatchByToken(token);
      return res.json({ success: true, alreadyRequested: true, batch: await serializePublicBatch(updated) });
    }

    const conn = await db.raw();
    await conn.run(
      `UPDATE delivery_batches
          SET driver_visibility_extension_requested_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
      [batch.id]
    );
    notifyClients('delivery-batch-visibility-requested');
    const updated = await loadBatchByToken(token);
    res.json({ success: true, requested: true, batch: await serializePublicBatch(updated) });
  } catch (err) {
    console.error('Erro ao solicitar extensão de visibilidade:', err.message);
    res.status(500).json({ error: 'Erro ao solicitar extensão de visibilidade' });
  }
});

router.post('/:id/approve-visibility-extension', requireAdmin, async (req, res) => {
  const batchId = parsePositiveId(req.params.id);
  if (!batchId) return res.status(400).json({ error: 'Lote inválido.' });

  try {
    await ensureDeliveryBatchSchema();
    const [rows] = await db.execute(
      `SELECT id, public_token, batch_status, current_order_id,
              delivery_visibility_grace_started_at,
              driver_visibility_extension_requested_at,
              driver_visibility_extension_authorized_at,
              driver_visibility_extension_expires_at
         FROM delivery_batches
        WHERE id = ?`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (batch.batch_status !== 'liberado_cozinha') {
      return res.status(400).json({ error: 'A extensão só faz sentido com o lote já liberado para entrega.' });
    }

    const routeWindow = getRouteWindow(await loadBatchOrders(batchId), batch.current_order_id, new Map());
    const visibility = buildVisibilityControl(batch, routeWindow);
    if (visibility.hasActiveDelivery) {
      return res.status(400).json({ error: 'Há entrega ativa no lote. Não é necessário autorizar extensão agora.' });
    }
    if (!visibility.hasPendingExtensionRequest) {
      return res.status(400).json({ error: 'Não há pedido pendente de extensão para este lote.' });
    }

    const conn = await db.raw();
    await conn.run(
      `UPDATE delivery_batches
          SET driver_visibility_extension_requested_at = NULL,
              driver_visibility_extension_authorized_at = datetime('now'),
              driver_visibility_extension_expires_at = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [toFutureIso(DRIVER_VISIBILITY_EXTENSION_MS), batchId]
    );
    notifyClients('delivery-batch-visibility-approved');
    const updated = await db.execute(
      `SELECT id, batch_code, public_token, batch_status, origin_address, maps_url,
              driver_name, driver_whatsapp, driver_cpf, vehicle_model, vehicle_plate,
              accepted_at, kitchen_confirmed_at, created_at, updated_at,
              current_order_id, driver_session_token, driver_session_expires_at,
              delivery_visibility_grace_started_at,
              driver_visibility_extension_requested_at,
              driver_visibility_extension_authorized_at,
              driver_visibility_extension_expires_at
         FROM delivery_batches
        WHERE id = ?`,
      [batchId]
    );
    res.json({ success: true, batch: await serializeBatch(updated[0][0]) });
  } catch (err) {
    console.error('Erro ao autorizar extensão de visibilidade:', err.message);
    res.status(500).json({ error: 'Erro ao autorizar extensão de visibilidade' });
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
              accepted_at, kitchen_confirmed_at, created_at, updated_at,
              current_order_id, driver_session_token, driver_session_expires_at,
              delivery_visibility_grace_started_at,
              driver_visibility_extension_requested_at,
              driver_visibility_extension_authorized_at,
              driver_visibility_extension_expires_at
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
