import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
process.env.DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'backend', 'data', 'lacoccina.db');
const require = createRequire(import.meta.url);
const db = require('../backend/db');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'playwright-personas-video');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');
const RAW_VIDEO_FILE = path.join(OUTPUT_DIR, 'personas-demo-raw.webm');
const FINAL_VIDEO_FILE = path.join(OUTPUT_DIR, 'personas-demo.mp4');
const RESULT_FILE = path.join(OUTPUT_DIR, 'resultado.json');
const SCENARIO_FILE = path.join(OUTPUT_DIR, 'scenario.json');
const VIDEO_WIDTH = 1440;
const VIDEO_HEIGHT = 1024;
const WINDOW_WIDTH = 1600;
const WINDOW_HEIGHT = 1280;
const VIDEO_TOP_SAFE_PADDING = 28;

const DEMO_DRIVER = {
  name: 'Joao da Rota',
  whatsapp: '48999111222',
  cpf: '12345678901',
  model: 'Honda CG 160',
  plate: 'QWE1A23',
};

const DEMO_ORIGIN_ADDRESS = 'La Coccina - Ingleses, Florianopolis - SC';
const DEMO_STOP_COORDS = {
  lat: -27.43824,
  lng: -48.39767,
};

async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
}

async function pause(page, seconds) {
  await page.waitForTimeout(seconds * 1000);
}

async function ensureVideoSafeFrame(page) {
  await page.evaluate((safePadding) => {
    if (!document.getElementById('__pw-video-safe-frame')) {
      const style = document.createElement('style');
      style.id = '__pw-video-safe-frame';
      style.textContent = `
        html { scroll-behavior: auto !important; }
        body::before {
          content: '';
          display: block;
          height: ${safePadding}px;
          width: 100%;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, VIDEO_TOP_SAFE_PADDING).catch(() => {});
  await page.waitForTimeout(120);
}

async function readScenarioFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function ensureColumn(conn, tableName, columnName, sqlDefinition) {
  const columns = await conn.all(`PRAGMA table_info(${tableName})`);
  if (!columns.some((column) => column.name === columnName)) {
    await conn.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`);
  }
}

async function ensureDeliveryBatchSchema(conn) {
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
}

async function preparePresentationOrders() {
  const backendCwd = path.join(process.cwd(), 'backend');

  await execFileAsync(
    process.execPath,
    [path.join(backendCwd, 'scripts', 'migrate.js')],
    { cwd: backendCwd, maxBuffer: 1024 * 1024 * 4 },
  );

  await execFileAsync(
    process.execPath,
    [path.join(backendCwd, 'scripts', 'prepare-presentation-orders.js'), '--output', SCENARIO_FILE],
    { cwd: backendCwd, maxBuffer: 1024 * 1024 * 4 },
  );

  return readScenarioFile(SCENARIO_FILE);
}

async function configureDeliverySettings(conn) {
  await conn.run(
    'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
    ['deliveryManagementEnabled', 'true'],
  );
  await conn.run(
    'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
    ['driverCancellationMode', 'admin_confirmation'],
  );
  await conn.run(
    'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
    ['restaurantOriginAddress', DEMO_ORIGIN_ADDRESS],
  );
}

function createBatchCode() {
  return `LGPD-${Date.now().toString().slice(-6)}`;
}

function createPublicToken() {
  return crypto.randomBytes(12).toString('hex');
}

async function createDemoBatch(conn, orderId) {
  const batchCode = createBatchCode();
  const publicToken = createPublicToken();
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(DEMO_ORIGIN_ADDRESS)}`;

  const inserted = await conn.run(
    `INSERT INTO delivery_batches (
      batch_code, public_token, batch_status, origin_address, maps_url, current_order_id, updated_at
    ) VALUES (?, ?, 'preparado', ?, ?, ?, datetime('now'))`,
    [batchCode, publicToken, DEMO_ORIGIN_ADDRESS, mapsUrl, orderId],
  );

  const batchId = inserted.lastID;

  await conn.run(
    `UPDATE orders
        SET status = 'preparando_rota',
            delivery_batch_id = ?,
            delivery_sequence = 1,
            address_lat = ?,
            address_lng = ?,
            address_geocoded_at = datetime('now'),
            delivery_failed_reason = '',
            delivery_failed_note = '',
            delivery_attempted_at = NULL,
            delivery_actor_name = '',
            delivery_followup_state = '',
            delivery_followup_updated_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ?`,
    [batchId, DEMO_STOP_COORDS.lat, DEMO_STOP_COORDS.lng, orderId],
  );

  return { batchId, batchCode, publicToken };
}

async function loadBatchState(conn, batchId) {
  return conn.get(
    `SELECT id, batch_code, public_token, batch_status,
            delivery_visibility_grace_started_at,
            driver_visibility_extension_requested_at,
            driver_visibility_extension_authorized_at,
            driver_visibility_extension_expires_at
       FROM delivery_batches
      WHERE id = ?`,
    [batchId],
  );
}

async function fastForwardPrivacyGrace(conn, batchId) {
  await conn.run(
    `UPDATE delivery_batches
        SET delivery_visibility_grace_started_at = datetime('now', '-5 minutes'),
            updated_at = datetime('now')
      WHERE id = ?`,
    [batchId],
  );
}

async function bootstrapScenario() {
  const scenario = await preparePresentationOrders();
  const conn = await db.raw();

  await ensureDeliveryBatchSchema(conn);
  await configureDeliverySettings(conn);

  const targetOrder = scenario.waitingOrders?.[0];
  if (!targetOrder?.id) {
    throw new Error('Nao foi possivel selecionar um pedido para o lote de demonstracao.');
  }

  const batch = await createDemoBatch(conn, targetOrder.id);
  const result = {
    ...scenario,
    demoBatch: {
      ...batch,
      url: `${BASE_URL}/delivery-batch.html?token=${encodeURIComponent(batch.publicToken)}`,
      customer: targetOrder.customer,
      orderId: targetOrder.id,
    },
  };

  await fs.writeFile(SCENARIO_FILE, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

async function renderFinalVideo() {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      RAW_VIDEO_FILE,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      FINAL_VIDEO_FILE,
    ],
    { cwd: process.cwd() },
  );
}

async function clickIfVisible(locator) {
  if (await locator.count()) {
    const target = locator.first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      return true;
    }
  }
  return false;
}

async function runClientScene(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('.hero-title').waitFor({ timeout: 15000 });
  await pause(page, 1.2);

  const scrollButton = page.locator('[data-scroll-to="cardapio"]').first();
  if (await scrollButton.count()) {
    await scrollButton.click();
    await pause(page, 0.8);
  }

  const addButton = page.locator('button.add-to-cart').filter({ hasText: 'Adicionar ao Carrinho' }).first();
  if (await addButton.count()) {
    await addButton.click();
    await pause(page, 1.0);
  }

  const cartButton = page.locator('#cart-float-btn').first();
  if (await cartButton.count()) {
    await cartButton.click();
    await page.waitForURL(/cart\.html/, { timeout: 5000 }).catch(() => {});
    await pause(page, 1.5);
  }
}

async function loginAdmin(page) {
  await page.goto(`${BASE_URL}/admin/login.html`, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#username').waitFor({ timeout: 15000 });
  await page.fill('#username', ADMIN_USERNAME);
  await pause(page, 0.3);
  await page.fill('#password', ADMIN_PASSWORD);
  await pause(page, 0.3);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await page.locator('#followup-body').waitFor({ timeout: 15000 });
  await pause(page, 1.6);
}

async function openKanban(page) {
  await page.evaluate(() => {
    localStorage.setItem('lc_kanban_enabled', 'true');
  });
  await page.goto(`${BASE_URL}/admin/kanban.html`, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#kb-board').waitFor({ timeout: 20000 });
  await pause(page, 1.5);
}

async function openBatchPanel(page, batchCode) {
  const panel = page.locator('.kb-batch-panel').filter({ hasText: batchCode }).first();
  await panel.waitFor({ timeout: 20000 });
  await panel.scrollIntoViewIfNeeded();
  await pause(page, 0.6);
  return panel;
}

async function runAdminKitchenPreparedScene(page, demoBatch) {
  await openKanban(page);
  await openBatchPanel(page, demoBatch.batchCode);
  await page.evaluate((batchId) => {
    if (typeof window.openBatchModal === 'function') {
      window.openBatchModal(batchId);
    }
  }, demoBatch.batchId);
  await page.locator('#batch-modal.open').waitFor({ timeout: 10000 });
  await pause(page, 2.4);
  await page.getByRole('button', { name: 'Fechar' }).last().click();
  await pause(page, 0.6);
}

async function runDriverAcceptScene(page, demoBatch) {
  await page.goto(demoBatch.url, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#driver-form').waitFor({ timeout: 15000 });
  await page.fill('#driver-name', DEMO_DRIVER.name);
  await page.fill('#driver-whatsapp', DEMO_DRIVER.whatsapp);
  await page.fill('#driver-cpf', DEMO_DRIVER.cpf);
  await page.fill('#driver-model', DEMO_DRIVER.model);
  await page.fill('#driver-plate', DEMO_DRIVER.plate);
  await pause(page, 0.8);
  await page.getByRole('button', { name: 'Salvar e aceitar lote' }).click();
  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector('#current-stop-title')
      || document.querySelector('#privacy-lock')
      || document.querySelector('#deferred-btn')
    );
  }, { timeout: 15000 });
  await pause(page, 2.0);
}

async function runKitchenReleaseScene(page, demoBatch) {
  await openKanban(page);
  await openBatchPanel(page, demoBatch.batchCode);
  await page.evaluate((batchId) => {
    if (typeof window.openBatchModal === 'function') {
      window.openBatchModal(batchId);
    }
  }, demoBatch.batchId);
  await page.locator('#batch-modal.open').waitFor({ timeout: 10000 });
  await pause(page, 1.2);
  await page.getByRole('button', { name: 'Fechar' }).last().click();
  await pause(page, 0.5);

  await page.evaluate((batchId) => {
    if (typeof window.confirmKitchenRelease === 'function') {
      window.confirmKitchenRelease(batchId);
    }
  }, demoBatch.batchId);
  await page.locator('#batch-modal.open').waitFor({ timeout: 15000 }).catch(() => {});
  await pause(page, 2.4);
}

async function runDriverActiveScene(page, demoBatch) {
  await page.goto(demoBatch.url, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#current-stop-title').waitFor({ timeout: 15000 });
  await page.locator('#stop-customer').waitFor({ timeout: 15000 });
  await pause(page, 2.5);
}

async function runDriverDeferredScene(page) {
  await page.getByRole('button', { name: 'NAO ENTREGUE' }).click();
  await page.locator('#failed-modal.open').waitFor({ timeout: 10000 });
  await pause(page, 0.8);
  const reasonButton = page.locator('.reason-option').first();
  if (await reasonButton.count()) {
    await reasonButton.click();
  }
  await page.locator('#confirm-failed-btn').click();
  await pause(page, 1.8);

  const deferredButton = page.locator('#deferred-btn');
  if (!(await deferredButton.isDisabled().catch(() => true))) {
    await deferredButton.click();
    await pause(page, 2.0);
    await clickIfVisible(page.locator('#close-deferred-btn'));
  }
}

async function runPrivacyBlockedScene(page, conn, demoBatch) {
  await fastForwardPrivacyGrace(conn, demoBatch.batchId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#privacy-lock').waitFor({ timeout: 10000 });
  await pause(page, 2.0);
}

async function runExtensionRequestScene(page) {
  const requestButton = page.locator('#privacy-request-btn');
  await requestButton.waitFor({ timeout: 10000 });
  await requestButton.click();
  await pause(page, 1.6);
}

async function runAdminApprovalScene(page, demoBatch) {
  await openKanban(page);
  await openBatchPanel(page, demoBatch.batchCode);
  await page.evaluate((batchId) => {
    if (typeof window.openBatchModal === 'function') {
      window.openBatchModal(batchId);
    }
  }, demoBatch.batchId);
  await page.locator('#batch-modal.open').waitFor({ timeout: 10000 });
  await page.locator('#batch-modal-privacy').waitFor({ timeout: 10000 });
  await pause(page, 1.2);
  await page.locator('#batch-approve-privacy-btn').click();
  await pause(page, 2.0);
  await page.getByRole('button', { name: 'Fechar' }).last().click();
}

async function runDriverExtendedScene(page, demoBatch) {
  await page.goto(demoBatch.url, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#privacy-lock').waitFor({ timeout: 10000 });
  await pause(page, 1.2);
  const deferredButton = page.locator('#deferred-btn');
  if (!(await deferredButton.isDisabled().catch(() => true))) {
    await deferredButton.click();
    await pause(page, 2.2);
  }
}

async function writeResultFile(result) {
  await fs.writeFile(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
}

async function recordVideo() {
  const scenario = await bootstrapScenario();
  const conn = await db.raw();

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    slowMo: Number(process.env.SLOW_MO || 140) || 140,
    args: [`--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`],
  });

  const context = await browser.newContext({
    viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
    screen: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: RAW_DIR,
      size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
    },
  });

  const page = await context.newPage();
  const video = page.video();

  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  try {
    await runClientScene(page);
    await loginAdmin(page);
    await runAdminKitchenPreparedScene(page, scenario.demoBatch);
    await runDriverAcceptScene(page, scenario.demoBatch);
    await runKitchenReleaseScene(page, scenario.demoBatch);
    await runDriverActiveScene(page, scenario.demoBatch);
    await runDriverDeferredScene(page);
    await runPrivacyBlockedScene(page, conn, scenario.demoBatch);
    await runExtensionRequestScene(page);
    await runAdminApprovalScene(page, scenario.demoBatch);
    await runDriverExtendedScene(page, scenario.demoBatch);

    const batchState = await loadBatchState(conn, scenario.demoBatch.batchId);
    await writeResultFile({
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      finalVideo: FINAL_VIDEO_FILE,
      rawVideo: RAW_VIDEO_FILE,
      batch: batchState,
      demoBatchUrl: scenario.demoBatch.url,
      customer: scenario.demoBatch.customer,
    });
  } finally {
    await context.close();
    await browser.close();
  }

  const videoPath = video ? await video.path() : '';
  if (!videoPath) {
    throw new Error('Nao foi possivel localizar o video bruto gerado pelo Playwright.');
  }

  await fs.copyFile(videoPath, RAW_VIDEO_FILE);
}

async function main() {
  await ensureDirs();
  await recordVideo();
  await renderFinalVideo();
  console.log(`Video final gerado em: ${FINAL_VIDEO_FILE}`);
}

main().catch((error) => {
  console.error('\nFalha ao gerar o video de personas.');
  console.error(error);
  process.exitCode = 1;
});
