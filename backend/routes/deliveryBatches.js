const express = require('express');
const crypto = require('crypto');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notifyClients } = require('../menuEvents');
const { parsePositiveId } = require('../utils/sanitize');

const router = express.Router();

const VALID_BATCH_STATUSES = ['preparado', 'aceito_motoboy', 'liberado_cozinha'];

function generatePublicToken() {
  return crypto.randomBytes(12).toString('hex');
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

async function getConfigValue(key) {
  const [rows] = await db.execute('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || '';
}

async function loadBatchByToken(token) {
  const [rows] = await db.execute(
    `SELECT id, batch_code, public_token, batch_status, origin_address, maps_url,
            driver_name, driver_whatsapp, driver_cpf, vehicle_model, vehicle_plate,
            accepted_at, kitchen_confirmed_at, created_at, updated_at
       FROM delivery_batches
      WHERE public_token = ?`,
    [token]
  );
  return rows[0] || null;
}

async function loadBatchOrders(batchId) {
  const [rows] = await db.execute(
    `SELECT id, customer, address, phone, payment, total, items, obs, status,
            delivery_sequence, created_at, updated_at
       FROM orders
      WHERE delivery_batch_id = ?
      ORDER BY COALESCE(delivery_sequence, 999999) ASC, created_at ASC`,
    [batchId]
  );
  return rows.map((row) => ({ ...row, items: JSON.parse(row.items || '[]') }));
}

async function serializeBatch(batch) {
  const orders = await loadBatchOrders(batch.id);
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
    orders,
  };
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
  if (!mapsUrl) return res.status(400).json({ error: 'A rota do Google Maps é obrigatória.' });

  try {
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
        `INSERT INTO delivery_batches (batch_code, public_token, batch_status, origin_address, maps_url)
         VALUES (?, ?, 'preparado', ?, ?)`,
        [batchCode, publicToken, originAddress, mapsUrl]
      );

      const batchId = batchResult.lastID;
      for (let i = 0; i < orderedOrderIds.length; i++) {
        await conn.run(
          `UPDATE orders
              SET delivery_batch_id = ?, delivery_sequence = ?, updated_at = datetime('now')
            WHERE id = ?`,
          [batchId, i + 1, orderedOrderIds[i]]
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
    res.status(500).json({ error: 'Erro ao preparar lote de entrega' });
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

    await db.execute(
      `UPDATE delivery_batches
          SET driver_name = ?,
              driver_whatsapp = ?,
              driver_cpf = ?,
              vehicle_model = ?,
              vehicle_plate = ?,
              accepted_at = datetime('now'),
              batch_status = 'aceito_motoboy',
              updated_at = datetime('now')
        WHERE id = ?`,
      [name, whatsapp, cpf, vehicleModel, vehiclePlate, batch.id]
    );

    notifyClients('delivery-batch-accepted');
    const updated = await loadBatchByToken(token);
    res.json({ success: true, batch: await serializeBatch(updated) });
  } catch (err) {
    console.error('Erro ao registrar aceite do motoboy:', err.message);
    res.status(500).json({ error: 'Erro ao registrar aceite do motoboy' });
  }
});

router.post('/:id/confirm-kitchen', requireAdmin, async (req, res) => {
  const batchId = parsePositiveId(req.params.id);
  if (!batchId) return res.status(400).json({ error: 'Lote inválido.' });

  try {
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

router.get('/:id', requireAdmin, async (req, res) => {
  const batchId = parsePositiveId(req.params.id);
  if (!batchId) return res.status(400).json({ error: 'Lote inválido.' });

  try {
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
