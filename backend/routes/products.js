/**
 * Rotas de produtos, pedidos, status e atualização em tempo real.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { subscribe, unsubscribe, notifyClients } = require('../menuEvents');
const {
  parsePositiveId,
  sanitizeProductInput,
  sanitizeOrderInput,
} = require('../utils/sanitize');

let manualStatus = { isOpen: true };

// ---------------------------------------------------------------------------
// SSE — site público escuta mudanças do cardápio
// ---------------------------------------------------------------------------
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  subscribe(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(res);
  });
});

// ---------------------------------------------------------------------------
// Público — cardápio e status (sem dados sensíveis)
// ---------------------------------------------------------------------------
router.get('/menu', async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, name, price, `desc`, image, category, active, isDailySpecial FROM products WHERE active = 1 ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar cardápio:', err.message);
    res.status(500).json({ error: 'Erro ao buscar cardápio' });
  }
});

router.get('/status', (_req, res) => {
  res.json(manualStatus);
});

router.post('/orders', async (req, res) => {
  const parsed = sanitizeOrderInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    await db.execute(
      'INSERT INTO orders (customer, address, phone, payment, total, items, obs) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        parsed.customer,
        parsed.address,
        parsed.phone,
        parsed.payment,
        parsed.total,
        JSON.stringify(parsed.items),
        parsed.obs,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao salvar pedido:', err.message);
    res.status(500).json({ error: 'Erro ao salvar pedido' });
  }
});

// ---------------------------------------------------------------------------
// Admin — lista completa, alterações e pedidos
// ---------------------------------------------------------------------------
router.get('/all', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM products ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar produtos:', err.message);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

router.get('/orders', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const parsed = sanitizeProductInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO products (name, price, `desc`, image, category, active, isDailySpecial) VALUES (?, ?, ?, ?, ?, true, false)',
      [parsed.name, parsed.price, parsed.desc, parsed.image, parsed.category]
    );
    res.json({ success: true, id: result.insertId });
    notifyClients('menu-updated');
  } catch (err) {
    console.error('Erro ao adicionar produto:', err.message);
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

router.put('/toggle/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const [result] = await db.execute(
      'UPDATE products SET active = IF(active = 1, 0, 1) WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json({ success: true });
    notifyClients('menu-updated');
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar status' });
  }
});

router.put('/daily/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    await db.execute('UPDATE products SET isDailySpecial = false');
    const [result] = await db.execute(
      'UPDATE products SET isDailySpecial = true WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json({ success: true });
    notifyClients('menu-updated');
  } catch (err) {
    res.status(500).json({ error: 'Erro ao definir Prato do Dia' });
  }
});

router.delete('/daily/:id', requireAdmin, async (_req, res) => {
  try {
    await db.execute('UPDATE products SET isDailySpecial = false');
    res.json({ success: true });
    notifyClients('menu-updated');
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover Prato do Dia' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const [result] = await db.execute('DELETE FROM products WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json({ success: true });
    notifyClients('menu-updated');
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir' });
  }
});

router.put('/status', requireAdmin, (req, res) => {
  manualStatus.isOpen = req.body.isOpen === true;
  res.json({ success: true });
  notifyClients('status-updated');
});

module.exports = router;
