/**
 * Rotas de acompanhamentos — catálogo global e associação por produto.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notifyClients } = require('../menuEvents');
const {
  parsePositiveId,
  sanitizeAccompanimentInput,
  sanitizeProductAccompanimentsInput,
} = require('../utils/sanitize');

// ---------------------------------------------------------------------------
// Catálogo global — público (para o cardápio montar a seleção)
// ---------------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, name, extra_price, sort_order FROM accompaniments WHERE active = 1 ORDER BY sort_order ASC, name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar acompanhamentos:', err.message);
    res.status(500).json({ error: 'Erro ao buscar acompanhamentos' });
  }
});

// ---------------------------------------------------------------------------
// Acompanhamentos de um produto específico — público
// ---------------------------------------------------------------------------
router.get('/product/:id', async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const [rows] = await db.execute(`
      SELECT a.id, a.name, a.extra_price,
             pa.is_default, pa.is_available,
             md.is_customizable, md.min_sides, md.max_sides
      FROM product_accompaniments pa
      JOIN accompaniments a ON a.id = pa.accompaniment_id
      LEFT JOIN marmita_details md ON md.product_id = pa.product_id
      WHERE pa.product_id = ? AND a.active = 1 AND pa.is_available = 1
      ORDER BY a.sort_order ASC, a.name ASC
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar acompanhamentos do produto:', err.message);
    res.status(500).json({ error: 'Erro ao buscar acompanhamentos do produto' });
  }
});

// ---------------------------------------------------------------------------
// Admin — catálogo global CRUD
// ---------------------------------------------------------------------------
router.get('/catalog', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM accompaniments ORDER BY sort_order ASC, name ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar catálogo' });
  }
});

router.get('/admin', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM accompaniments ORDER BY sort_order ASC, name ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar catálogo' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const parsed = sanitizeAccompanimentInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await db.execute(
      'INSERT INTO accompaniments (name, extra_price, sort_order) VALUES (?, ?, ?)',
      [parsed.name, parsed.extra_price, parsed.sort_order]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Já existe um acompanhamento com esse nome' });
    }
    res.status(500).json({ error: 'Erro ao criar acompanhamento' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  const parsed = sanitizeAccompanimentInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : undefined;

  try {
    const setClauses = ['name = ?', 'extra_price = ?', 'sort_order = ?'];
    const params = [parsed.name, parsed.extra_price, parsed.sort_order];
    if (active !== undefined) { setClauses.push('active = ?'); params.push(active); }
    params.push(id);

    const [result] = await db.execute(
      `UPDATE accompaniments SET ${setClauses.join(', ')} WHERE id = ?`, params
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar acompanhamento' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    await db.execute('DELETE FROM accompaniments WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir acompanhamento' });
  }
});

// ---------------------------------------------------------------------------
// Admin — associar acompanhamentos a um produto (substitui todos)
// ---------------------------------------------------------------------------
router.put('/product/:id', requireAdmin, async (req, res) => {
  const productId = parsePositiveId(req.params.id);
  if (!productId) return res.status(400).json({ error: 'ID inválido' });

  const parsed = sanitizeProductAccompanimentsInput(req.body);
  const conn = await db.raw();

  try {
    // Atualizar flags de personalização em marmita_details
    await conn.run(
      `INSERT OR REPLACE INTO marmita_details (product_id, protein, sides, is_customizable, min_sides, max_sides)
       VALUES (?,
         COALESCE((SELECT protein FROM marmita_details WHERE product_id = ?), ''),
         COALESCE((SELECT sides   FROM marmita_details WHERE product_id = ?), ''),
         ?, ?, ?)`,
      [productId, productId, productId, parsed.is_customizable, parsed.min_sides, parsed.max_sides]
    );

    // Substituir associações
    await conn.run('DELETE FROM product_accompaniments WHERE product_id = ?', [productId]);
    for (const item of parsed.items) {
      await conn.run(
        'INSERT INTO product_accompaniments (product_id, accompaniment_id, is_default, is_available) VALUES (?, ?, ?, ?)',
        [productId, item.accompaniment_id, item.is_default, item.is_available]
      );
    }

    notifyClients('menu-updated');
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao salvar acompanhamentos do produto:', err.message);
    res.status(500).json({ error: 'Erro ao salvar acompanhamentos' });
  }
});

module.exports = router;
