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
// Helpers
// ---------------------------------------------------------------------------
function mergeDetails(row) {
  const details = row.category === 'marmita'
    ? { protein: row.protein ?? '', sides: row.sides ?? '' }
    : { volume: row.volume ?? '', serve_type: row.serve_type ?? '' };
  const { protein, sides, volume, serve_type, ...base } = row;
  return { ...base, details };
}

const MENU_JOIN = `
  SELECT p.id, p.name, p.price, p.\`desc\`, p.image, p.category, p.active, p.isDailySpecial,
         md.protein, md.sides,
         bd.volume, bd.serve_type
  FROM products p
  LEFT JOIN marmita_details md ON md.product_id = p.id AND p.category = 'marmita'
  LEFT JOIN bebida_details  bd ON bd.product_id = p.id AND p.category = 'bebida'
`;

async function upsertDetails(id, category, details) {
  if (category === 'marmita') {
    await db.execute(
      'INSERT OR REPLACE INTO marmita_details (product_id, protein, sides) VALUES (?, ?, ?)',
      [id, details.protein ?? '', details.sides ?? '']
    );
  } else {
    await db.execute(
      'INSERT OR REPLACE INTO bebida_details (product_id, volume, serve_type) VALUES (?, ?, ?)',
      [id, details.volume ?? '', details.serve_type ?? '']
    );
  }
}

// ---------------------------------------------------------------------------
// Público — cardápio e status (sem dados sensíveis)
// ---------------------------------------------------------------------------
router.get('/menu', async (_req, res) => {
  try {
    const [rows] = await db.execute(MENU_JOIN + ' WHERE p.active = 1 ORDER BY p.created_at DESC');
    res.json(rows.map(mergeDetails));
  } catch (err) {
    console.error('Erro ao buscar cardápio:', err.message);
    res.status(500).json({ error: 'Erro ao buscar cardápio' });
  }
});

router.get('/status', async (_req, res) => {
  try {
    const [rows] = await db.execute("SELECT value FROM config WHERE key = 'isOpen'");
    const isOpen = rows.length > 0 ? rows[0].value === 'true' : false;
    res.json({ isOpen });
  } catch (err) {
    console.error('Erro ao buscar status:', err.message);
    res.json({ isOpen: false });
  }
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
    const [rows] = await db.execute(MENU_JOIN + ' ORDER BY p.created_at DESC');
    res.json(rows.map(mergeDetails));
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
      'INSERT INTO products (name, price, `desc`, image, category, active, isDailySpecial) VALUES (?, ?, ?, ?, ?, 1, 0)',
      [parsed.name, parsed.price, parsed.desc, parsed.image, parsed.category]
    );
    const newId = result.insertId;
    await upsertDetails(newId, parsed.category, parsed.details);
    res.json({ success: true, id: newId });
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
      'UPDATE products SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?',
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
    await db.execute('UPDATE products SET isDailySpecial = 0');
    const [result] = await db.execute(
      'UPDATE products SET isDailySpecial = 1 WHERE id = ?',
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
    await db.execute('UPDATE products SET isDailySpecial = 0');
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

router.put('/status', requireAdmin, async (req, res) => {
  const isOpen = req.body.isOpen === true;
  try {
    await db.execute(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['isOpen', String(isOpen)]
    );
    res.json({ success: true });
    notifyClients('status-updated');
  } catch (err) {
    console.error('Erro ao atualizar status:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  const parsed = sanitizeProductInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      'UPDATE products SET name = ?, price = ?, `desc` = ?, category = ?, image = COALESCE(NULLIF(?, \'\'), image) WHERE id = ?',
      [parsed.name, parsed.price, parsed.desc, parsed.category, parsed.image, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    await upsertDetails(id, parsed.category, parsed.details);
    res.json({ success: true });
    notifyClients('menu-updated');
  } catch (err) {
    console.error('Erro ao editar produto:', err.message);
    res.status(500).json({ error: 'Erro ao editar produto' });
  }
});

module.exports = router;
