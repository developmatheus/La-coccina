import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DRIVER_TOKEN = process.env.DRIVER_TOKEN || 'e449b48de9e19f20a0c1c102';
const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'playwright-personas');

const links = {
  cliente: `${BASE_URL}/`,
  administrativo: `${BASE_URL}/admin/login.html`,
  cozinha: `${BASE_URL}/admin/kanban.html`,
  motoboy: `${BASE_URL}/delivery-batch.html?token=${encodeURIComponent(DRIVER_TOKEN)}`,
};

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'links.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        links,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function printLinks() {
  console.log('\nLinks locais para testar as personas:\n');
  console.log(`- Cliente:        ${links.cliente}`);
  console.log(`- Administrativo: ${links.administrativo}`);
  console.log(`- Cozinha:        ${links.cozinha}`);
  console.log(`- Motoboy:        ${links.motoboy}`);
  console.log(`\nCredenciais locais de admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log(`Saida do Playwright: ${OUTPUT_DIR}\n`);
}

async function saveShot(page, fileName) {
  const filePath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  screenshot -> ${filePath}`);
}

async function clickIfVisible(locator) {
  if (await locator.count()) {
    const first = locator.first();
    if (await first.isVisible()) {
      await first.click();
      return true;
    }
  }
  return false;
}

async function runCliente(context) {
  console.log('Persona: Cliente');
  const page = await context.newPage();
  await page.goto(links.cliente, { waitUntil: 'domcontentloaded' });
  await page.locator('.hero-title').waitFor({ timeout: 15000 });
  await saveShot(page, 'cliente-home.png');

  const scrollButton = page.locator('[data-scroll-to="cardapio"]').first();
  if (await scrollButton.count()) {
    await scrollButton.click();
    await page.waitForTimeout(500);
  }

  const directAddButton = page.locator('button.add-to-cart').filter({ hasText: 'Adicionar ao Carrinho' }).first();
  if (await directAddButton.count()) {
    await directAddButton.click();
    await page.waitForTimeout(700);
  } else {
    await clickIfVisible(page.locator('button.add-to-cart').first());
    const modalConfirm = page.locator('#btn-acc-confirm');
    if (await modalConfirm.count()) {
      if (await modalConfirm.isEnabled().catch(() => false)) {
        await modalConfirm.click();
      } else {
        await clickIfVisible(page.locator('#btn-acc-cancel'));
      }
    }
    await page.waitForTimeout(700);
  }

  await saveShot(page, 'cliente-cardapio.png');

  const cartButton = page.locator('#cart-float-btn');
  if (await cartButton.count()) {
    await cartButton.click();
    await page.waitForURL(/cart\.html/, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await saveShot(page, 'cliente-carrinho.png');
  }
}

async function runAdministrativo(context) {
  console.log('Persona: Administrativo');
  const page = await context.newPage();
  await page.goto(links.administrativo, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').waitFor({ timeout: 15000 });
  await page.fill('#username', ADMIN_USERNAME);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await page.locator('#followup-body').waitFor({ timeout: 15000 });
  await saveShot(page, 'admin-dashboard.png');
  return { page };
}

async function runCozinha(page) {
  console.log('Persona: Cozinha');
  await page.evaluate(() => {
    localStorage.setItem('lc_kanban_enabled', 'true');
  });
  await page.goto(links.cozinha, { waitUntil: 'domcontentloaded' });
  await page.locator('#kb-board').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await saveShot(page, 'cozinha-kanban.png');

  const qrButton = page.getByRole('button', { name: /Ver QR/i }).first();
  if (await qrButton.count()) {
    await qrButton.click();
    await page.waitForTimeout(700);
    await saveShot(page, 'cozinha-lote-qr.png');
    await clickIfVisible(page.getByRole('button', { name: 'Fechar' }).last());
  }
}

async function runMotoboy(context) {
  console.log('Persona: Motoboy');
  const page = await context.newPage();
  await page.goto(links.motoboy, { waitUntil: 'domcontentloaded' });
  await page.locator('#current-stop-title').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await saveShot(page, 'motoboy-pwa.png');

  const deferredButton = page.locator('#deferred-btn');
  if (await deferredButton.count()) {
    const disabled = await deferredButton.isDisabled().catch(() => true);
    if (!disabled) {
      await deferredButton.click();
      await page.waitForTimeout(500);
      await saveShot(page, 'motoboy-adiados.png');
    }
  }
}

async function main() {
  await ensureOutputDir();
  printLinks();

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    slowMo: Number(process.env.SLOW_MO || 0) || 0,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });

  try {
    await runCliente(context);
    const { page: adminPage } = await runAdministrativo(context);
    await runCozinha(adminPage);
    await runMotoboy(context);
    console.log('\nPlaywright finalizado com sucesso.');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nFalha ao executar o Playwright de personas.');
  console.error(error);
  process.exitCode = 1;
});
