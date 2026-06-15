const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const ACTIVE_CUSTOMERS = {
  waiting: [
    { customer: 'Mariana Costa', address: 'Ingleses - Rua das Gaivotas, 245', phone: '48991000011', payment: 'pix', kind: 'executiva', total: 31.9, obs: 'Pedido pronto para sair com suco natural.' },
    { customer: 'Carlos Henrique', address: 'Ingleses - Servidao do Marisco, 88', phone: '48991000012', payment: 'cartao', kind: 'frango', total: 33.9, obs: 'Separar talheres e guardanapos.' },
    { customer: 'Juliana Martins', address: 'Ingleses - Rua Ilha do Arvoredo, 410', phone: '48991000013', payment: 'pix', kind: 'carne', total: 35.9, obs: 'Sem cebola na montagem final.' },
    { customer: 'Ricardo Melo', address: 'Ingleses - Rua Recanto do Sol, 129', phone: '48991000014', payment: 'cartao', kind: 'peixe', total: 36.9, obs: 'Cliente pediu embalagem reforcada.' },
  ],
  new: [
    { customer: 'Fernanda Souza', address: 'Ingleses - Rua do Siri, 52', phone: '48992000011', payment: 'pix', kind: 'executiva', total: 29.9, obs: 'Pedido entrou agora pelo site.' },
    { customer: 'Paulo Vitor', address: 'Ingleses - Rua do Engenho, 301', phone: '48992000012', payment: 'pix', kind: 'carne', total: 34.9, obs: 'Cliente pediu entrega rapida.' },
    { customer: 'Aline Pereira', address: 'Ingleses - Rua das Dunas, 77', phone: '48992000013', payment: 'cartao', kind: 'frango', total: 32.9, obs: 'Adicionar refrigerante zero.' },
  ],
  production: [
    { customer: 'Bruno Rocha', address: 'Ingleses - Rua dos Coqueiros, 64', phone: '48992500011', payment: 'pix', kind: 'carne', total: 34.9, obs: 'Em preparo com ponto da carne bem passado.' },
    { customer: 'Camila Nunes', address: 'Ingleses - Rua da Cachoeira, 154', phone: '48992500012', payment: 'cartao', kind: 'frango', total: 32.9, obs: 'Pedido com embalagem para viagem.' },
  ],
  route: {
    customer: 'Eduardo Lima',
    address: 'Ingleses - Rua das Palmeiras, 300',
    phone: '48993000001',
    payment: 'dinheiro',
    kind: 'peixe',
    total: 36.9,
    obs: 'Pedido em deslocamento para demonstrar entrega.',
  },
};

const HISTORY_CUSTOMERS = [
  'Patricia Ramos', 'Diego Fernandes', 'Larissa Almeida', 'Joao Pedro Silva', 'Vanessa Duarte',
  'Rafael Gomes', 'Bianca Freitas', 'Tiago Barros', 'Priscila Araujo', 'Leonardo Telles',
  'Sabrina Castro', 'Felipe Antunes', 'Renata Campos', 'Gustavo Lins', 'Tatiane Borges',
  'Anderson Vieira', 'Claudia Rezende', 'Mateus Farias', 'Kelly Teixeira', 'Vinicius Prado',
];

async function tableExists(conn, tableName) {
  const row = await conn.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  return Boolean(row);
}

function formatSqliteDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function createToken(id) {
  return `${id}-${crypto.randomBytes(5).toString('hex')}`;
}

function buildItems(kind, seed = 1) {
  const catalog = {
    executiva: [
      { id: 2001 + seed, name: 'Marmita Executiva', price: 29.9, qty: 1, accompaniments: [] },
    ],
    frango: [
      { id: 2101 + seed, name: 'Frango Grelhado', price: 31.9, qty: 1, accompaniments: [] },
    ],
    carne: [
      { id: 2201 + seed, name: 'Carne Acebolada', price: 33.9, qty: 1, accompaniments: [] },
    ],
    peixe: [
      { id: 2301 + seed, name: 'Peixe Crocante', price: 34.9, qty: 1, accompaniments: [] },
    ],
  };

  return catalog[kind] || catalog.executiva;
}

function buildOrderRecord({ customer, address, phone, payment, total, items, obs, status, createdAt, updatedAt, deliveredAt = null, followupState = '' }) {
  return {
    customer,
    address,
    phone,
    payment,
    total,
    items: JSON.stringify(items),
    obs,
    status,
    kanbanOrder: 0,
    orderToken: '',
    createdAt: formatSqliteDate(createdAt),
    updatedAt: formatSqliteDate(updatedAt || createdAt),
    deliveredAt: deliveredAt ? formatSqliteDate(deliveredAt) : null,
    followupState,
  };
}

async function insertOrder(conn, order) {
  const result = await conn.run(
    `INSERT INTO orders (
      customer, address, phone, payment, total, items, obs, status, kanban_order,
      order_token, created_at, updated_at, delivered_at, delivery_followup_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.customer,
      order.address,
      order.phone,
      order.payment,
      order.total,
      order.items,
      order.obs,
      order.status,
      order.kanbanOrder,
      '',
      order.createdAt,
      order.updatedAt,
      order.deliveredAt,
      order.followupState,
    ],
  );

  const id = result.lastID;
  const token = createToken(id);
  await conn.run('UPDATE orders SET order_token = ? WHERE id = ?', [token, id]);
  return { id, token, customer: order.customer, status: order.status };
}

async function resetOrders(conn) {
  await conn.exec('BEGIN');
  try {
    if (await tableExists(conn, 'delivery_attempt_logs')) {
      await conn.run('DELETE FROM delivery_attempt_logs');
    }
    if (await tableExists(conn, 'orders')) {
      await conn.run('UPDATE orders SET delivery_batch_id = NULL, delivery_sequence = NULL');
      await conn.run('DELETE FROM orders');
    }
    if (await tableExists(conn, 'delivery_batches')) {
      await conn.run('DELETE FROM delivery_batches');
    }
    if (await tableExists(conn, 'sqlite_sequence')) {
      await conn.run("DELETE FROM sqlite_sequence WHERE name IN ('orders', 'delivery_batches', 'delivery_attempt_logs')");
    }
    await conn.exec('COMMIT');
  } catch (error) {
    await conn.exec('ROLLBACK');
    throw error;
  }
}

async function seedPresentationData(conn, prefix) {
  const now = new Date();
  const waitingOrders = [];
  const newOrders = [];
  const productionOrders = [];
  const deliveredOrders = [];
  const cancelledOrders = [];
  let routeOrder = null;

  for (let index = 0; index < ACTIVE_CUSTOMERS.waiting.length; index += 1) {
    const item = ACTIVE_CUSTOMERS.waiting[index];
    waitingOrders.push(await insertOrder(conn, buildOrderRecord({
      customer: item.customer,
      address: item.address,
      phone: item.phone,
      payment: item.payment,
      total: item.total,
      items: buildItems(item.kind, index + 1),
      obs: item.obs,
      status: 'aguardando_envio',
      createdAt: new Date(now.getTime() - (40 + index + 1) * 60000),
      updatedAt: new Date(now.getTime() - (30 + index + 1) * 60000),
    })));
  }

  for (let index = 0; index < ACTIVE_CUSTOMERS.new.length; index += 1) {
    const item = ACTIVE_CUSTOMERS.new[index];
    newOrders.push(await insertOrder(conn, buildOrderRecord({
      customer: item.customer,
      address: item.address,
      phone: item.phone,
      payment: item.payment,
      total: item.total,
      items: buildItems(item.kind, index + 10),
      obs: item.obs,
      status: 'novo',
      createdAt: new Date(now.getTime() - (7 + index + 1) * 60000),
      updatedAt: new Date(now.getTime() - (5 + index + 1) * 60000),
    })));
  }

  for (let index = 0; index < ACTIVE_CUSTOMERS.production.length; index += 1) {
    const item = ACTIVE_CUSTOMERS.production[index];
    productionOrders.push(await insertOrder(conn, buildOrderRecord({
      customer: item.customer,
      address: item.address,
      phone: item.phone,
      payment: item.payment,
      total: item.total,
      items: buildItems(item.kind, index + 20),
      obs: item.obs,
      status: 'em_producao',
      createdAt: new Date(now.getTime() - (22 + index + 1) * 60000),
      updatedAt: new Date(now.getTime() - (14 + index + 1) * 60000),
    })));
  }

  const routeItem = ACTIVE_CUSTOMERS.route;
  routeOrder = await insertOrder(conn, buildOrderRecord({
    customer: routeItem.customer,
    address: routeItem.address,
    phone: routeItem.phone,
    payment: routeItem.payment,
    total: routeItem.total,
    items: buildItems(routeItem.kind, 22),
    obs: routeItem.obs,
    status: 'a_caminho',
    createdAt: new Date(now.getTime() - 55 * 60000),
    updatedAt: new Date(now.getTime() - 12 * 60000),
  }));

  const historySeeds = [];
  const deliveredKinds = ['executiva', 'frango', 'carne', 'peixe'];
  const payments = ['pix', 'cartao', 'dinheiro'];

  for (let index = 0; index < 28; index += 1) {
    historySeeds.push({
      dayOffset: 14 - (index % 10),
      kind: deliveredKinds[index % deliveredKinds.length],
      payment: payments[index % payments.length],
      total: 28.9 + (index % 5) * 2,
      status: 'entregue',
    });
  }

  for (let index = 0; index < 12; index += 1) {
    historySeeds.push({
      dayOffset: 12 - (index % 8),
      kind: deliveredKinds[(index + 1) % deliveredKinds.length],
      payment: payments[(index + 2) % payments.length],
      total: 27.9 + (index % 4) * 1.8,
      status: 'cancelado',
    });
  }

  for (let index = 0; index < historySeeds.length; index += 1) {
    const seed = historySeeds[index];
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - seed.dayOffset);
    createdAt.setHours(11 + (index % 4), 15 + index, 0, 0);
    const updatedAt = new Date(createdAt.getTime() + 35 * 60000);
    const deliveredAt = seed.status === 'entregue' ? new Date(createdAt.getTime() + 55 * 60000) : null;
    const customer = HISTORY_CUSTOMERS[index] || `Cliente ${index + 1}`;

    const order = await insertOrder(conn, buildOrderRecord({
      customer,
      address: `Ingleses - Rua das Conchas, ${50 + index}`,
      phone: `48994000${String(index + 1).padStart(2, '0')}`,
      payment: seed.payment,
      total: seed.total,
      items: buildItems(seed.kind, index + 30),
      obs: seed.status === 'entregue' ? 'Pedido entregue e contabilizado no dashboard.' : 'Pedido cancelado para destacar impacto negativo.',
      status: seed.status,
      createdAt,
      updatedAt,
      deliveredAt,
      followupState: seed.status === 'cancelado' ? 'cancelled' : '',
    }));

    if (seed.status === 'entregue') {
      deliveredOrders.push(order);
    } else {
      cancelledOrders.push(order);
    }
  }

  return {
    prefix,
    waitingOrders,
    newOrders,
    productionOrders,
    routeOrder,
    deliveredOrders,
    cancelledOrders,
  };
}

async function main() {
  const conn = await db.raw();
  const prefix = `APRESENTACAO ${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const outputFlagIndex = process.argv.indexOf('--output');
  const outputPath = outputFlagIndex !== -1 ? process.argv[outputFlagIndex + 1] : '';

  await resetOrders(conn);
  const result = await seedPresentationData(conn, prefix);

  const json = JSON.stringify(result, null, 2);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('Falha ao preparar pedidos de apresentacao:', error);
  process.exit(1);
});
