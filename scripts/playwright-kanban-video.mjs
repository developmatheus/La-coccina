import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'tutorial-playwright-kanban');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');
const SCENE_TEXT_DIR = path.join(OUTPUT_DIR, 'scene-text');
const SCENE_AUDIO_DIR = path.join(OUTPUT_DIR, 'scene-audio');
const NARRATION_FILE = path.join(OUTPUT_DIR, 'narracao.txt');
const SCRIPT_FILE = path.join(OUTPUT_DIR, 'roteiro.md');
const TIMINGS_FILE = path.join(OUTPUT_DIR, 'timings.json');
const RESULT_FILE = path.join(OUTPUT_DIR, 'resultado.json');
const RAW_VIDEO_FILE = path.join(OUTPUT_DIR, 'tutorial-raw.webm');
const FINAL_AUDIO_FILE = path.join(OUTPUT_DIR, 'narracao-final.wav');
const FINAL_VIDEO_FILE = path.join(OUTPUT_DIR, 'tutorial-playwright-kanban.mp4');

const scenes = [
  {
    id: 'dashboard-entry',
    title: 'Acesso ao painel',
    narration: 'Ao entrar no painel, a gestão já encontra uma leitura organizada da operação, com indicadores financeiros e operacionais logo na abertura.',
  },
  {
    id: 'dashboard-summary',
    title: 'Resumo do Dashboard',
    narration: 'Nesta visão, o Dashboard destaca venda bruta, receita entregue, valor cancelado, pedidos e ticket médio em um único bloco visual.',
  },
  {
    id: 'dashboard-breakdowns',
    title: 'Gráficos do Dashboard',
    narration: 'Logo abaixo, os painéis mostram formas de pagamento, status dos pedidos e a série diária, deixando claro o peso dos cancelamentos e o volume já entregue.',
  },
  {
    id: 'kanban-entry',
    title: 'Entrada no Kanban',
    narration: 'Ao abrir o Kanban, a operação aparece distribuída por etapa, com dez pedidos ativos circulando pelo quadro em tempo real.',
  },
  {
    id: 'kanban-new-orders',
    title: 'Novo Pedido',
    narration: 'A coluna Novo Pedido destaca o que acabou de entrar, ajudando a equipe a perceber prioridade, fila e entrada de demanda sem perder tempo.',
  },
  {
    id: 'kanban-flow',
    title: 'Fluxo em andamento',
    narration: 'Ao mesmo tempo, outros cards avançam entre produção, aguardando envio e a caminho, deixando claro onde a operação está concentrada naquele momento.',
  },
  {
    id: 'kanban-card-reading',
    title: 'Leitura do card',
    narration: 'Cada card resume cliente, endereço, itens, pagamento e valor total, facilitando a conferência rápida dentro do próprio quadro.',
  },
  {
    id: 'kanban-drawer',
    title: 'Drawer de detalhes',
    narration: 'Ao abrir um card, o painel lateral amplia os detalhes do pedido e concentra as ações operacionais de forma mais segura e objetiva.',
  },
  {
    id: 'kanban-navigation',
    title: 'Navegação entre cards',
    narration: 'A navegação entre cards permite revisar pedidos diferentes sem sair do contexto da operação, reduzindo troca de tela e perda de foco.',
  },
  {
    id: 'kanban-progress',
    title: 'Avanço de etapa',
    narration: 'Quando necessário, o card avança de etapa diretamente no fluxo, mantendo o quadro atualizado para cozinha, expedição e entrega.',
  },
  {
    id: 'kanban-delivery',
    title: 'Saída do Kanban',
    narration: 'Quando um pedido é marcado como entregue, ele sai do quadro operacional e deixa visível apenas o que ainda exige atenção da equipe.',
  },
  {
    id: 'dashboard-return',
    title: 'Retorno ao Dashboard',
    narration: 'De volta ao Dashboard, a ferramenta consolida um histórico amplo de pedidos, com entregues, cancelados, totais financeiros e indicadores para decisão rápida.',
  },
  {
    id: 'dashboard-table',
    title: 'Detalhes financeiros',
    narration: 'Com isso, a gestão acompanha resultado, perdas, ticket médio e a lista detalhada de pedidos no mesmo ambiente, sem depender de planilhas paralelas.',
  },
];

async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(SCENE_TEXT_DIR, { recursive: true });
  await fs.mkdir(SCENE_AUDIO_DIR, { recursive: true });
}

async function pause(page, seconds) {
  await page.waitForTimeout(seconds * 1000);
}

async function writeSupportFiles() {
  const narrationText = scenes.map((scene) => scene.narration).join(' ');
  await fs.writeFile(NARRATION_FILE, `${narrationText}\n`, 'utf8');

  const scriptMd = [
    '# Roteiro do Vídeo',
    '',
    ...scenes.flatMap((scene, index) => [
      `## Cena ${index + 1} - ${scene.title}`,
      `- Narração: ${scene.narration}`,
      '',
    ]),
  ].join('\n');
  await fs.writeFile(SCRIPT_FILE, scriptMd, 'utf8');
}

async function synthesizeSpeechFromFile(inputFile, outputFile) {
  const piperExe = path.join(process.cwd(), 'tools', 'piper', 'runtime', 'piper', 'piper.exe');
  const piperModel = path.join(process.cwd(), 'tools', 'piper', 'models', 'pt_BR-faber-medium.onnx');
  const piperConfig = path.join(process.cwd(), 'tools', 'piper', 'models', 'pt_BR-faber-medium.onnx.json');
  const piperEspeakData = path.join(process.cwd(), 'tools', 'piper', 'runtime', 'piper', 'espeak-ng-data');

  try {
    await fs.access(piperExe);
    await fs.access(piperModel);
    await fs.access(piperConfig);

    await execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'synthesize-speech-piper.mjs'),
        '--input',
        inputFile,
        '--output',
        outputFile,
        '--exe',
        piperExe,
        '--model',
        piperModel,
        '--config',
        piperConfig,
        '--espeak-data',
        piperEspeakData,
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
    );
    return outputFile;
  } catch (_error) {
    // Continua para outros provedores se o Piper local nao estiver disponivel.
  }

  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (openAiKey) {
    await execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'synthesize-speech-openai.mjs'),
        '--input',
        inputFile,
        '--output',
        outputFile,
        '--voice',
        process.env.OPENAI_TTS_VOICE || 'alloy',
        '--instructions',
        process.env.OPENAI_TTS_INSTRUCTIONS || 'Voz clara, natural, segura e elegante para demonstração profissional de software em português do Brasil.',
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
    );
    return outputFile;
  }

  await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(process.cwd(), 'scripts', 'synthesize-speech.ps1'),
      '-InputTextFile',
      inputFile,
      '-OutputAudioFile',
      outputFile,
      '-VoiceName',
      'Microsoft Maria Desktop',
      '-Rate',
      '-1',
    ],
    { cwd: process.cwd() },
  );
  return outputFile;
}

async function normalizeAudioFile(inputFile, outputFile) {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputFile,
      '-ac',
      '1',
      '-ar',
      '22050',
      outputFile,
    ],
    { cwd: process.cwd() },
  );
}

async function getMediaDurationSeconds(filePath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { cwd: process.cwd() },
  );

  const duration = Number(String(stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Não foi possível ler a duração de ${filePath}`);
  }
  return duration;
}

async function synthesizeNarration() {
  const sceneAssets = [];

  for (const [index, scene] of scenes.entries()) {
    const fileStem = `${String(index + 1).padStart(2, '0')}-${scene.id}`;
    const sceneTextFile = path.join(SCENE_TEXT_DIR, `${fileStem}.txt`);
    const sceneAudioRawFile = path.join(SCENE_AUDIO_DIR, `${fileStem}.raw.wav`);
    const sceneAudioFile = path.join(SCENE_AUDIO_DIR, `${fileStem}.wav`);

    await fs.writeFile(sceneTextFile, `${scene.narration}\n`, 'utf8');
    await synthesizeSpeechFromFile(sceneTextFile, sceneAudioRawFile);
    await normalizeAudioFile(sceneAudioRawFile, sceneAudioFile);
    const durationSeconds = await getMediaDurationSeconds(sceneAudioFile);

    sceneAssets.push({
      id: scene.id,
      title: scene.title,
      narration: scene.narration,
      audioFile: sceneAudioFile,
      durationSeconds,
    });
  }

  const concatListFile = path.join(OUTPUT_DIR, 'audio-concat.txt');
  const concatList = sceneAssets
    .map((asset) => {
      const relativePath = path.relative(OUTPUT_DIR, asset.audioFile).replace(/\\/g, '/');
      return `file '${relativePath.replace(/'/g, "'\\''")}'`;
    })
    .join('\n');
  await fs.writeFile(concatListFile, `${concatList}\n`, 'utf8');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListFile,
      '-c',
      'copy',
      FINAL_AUDIO_FILE,
    ],
    { cwd: OUTPUT_DIR },
  );

  await fs.writeFile(TIMINGS_FILE, JSON.stringify(sceneAssets, null, 2), 'utf8');
  return { audioFile: FINAL_AUDIO_FILE, sceneAssets };
}

async function renderFinalVideo(audioInputFile) {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      RAW_VIDEO_FILE,
      '-i',
      audioInputFile,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      FINAL_VIDEO_FILE,
    ],
    { cwd: process.cwd() },
  );
}

async function preparePresentationOrders() {
  const preparedJsonFile = path.join(OUTPUT_DIR, 'prepared-orders.json');
  const backendCwd = path.join(process.cwd(), 'backend');

  await execFileAsync(
    process.execPath,
    [path.join(backendCwd, 'scripts', 'migrate.js')],
    { cwd: backendCwd, maxBuffer: 1024 * 1024 * 4 },
  );

  await execFileAsync(
    process.execPath,
    [path.join(backendCwd, 'scripts', 'prepare-presentation-orders.js'), '--output', preparedJsonFile],
    { cwd: backendCwd, maxBuffer: 1024 * 1024 * 4 },
  );

  const parsed = JSON.parse(await fs.readFile(preparedJsonFile, 'utf8'));
  if (!parsed?.prefix || !Array.isArray(parsed?.waitingOrders) || !Array.isArray(parsed?.newOrders) || !Array.isArray(parsed?.productionOrders) || !parsed?.routeOrder) {
    throw new Error('Retorno inválido ao preparar pedidos de apresentação.');
  }
  return parsed;
}

async function loginAdminUi(page) {
  await page.goto(`${BASE_URL}/admin/login.html`, { waitUntil: 'domcontentloaded' });
  await pause(page, 1.2);
  await page.fill('#username', ADMIN_USERNAME);
  await pause(page, 0.3);
  await page.fill('#password', ADMIN_PASSWORD);
  await pause(page, 0.3);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await pause(page, 1.2);
}

async function openKanban(page) {
  await page.evaluate(() => {
    localStorage.setItem('lc_kanban_enabled', 'true');
  });
  await page.goto(`${BASE_URL}/admin/kanban.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#kb-board').waitFor({ timeout: 20000 });
}

async function waitForCard(page, customerName) {
  const card = page.locator('.kb-card').filter({ hasText: customerName }).first();
  await card.waitFor({ timeout: 20000 });
  await card.scrollIntoViewIfNeeded();
  return card;
}

async function closeDrawerIfOpen(page) {
  const closeButton = page.locator('.kd-close').first();
  if (await closeButton.count()) {
    await closeButton.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function ensureDashboard(page) {
  if (!/dashboard\.html/i.test(page.url())) {
    await page.locator('a.admin-utility-btn', { hasText: 'Dashboard' }).first().click();
    await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  }

  await page.locator('#finance-gross').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const gross = document.getElementById('finance-gross')?.textContent?.trim();
    const payment = document.getElementById('finance-payment-breakdown')?.textContent?.trim();
    return Boolean(gross && gross !== '-' && payment && !payment.includes('Carregando'));
  }, { timeout: 15000 });
}

function getScene(sceneMap, id) {
  const scene = sceneMap.get(id);
  if (!scene) {
    throw new Error(`Cena não encontrada: ${id}`);
  }
  return scene;
}

async function runTimedScene(page, sceneAsset, action) {
  const startedAt = Date.now();
  await action();
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const targetSeconds = Math.max(sceneAsset.durationSeconds + 0.5, 1.2);
  const remainingSeconds = targetSeconds - elapsedSeconds;
  if (remainingSeconds > 0.1) {
    await pause(page, remainingSeconds);
  }
}

async function showDashboardSummary(page) {
  await ensureDashboard(page);
  await page.locator('#finance-gross').scrollIntoViewIfNeeded();
  await pause(page, 0.8);
  await page.locator('#finance-cancelled').scrollIntoViewIfNeeded();
  await pause(page, 0.8);
}

async function showDashboardBreakdowns(page) {
  await ensureDashboard(page);
  await page.locator('#finance-payment-breakdown').scrollIntoViewIfNeeded();
  await pause(page, 1.0);
  await page.locator('#finance-status-breakdown').scrollIntoViewIfNeeded();
  await pause(page, 1.0);
  await page.locator('#finance-daily-series').scrollIntoViewIfNeeded();
  await pause(page, 1.2);
}

async function showDashboardDetails(page) {
  await ensureDashboard(page);
  await page.locator('#finance-daily-series').scrollIntoViewIfNeeded();
  await pause(page, 1.0);
  await page.locator('#finance-details-body').scrollIntoViewIfNeeded();
  await pause(page, 1.5);
  await page.locator('#finance-gross').scrollIntoViewIfNeeded();
  await pause(page, 0.8);
}

async function recordToolPresentation(page, scenario, sceneAssets) {
  const sceneMap = new Map(sceneAssets.map((asset) => [asset.id, asset]));

  await runTimedScene(page, getScene(sceneMap, 'dashboard-entry'), async () => {
    await ensureDashboard(page);
    await showDashboardSummary(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'dashboard-summary'), async () => {
    await showDashboardSummary(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'dashboard-breakdowns'), async () => {
    await showDashboardBreakdowns(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-entry'), async () => {
    await openKanban(page);
    await waitForCard(page, scenario.waitingOrders[0].customer);
    await waitForCard(page, scenario.newOrders[0].customer);
    await waitForCard(page, scenario.productionOrders[0].customer);
    await pause(page, 0.8);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-new-orders'), async () => {
    await waitForCard(page, scenario.newOrders[0].customer);
    await waitForCard(page, scenario.newOrders[1].customer);
    await pause(page, 0.8);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-flow'), async () => {
    await waitForCard(page, scenario.waitingOrders[1].customer);
    await waitForCard(page, scenario.productionOrders[0].customer);
    await waitForCard(page, scenario.routeOrder.customer);
    await pause(page, 0.8);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-card-reading'), async () => {
    const waitingCard = await waitForCard(page, scenario.waitingOrders[1].customer);
    await waitingCard.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
    await pause(page, 1.2);
    await closeDrawerIfOpen(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-drawer'), async () => {
    const secondWaitingCard = await waitForCard(page, scenario.waitingOrders[2].customer);
    await secondWaitingCard.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
    await pause(page, 1.4);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-navigation'), async () => {
    await closeDrawerIfOpen(page);
    const productionCard = await waitForCard(page, scenario.productionOrders[0].customer);
    await productionCard.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await closeDrawerIfOpen(page);
    const routeCardPreview = await waitForCard(page, scenario.routeOrder.customer);
    await routeCardPreview.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await closeDrawerIfOpen(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-progress'), async () => {
    const newCard = await waitForCard(page, scenario.newOrders[0].customer);
    await newCard.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
    await pause(page, 0.8);
    await page.locator('.kd-action-btn.primary').first().click();
    await page.waitForTimeout(1200);
    await closeDrawerIfOpen(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'kanban-delivery'), async () => {
    const routeCard = await waitForCard(page, scenario.routeOrder.customer);
    await routeCard.click();
    await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
    await pause(page, 0.8);
    await page.locator('.kd-action-btn.primary').first().click();
    await page.waitForTimeout(1500);
    await closeDrawerIfOpen(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#kb-board').waitFor({ timeout: 20000 });
    await page.locator('.kb-card').filter({ hasText: scenario.routeOrder.customer }).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  });

  await runTimedScene(page, getScene(sceneMap, 'dashboard-return'), async () => {
    await ensureDashboard(page);
    await showDashboardBreakdowns(page);
  });

  await runTimedScene(page, getScene(sceneMap, 'dashboard-table'), async () => {
    await showDashboardDetails(page);
  });
}

async function recordFlow(sceneAssets) {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    slowMo: Number(process.env.SLOW_MO || 120) || 120,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    recordVideo: {
      dir: RAW_DIR,
      size: { width: 1440, height: 960 },
    },
  });

  const page = await context.newPage();
  const video = page.video();

  try {
    const scenario = await preparePresentationOrders();

    await loginAdminUi(page);
    await recordToolPresentation(page, scenario, sceneAssets);

    const result = {
      demoPrefix: scenario.prefix,
      waitingOrders: scenario.waitingOrders,
      newOrders: scenario.newOrders,
      productionOrders: scenario.productionOrders,
      routeOrder: scenario.routeOrder,
      deliveredOrders: scenario.deliveredOrders || [],
      cancelledOrders: scenario.cancelledOrders || [],
      finalVideo: FINAL_VIDEO_FILE,
      audioFile: '',
      timingsFile: TIMINGS_FILE,
      subtitleMode: 'disabled',
    };

    await fs.writeFile(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
  } finally {
    await context.close();
    await browser.close();
  }

  const videoPath = video ? await video.path() : '';
  if (!videoPath) {
    throw new Error('Não foi possível localizar o vídeo bruto gerado pelo Playwright.');
  }

  await fs.copyFile(videoPath, RAW_VIDEO_FILE);
}

async function main() {
  await ensureDirs();
  await writeSupportFiles();
  const { audioFile, sceneAssets } = await synthesizeNarration();
  await recordFlow(sceneAssets);
  await renderFinalVideo(audioFile);

  const result = JSON.parse(await fs.readFile(RESULT_FILE, 'utf8'));
  result.audioFile = audioFile;
  result.finalVideo = FINAL_VIDEO_FILE;
  await fs.writeFile(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');

  console.log(`Vídeo final gerado em: ${FINAL_VIDEO_FILE}`);
}

main().catch((error) => {
  console.error('\nFalha ao gerar o vídeo instrutivo do Kanban.');
  console.error(error);
  process.exitCode = 1;
});
