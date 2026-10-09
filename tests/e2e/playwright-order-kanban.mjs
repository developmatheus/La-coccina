import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'playwright-order-kanban');

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function saveShot(page, fileName) {
  const filePath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`screenshot -> ${filePath}`);
}

function uniqueCustomerName() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `Teste Kanban ${stamp}`;
}

async function addProductToCart(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('button.add-to-cart').first().waitFor({ timeout: 20000 });

  const directAddButton = page.locator('button.add-to-cart').filter({ hasText: 'Adicionar ao Carrinho' }).first();

  if (await directAddButton.count()) {
    await directAddButton.click();
  } else {
    await page.locator('button.add-to-cart').first().click();
    const firstAccItem = page.locator('.acc-check-item').first();
    await firstAccItem.waitFor({ timeout: 8000 });
    await firstAccItem.click();
    await page.locator('#btn-acc-confirm').click();
  }

  await page.waitForTimeout(800);
  await saveShot(page, '01-cliente-home-com-item.png');

  await page.locator('#cart-float-btn').click();
  await page.waitForURL(/cart\.html/, { timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
}

async function checkoutOrder(page, customerName) {
  await page.addInitScript(() => {
    window.open = () => null;
  });

  const orderResponsePromise = page.waitForResponse((response) => {
    return response.url().endsWith('/api/orders') && response.request().method() === 'POST';
  }, { timeout: 15000 });

  await page.fill('#customer-name', customerName);
  await page.selectOption('#bairro', { label: 'Ingleses' });
  await page.fill('#address', `Rua Teste Playwright, 123 - ${customerName}`);
  await page.fill('#phone', '48999990001');
  await page.selectOption('#payment', 'pix');
  await page.fill('#obs', 'Pedido criado automaticamente para validacao do Kanban.');

  await saveShot(page, '02-carrinho-preenchido.png');

  const checkoutButton = page.locator('#whatsapp-btn');
  await checkoutButton.waitFor({ timeout: 10000 });
  await checkoutButton.click();

  const orderResponse = await orderResponsePromise;
  const orderData = await orderResponse.json();

  await page.waitForURL(/track\.html/, { timeout: 15000 });
  await saveShot(page, '03-rastreio-pos-pedido.png');

  if (!orderData?.success || !orderData?.id) {
    throw new Error(`Pedido nao foi registrado corretamente: ${JSON.stringify(orderData)}`);
  }

  return orderData;
}

async function loginAdmin(page) {
  await page.goto(`${BASE_URL}/admin/login.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', ADMIN_USERNAME);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
}

async function findOrderInKanban(page, orderData, customerName) {
  await page.evaluate(() => {
    localStorage.setItem('lc_kanban_enabled', 'true');
  });

  await page.goto(`${BASE_URL}/admin/kanban.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#kb-board').waitFor({ timeout: 20000 });

  const orderCard = page.locator('.kb-card').filter({ hasText: customerName }).first();
  await orderCard.waitFor({ timeout: 20000 });
  await saveShot(page, '04-kanban-card-localizado.png');

  await orderCard.click();
  await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
  await page.locator('#kd-customer-name').waitFor({ timeout: 10000 });
  await saveShot(page, '05-kanban-drawer-aberto.png');

  const nextAction = page.locator('.kd-action-btn.primary').first();
  if (await nextAction.count()) {
    await nextAction.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const movedCard = page.locator('.kb-card').filter({ hasText: customerName }).first();
  await movedCard.waitFor({ timeout: 20000 });
  await saveShot(page, '06-kanban-card-movido.png');

  const result = {
    orderId: orderData.id,
    token: orderData.token || null,
    customer: customerName,
    trackUrl: `${BASE_URL}/track.html?token=${encodeURIComponent(orderData.token || '')}`,
  };

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'resultado.json'),
    JSON.stringify(result, null, 2),
    'utf8',
  );

  return result;
}

async function main() {
  await ensureOutputDir();

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    slowMo: Number(process.env.SLOW_MO || 0) || 0,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });

  const customerName = uniqueCustomerName();
  console.log(`Cliente de teste: ${customerName}`);

  try {
    const clientPage = await context.newPage();
    await addProductToCart(clientPage);
    const orderData = await checkoutOrder(clientPage, customerName);
    console.log(`Pedido criado com sucesso: #${orderData.id}`);

    const adminPage = await context.newPage();
    await loginAdmin(adminPage);
    const result = await findOrderInKanban(adminPage, orderData, customerName);

    console.log('\nFluxo concluido com sucesso.');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nFalha na simulacao cliente -> Kanban.');
  console.error(error);
  process.exitCode = 1;
});
