import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
process.env.DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'backend', 'data', 'lacoccina.db');
const db = require('../backend/db');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
let ADMIN_TOKEN_CACHE = '';
let SESSION_SECRET_CACHE = '';

const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'playwright-local-service-video');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');
const SCENE_TEXT_DIR = path.join(OUTPUT_DIR, 'scene-text');
const SCENE_AUDIO_DIR = path.join(OUTPUT_DIR, 'scene-audio');
const RAW_VIDEO_FILE = path.join(OUTPUT_DIR, 'local-service-demo-raw.webm');
const FINAL_AUDIO_FILE = path.join(OUTPUT_DIR, 'narracao-final.wav');
const FINAL_VIDEO_FILE = path.join(OUTPUT_DIR, 'local-service-demo.mp4');
const TIMINGS_FILE = path.join(OUTPUT_DIR, 'timings.json');
const RESULT_FILE = path.join(OUTPUT_DIR, 'resultado.json');
const SCRIPT_FILE = path.join(OUTPUT_DIR, 'roteiro.md');
const SUBTITLE_FILE = path.join(OUTPUT_DIR, 'legendas-local.srt');
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const WINDOW_WIDTH = 1920;
const WINDOW_HEIGHT = 1280;

const DEMO = {
  tables: [
    { name: 'Mesa Varanda 03', sector: 'Varanda', seats: 4, sortOrder: 3 },
    { name: 'Mesa Interna 05', sector: 'Salão', seats: 4, sortOrder: 5 },
    { name: 'Mesa Jardim 01', sector: 'Jardim', seats: 2, sortOrder: 1 },
  ],
  waiters: [
    { name: 'Lucas Martins', code: 'LM', sortOrder: 1 },
    { name: 'Ana Paula Lima', code: 'APL', sortOrder: 2 },
    { name: 'Fernanda Rocha', code: 'FR', sortOrder: 3 },
  ],
  draftCustomer: {
    customer: 'Beatriz Oliveira',
    phone: '48999123456',
    payment: 'pix',
    commandCode: 'V03-021',
    obs: 'Cliente no salão, prefere atendimento rápido e água sem gelo.',
  },
  existingCustomer: {
    customer: 'Rafael Mendes',
    phone: '48999887766',
    payment: 'cartao',
    commandCode: 'S05-018',
    obs: 'Comanda já aberta para demonstrar retomada de atendimento.',
  },
};

const scenes = [
  {
    id: 'intro-title',
    title: 'Fluxo de atendimento local',
    heading: 'Fluxo de Atendimento Local',
    subheading: 'Mesa, garçom, pedido, cozinha e fechamento da conta',
    narration: 'Nesta apresentação, vamos acompanhar o fluxo completo do atendimento local da La Coccina.',
    kind: 'transition',
    minDurationSeconds: 3.8,
  },
  {
    id: 'login-admin',
    title: 'Acesso administrativo',
    narration: 'Começamos pelo acesso administrativo, com a tela de login centralizada e pronta para a equipe entrar no sistema.',
    kind: 'content',
    minDurationSeconds: 10.5,
  },
  {
    id: 'transition-dashboard',
    title: 'Área do dashboard',
    heading: 'Agora vamos para a área do Dashboard',
    subheading: 'Indicadores gerais e atalhos da operação',
    narration: 'Agora vamos para a área do Dashboard.',
    kind: 'transition',
    minDurationSeconds: 3.3,
  },
  {
    id: 'dashboard-entry',
    title: 'Visão do dashboard',
    narration: 'No Dashboard, a operação acompanha números gerais e acessa rapidamente os módulos mais importantes do sistema.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
  {
    id: 'transition-settings',
    title: 'Cadastros e configurações',
    heading: 'Vamos então para Cadastros e Configurações',
    subheading: 'Parâmetros do atendimento local, mesas e garçons',
    narration: 'Vamos então para a área de cadastros e configurações do atendimento local.',
    kind: 'transition',
    minDurationSeconds: 3.5,
  },
  {
    id: 'cadastros-local',
    title: 'Configuração local',
    narration: 'Em Cadastros, o módulo local mostra mesas, garçons e regras operacionais configuradas para uso real no salão.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
  {
    id: 'transition-waiter-tool',
    title: 'Ferramenta do garçom',
    heading: 'Indo agora para a tela da ferramenta do Garçom',
    subheading: 'Comandas abertas, mesa, garçom e lançamento de itens',
    narration: 'Indo agora para a tela da ferramenta do garçom.',
    kind: 'transition',
    minDurationSeconds: 3.5,
  },
  {
    id: 'pwa-overview',
    title: 'Visão da ferramenta do garçom',
    narration: 'Nesta tela, a equipe visualiza as comandas abertas, escolhe mesa e garçom e lança os itens do pedido com rapidez.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
  {
    id: 'open-command',
    title: 'Abertura da comanda',
    narration: 'Aqui a comanda é aberta em nome de Beatriz Oliveira, vinculando a mesa varanda zero três e o garçom Lucas Martins.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
  {
    id: 'add-more-items',
    title: 'Mais itens na mesma comanda',
    narration: 'Depois, a mesma comanda é retomada para lançar novos itens sem perder o histórico do atendimento.',
    kind: 'content',
    minDurationSeconds: 10.0,
  },
  {
    id: 'transition-kanban',
    title: 'Painel de pedidos',
    heading: 'Vamos então para o Painel de Pedidos',
    subheading: 'Kanban operacional da cozinha',
    narration: 'Vamos então para o Painel de Pedidos, o kanban operacional da cozinha.',
    kind: 'transition',
    minDurationSeconds: 3.7,
  },
  {
    id: 'kanban-local-order',
    title: 'Leitura no painel de pedidos',
    narration: 'No Painel de Pedidos, mantemos a visão no topo para acompanhar os títulos das colunas e identificar onde cada pedido está no fluxo.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
  {
    id: 'kanban-progress',
    title: 'Evolução do pedido na cozinha',
    narration: 'Aqui fazemos um arraste real do pedido entre colunas e depois seguimos até pronto para servir, mantendo a operação alinhada com o salão.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
  {
    id: 'transition-close-command',
    title: 'Fechamento na ferramenta do garçom',
    heading: 'Voltando para a ferramenta do Garçom',
    subheading: 'Fechamento da conta na comanda do cliente',
    narration: 'Voltando agora para a ferramenta do garçom, vamos concluir o atendimento e fechar a conta da cliente.',
    kind: 'transition',
    minDurationSeconds: 3.6,
  },
  {
    id: 'close-command',
    title: 'Fechamento da conta',
    narration: 'Com os itens servidos, a equipe volta à ferramenta do garçom para fechar a conta diretamente na comanda da cliente.',
    kind: 'content',
    minDurationSeconds: 10.0,
  },
  {
    id: 'transition-dashboard-results',
    title: 'Retorno ao dashboard',
    heading: 'Retornando ao Dashboard',
    subheading: 'Resultado consolidado do atendimento local',
    narration: 'Para encerrar, retornamos ao Dashboard para acompanhar o resultado consolidado do atendimento local.',
    kind: 'transition',
    minDurationSeconds: 3.5,
  },
  {
    id: 'dashboard-results',
    title: 'Resultado no Dashboard',
    narration: 'No fim, o Dashboard consolida o impacto do atendimento local nos indicadores por canal, sem separar o salão do restante da operação.',
    kind: 'content',
    minDurationSeconds: 12.0,
  },
];

function escArg(value) {
  return String(value).replace(/'/g, "'\\''");
}

async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(SCENE_TEXT_DIR, { recursive: true });
  await fs.mkdir(SCENE_AUDIO_DIR, { recursive: true });
}

async function pause(page, seconds) {
  await page.waitForTimeout(seconds * 1000);
}

async function ensureVideoSafeFrame(page) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    if (document.documentElement) {
      document.documentElement.style.scrollBehavior = 'auto';
      document.documentElement.style.overflowX = 'hidden';
    }
  }).catch(() => {});
  await page.waitForTimeout(120);
}

function getSceneTargetSeconds(scene) {
  const paddingSeconds = scene.kind === 'transition' ? 0.9 : 0.75;
  const minDuration = Number(scene.minDurationSeconds || 0);
  const durationSeconds = Number(scene.durationSeconds || 0);
  const computed = Number(Math.max(durationSeconds + paddingSeconds, minDuration || 0).toFixed(3));
  const hardCap = Number(scene.maxDurationSeconds ?? (scene.kind === 'transition' ? 10 : 25));
  const safeCap = Number(Math.max(hardCap, durationSeconds + paddingSeconds).toFixed(3));
  if (Number.isFinite(safeCap) && safeCap > 0) {
    return Number(Math.min(computed, safeCap).toFixed(3));
  }
  return computed;
}

function formatSubtitleTimestamp(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds || 0));
  const hours = String(Math.floor(safe / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
  const seconds = String(Math.floor(safe % 60)).padStart(2, '0');
  const millis = String(Math.round((safe % 1) * 1000)).padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${millis}`;
}

async function createSubtitleFile(sceneAssets) {
  let timelineCursor = 0;
  const blocks = sceneAssets.map((scene, index) => {
    const startSeconds = timelineCursor + 0.18;
    const endSeconds = timelineCursor + Math.max(Number(scene.durationSeconds || 0), 0.8);
    timelineCursor += Number(scene.targetDurationSeconds || 0);
    return [
      String(index + 1),
      `${formatSubtitleTimestamp(startSeconds)} --> ${formatSubtitleTimestamp(endSeconds)}`,
      scene.narration,
      '',
    ].join('\n');
  });
  await fs.writeFile(SUBTITLE_FILE, blocks.join('\n'), 'utf8');
}

async function showTransitionOverlay(page, scene) {
  const heading = scene.heading || scene.title || 'La Coccina';
  const subheading = scene.subheading || '';
  await page.evaluate(({ headingText, subheadingText }) => {
    const existing = document.getElementById('__pw_transition_overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = '__pw_transition_overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'grid';
    overlay.style.placeItems = 'center';
    overlay.style.padding = '72px';
    overlay.style.background =
      'radial-gradient(circle at top, rgba(217, 119, 6, 0.32), transparent 30%), linear-gradient(160deg, #09090b 0%, #111827 55%, #0f172a 100%)';
    overlay.style.zIndex = '999999';

    const card = document.createElement('div');
    card.style.width = 'min(100%, 1220px)';
    card.style.padding = '56px 64px';
    card.style.borderRadius = '36px';
    card.style.border = '1px solid rgba(255, 255, 255, 0.10)';
    card.style.background = 'rgba(15, 23, 42, 0.75)';
    card.style.boxShadow = '0 30px 90px rgba(0, 0, 0, 0.42)';
    card.style.textAlign = 'center';
    card.style.backdropFilter = 'blur(20px)';
    card.style.color = '#f8fafc';
    card.style.fontFamily = 'Inter, Arial, sans-serif';

    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'La Coccina';
    eyebrow.style.display = 'inline-block';
    eyebrow.style.marginBottom = '18px';
    eyebrow.style.color = '#d97706';
    eyebrow.style.fontSize = '20px';
    eyebrow.style.fontWeight = '800';
    eyebrow.style.letterSpacing = '0.18em';
    eyebrow.style.textTransform = 'uppercase';

    const title = document.createElement('h1');
    title.textContent = headingText;
    title.style.margin = '0';
    title.style.fontSize = '64px';
    title.style.lineHeight = '1.08';
    title.style.fontWeight = '800';

    const subtitle = document.createElement('p');
    subtitle.textContent = subheadingText;
    subtitle.style.margin = '22px auto 0';
    subtitle.style.maxWidth = '900px';
    subtitle.style.color = 'rgba(248, 250, 252, 0.80)';
    subtitle.style.fontSize = '28px';
    subtitle.style.lineHeight = '1.45';
    subtitle.style.fontWeight = '500';

    card.appendChild(eyebrow);
    card.appendChild(title);
    if (subheadingText) card.appendChild(subtitle);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }, { headingText: heading, subheadingText: subheading });
  await page.waitForTimeout(220);
}

async function hideTransitionOverlay(page) {
  await page.evaluate(() => {
    document.getElementById('__pw_transition_overlay')?.remove();
  }).catch(() => {});
}

async function moveMouseToLocator(page, locator, holdSeconds = 0.7) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  await page.mouse.move(
    box.x + Math.max(24, Math.min(box.width * 0.45, box.width - 24)),
    box.y + Math.max(18, Math.min(box.height * 0.45, box.height - 18)),
    { steps: 16 },
  );
  await pause(page, holdSeconds);
}

async function smoothWindowScroll(page, totalDeltaY, steps = 4, holdSeconds = 0.5) {
  const stepDelta = totalDeltaY / Math.max(steps, 1);
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, stepDelta);
    await pause(page, holdSeconds);
  }
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
  return `${id}-${crypto.randomBytes(6).toString('hex')}`;
}

function applyPronunciationHints(text) {
  return String(text || '')
    .replace(/\bLa Coccina\b/g, 'La Cotchina')
    .replace(/\bDashboard\b/g, 'Déshbórd')
    .replace(/\bdashboard\b/g, 'déshbórd');
}

function parseDotEnvValue(contents, key) {
  const lines = String(contents || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    if (k !== key) continue;
    let v = trimmed.slice(idx + 1).trim();
    const wasQuoted =
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"));
    if (!wasQuoted) {
      v = v.split(/\s+#/)[0].trim();
    }
    if (wasQuoted) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return '';
}

async function getSessionSecret() {
  if (SESSION_SECRET_CACHE) return SESSION_SECRET_CACHE;
  if (process.env.SESSION_SECRET && String(process.env.SESSION_SECRET).length) {
    SESSION_SECRET_CACHE = String(process.env.SESSION_SECRET);
    return SESSION_SECRET_CACHE;
  }
  try {
    const envPath = path.join(process.cwd(), 'backend', 'config', '.env');
    const contents = await fs.readFile(envPath, 'utf8');
    const found = parseDotEnvValue(contents, 'SESSION_SECRET');
    if (found) {
      SESSION_SECRET_CACHE = found;
      return SESSION_SECRET_CACHE;
    }
  } catch {}
  SESSION_SECRET_CACHE = 'defina-SESSION_SECRET-no-env';
  return SESSION_SECRET_CACHE;
}

function createSignedToken(secret, scope, ttlMs) {
  const payload = Buffer.from(JSON.stringify({
    scope,
    exp: Date.now() + ttlMs,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function writeSupportFiles() {
  const scriptMd = [
    '# Roteiro do vídeo local',
    '',
    ...scenes.flatMap((scene, index) => [
      `## Cena ${index + 1} - ${scene.title}`,
      scene.heading ? `- Título em tela: ${scene.heading}` : null,
      scene.subheading ? `- Apoio visual: ${scene.subheading}` : null,
      `- Narração: ${scene.narration}`,
      '',
    ].filter(Boolean)),
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
  } catch {}

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
        process.env.OPENAI_TTS_INSTRUCTIONS || 'Voz clara, natural e confiante para vídeo de demonstração de software em português do Brasil.',
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
    ['-y', '-i', inputFile, '-ac', '1', '-ar', '22050', outputFile],
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
    const stem = `${String(index + 1).padStart(2, '0')}-${scene.id}`;
    const textFile = path.join(SCENE_TEXT_DIR, `${stem}.txt`);
    const rawAudioFile = path.join(SCENE_AUDIO_DIR, `${stem}.raw.wav`);
    const audioFile = path.join(SCENE_AUDIO_DIR, `${stem}.wav`);

    await fs.writeFile(textFile, `${applyPronunciationHints(scene.spokenNarration || scene.narration)}\n`, 'utf8');
    await synthesizeSpeechFromFile(textFile, rawAudioFile);
    await normalizeAudioFile(rawAudioFile, audioFile);
    const durationSeconds = await getMediaDurationSeconds(audioFile);

    sceneAssets.push({
      ...scene,
      audioFile,
      durationSeconds,
      targetDurationSeconds: 0,
    });
  }

  for (const scene of sceneAssets) {
    scene.targetDurationSeconds = getSceneTargetSeconds(scene);
  }

  return sceneAssets;
}

async function padAndConcatNarration(sceneAssets) {
  for (const scene of sceneAssets) {
    const paddedAudioFile = path.join(
      SCENE_AUDIO_DIR,
      `${String(scene.id).replace(/[^a-z0-9_-]+/gi, '_')}.padded.wav`,
    );
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        scene.audioFile,
        '-af',
        `apad=pad_dur=${Math.max(scene.targetDurationSeconds - scene.durationSeconds, 0).toFixed(3)}`,
        '-t',
        String(scene.targetDurationSeconds),
        paddedAudioFile,
      ],
      { cwd: process.cwd() },
    );
    scene.paddedAudioFile = paddedAudioFile;
  }

  const concatFile = path.join(OUTPUT_DIR, 'audio-concat.txt');
  const concatBody = sceneAssets
    .map((asset) => `file '${path.relative(OUTPUT_DIR, asset.paddedAudioFile).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(concatFile, `${concatBody}\n`, 'utf8');

  await execFileAsync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', FINAL_AUDIO_FILE],
    { cwd: OUTPUT_DIR },
  );

  await createSubtitleFile(sceneAssets);
  await fs.writeFile(TIMINGS_FILE, JSON.stringify(sceneAssets, null, 2), 'utf8');
}

async function renderFinalVideo(audioInputFile) {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-fflags',
      '+genpts',
      '-i',
      RAW_VIDEO_FILE,
      '-i',
      audioInputFile,
      '-filter_complex',
      `[0:v]setpts=PTS-STARTPTS,subtitles=legendas-local.srt:force_style='FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80111111,BackColour=&H50000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=18,Alignment=2'[v];` +
        `[1:a]asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '25',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      path.basename(FINAL_VIDEO_FILE),
    ],
    { cwd: OUTPUT_DIR },
  );
}

async function runMigrations() {
  const backendCwd = path.join(process.cwd(), 'backend');
  await execFileAsync(
    process.execPath,
    [path.join(backendCwd, 'scripts', 'migrate.js')],
    { cwd: backendCwd, maxBuffer: 1024 * 1024 * 4 },
  );
}

async function ensureConfig(conn, key, value) {
  await conn.run(
    'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
    [key, String(value)],
  );
}

async function ensureDemoProducts(conn) {
  const row = await conn.get('SELECT COUNT(*) AS total FROM products WHERE active = 1');
  if (Number(row?.total || 0) > 0) {
    const products = await conn.all(
      `SELECT id, name, price, category
         FROM products
        WHERE active = 1
        ORDER BY isDailySpecial DESC, created_at DESC, id DESC
        LIMIT 3`
    );
    return products.map((product) => ({
      id: Number(product.id),
      name: product.name,
      price: Number(product.price || 0),
      category: product.category || 'outros',
    }));
  }

  const samples = [
    { name: 'Filé de Frango Grelhado', price: 33.9, desc: 'Prato executivo com frango grelhado e acompanhamentos.', category: 'marmita' },
    { name: 'Contra Filé Acebolado', price: 37.9, desc: 'Carne acebolada servida com arroz e feijão.', category: 'marmita' },
    { name: 'Refrigerante Lata', price: 6.5, desc: 'Bebida gelada para acompanhar o pedido.', category: 'bebida' },
  ];

  const created = [];
  for (const sample of samples) {
    const result = await conn.run(
      'INSERT INTO products (name, price, `desc`, image, category, active, isDailySpecial) VALUES (?, ?, ?, ?, ?, 1, 0)',
      [sample.name, sample.price, sample.desc, '', sample.category],
    );
    created.push({
      id: Number(result.lastID),
      name: sample.name,
      price: sample.price,
      category: sample.category,
    });
  }
  return created;
}

async function ensureTable(conn, table) {
  const existing = await conn.get('SELECT id FROM service_tables WHERE name = ?', [table.name]);
  if (existing?.id) {
    await conn.run(
      'UPDATE service_tables SET sector = ?, seats = ?, active = 1, sort_order = ? WHERE id = ?',
      [table.sector, table.seats, table.sortOrder, existing.id],
    );
    return Number(existing.id);
  }
  const result = await conn.run(
    'INSERT INTO service_tables (name, sector, seats, active, sort_order) VALUES (?, ?, ?, 1, ?)',
    [table.name, table.sector, table.seats, table.sortOrder],
  );
  return Number(result.lastID);
}

async function ensureWaiter(conn, waiter) {
  const existing = await conn.get('SELECT id FROM service_waiters WHERE name = ?', [waiter.name]);
  if (existing?.id) {
    await conn.run(
      'UPDATE service_waiters SET code = ?, active = 1, sort_order = ? WHERE id = ?',
      [waiter.code, waiter.sortOrder, existing.id],
    );
    return Number(existing.id);
  }
  const result = await conn.run(
    'INSERT INTO service_waiters (name, code, active, sort_order) VALUES (?, ?, 1, ?)',
    [waiter.name, waiter.code, waiter.sortOrder],
  );
  return Number(result.lastID);
}

async function deleteDemoOrders(conn) {
  await conn.run(
    `DELETE FROM orders
      WHERE service_channel = 'local'
        AND (command_code IN (?, ?) OR customer IN (?, ?))`,
    [
      DEMO.draftCustomer.commandCode,
      DEMO.existingCustomer.commandCode,
      DEMO.draftCustomer.customer,
      DEMO.existingCustomer.customer,
    ],
  );
}

async function insertLocalOrder(conn, { customer, phone, payment, obs, commandCode, tableId, waiterId, item, total, status, localServiceStatus }) {
  const now = new Date();
  const createdAt = formatSqliteDate(new Date(now.getTime() - 18 * 60000));
  const updatedAt = formatSqliteDate(new Date(now.getTime() - 6 * 60000));
  const result = await conn.run(
    `INSERT INTO orders (
      customer, address, phone, payment, total, items, obs, status, kanban_order, order_token,
      service_channel, table_id, waiter_id, command_code, local_service_status, opened_at,
      served_at, closed_at, closed_payment_method, closed_total, service_tag_color, created_at, updated_at
    ) VALUES (?, '', ?, ?, ?, ?, ?, ?, 0, '', 'local', ?, ?, ?, ?, ?, NULL, NULL, '', 0, ?, ?, ?)`,
    [
      customer,
      phone,
      payment,
      total,
      JSON.stringify([item]),
      obs,
      status,
      tableId,
      waiterId,
      commandCode,
      localServiceStatus,
      createdAt,
      '#d97706',
      createdAt,
      updatedAt,
    ],
  );
  const orderId = Number(result.lastID);
  await conn.run('UPDATE orders SET order_token = ? WHERE id = ?', [createToken(orderId), orderId]);
  return orderId;
}

async function setupLocalDemoState() {
  await runMigrations();
  const conn = await db.raw();

  await ensureConfig(conn, 'localServiceEnabled', 'true');
  await ensureConfig(conn, 'localServiceLabel', 'Atendimento Local');
  await ensureConfig(conn, 'localServiceColor', '#d97706');
  await ensureConfig(conn, 'kanbanLocalHighlightMode', 'full');
  await ensureConfig(conn, 'kanbanDeliveryHighlightMode', 'border');
  await ensureConfig(conn, 'localReadyColumnEnabled', 'true');
  await ensureConfig(conn, 'localCommandPrefix', 'SAL');
  await ensureConfig(conn, 'localAutoGenerateCommandCode', 'false');
  await ensureConfig(conn, 'localRequireWaiter', 'true');
  await ensureConfig(conn, 'localRequireTable', 'true');
  await ensureConfig(conn, 'localAllowTableTransfer', 'true');
  await ensureConfig(conn, 'localAllowSplitPayment', 'false');
  await ensureConfig(conn, 'localPwaDisplayMode', 'confortavel');
  await ensureConfig(conn, 'localPwaPrimaryAccent', '#d97706');

  const [varandaId, salaoId, jardimId] = await Promise.all(DEMO.tables.map((table) => ensureTable(conn, table)));
  const [lucasId, anaPaulaId] = await Promise.all(DEMO.waiters.slice(0, 2).map((waiter) => ensureWaiter(conn, waiter)));
  await ensureWaiter(conn, DEMO.waiters[2]);

  const products = await ensureDemoProducts(conn);
  if (products.length < 2) {
    throw new Error('Não foi possível garantir produtos ativos suficientes para o vídeo local.');
  }

  await deleteDemoOrders(conn);
  const seededOrderId = await insertLocalOrder(conn, {
    customer: DEMO.existingCustomer.customer,
    phone: DEMO.existingCustomer.phone,
    payment: DEMO.existingCustomer.payment,
    obs: DEMO.existingCustomer.obs,
    commandCode: DEMO.existingCustomer.commandCode,
    tableId: salaoId,
    waiterId: anaPaulaId,
    item: {
      id: products[0].id,
      name: products[0].name,
      price: products[0].price,
      qty: 1,
    },
    total: Number(products[0].price || 0),
    status: 'em_producao',
    localServiceStatus: 'aguardando_preparo',
  });

  return {
    products,
    tables: { varandaId, salaoId, jardimId },
    waiters: { lucasId, anaPaulaId },
    seededOrderId,
  };
}

async function showAdminLoginScreen(page) {
  await page.goto(`${BASE_URL}/admin/login.html`, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('.login-box').waitFor({ timeout: 15000 });
  await pause(page, 0.8);
  await page.locator('#username').waitFor({ timeout: 15000 });
  await page.fill('#username', ADMIN_USERNAME);
  await pause(page, 0.3);
  await page.fill('#password', ADMIN_PASSWORD);
  await pause(page, 0.3);
}

async function ensureAdminSessionToken(page) {
  if (!ADMIN_TOKEN_CACHE) {
    const secret = await getSessionSecret();
    ADMIN_TOKEN_CACHE = createSignedToken(secret, 'admin', 4 * 60 * 60 * 1000);
  }
  const token = ADMIN_TOKEN_CACHE;
  await page.context().addInitScript((sessionToken) => {
    try {
      if (location && location.origin) {
        sessionStorage.setItem('adminToken', sessionToken);
        localStorage.setItem('adminLogged', 'true');
      }
    } catch {}
  }, token);
  await page.evaluate((sessionToken) => {
    sessionStorage.setItem('adminToken', sessionToken);
    localStorage.setItem('adminLogged', 'true');
  }, token);
}

async function runTimedScene(page, sceneAsset, action) {
  const startedAt = Date.now();
  await action();
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const targetSeconds = Number(sceneAsset.targetDurationSeconds || sceneAsset.durationSeconds || 1.2);
  const remainingSeconds = targetSeconds - elapsedSeconds;
  if (remainingSeconds > 0.1) {
    await pause(page, remainingSeconds);
  }
}

function sceneById(sceneAssets, id) {
  const asset = sceneAssets.find((scene) => scene.id === id);
  if (!asset) throw new Error(`Cena não encontrada: ${id}`);
  return asset;
}

async function openToolPanel(page) {
  await page.locator('#btn-tool-panel').click();
  await page.locator('#tool-panel:not([hidden])').waitFor({ timeout: 10000 });
}

async function gotoAdminPage(page, fileName) {
  const targetUrl = `${BASE_URL}/admin/${fileName}`;
  const needsLogin = async () => {
    if (page.url().includes('/admin/login.html')) return true;
    const loginField = page.locator('#username');
    const visible = await loginField.isVisible().catch(() => false);
    return visible;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await ensureVideoSafeFrame(page);
    await page.waitForTimeout(300);
    if (!(await needsLogin())) break;
    await showAdminLoginScreen(page);
    await ensureAdminSessionToken(page);
  }
}

async function openLocalService(page) {
  await page.goto(`${BASE_URL}/local-service.html`, { waitUntil: 'domcontentloaded' });
  await ensureVideoSafeFrame(page);
  await page.locator('#app-shell').waitFor({ timeout: 20000 });
  await page.locator('#products .product-card').first().waitFor({ timeout: 20000 });
}

async function addProductByName(page, name) {
  const card = page.locator('.product-card').filter({ hasText: name }).first();
  await card.waitFor({ timeout: 15000 });
  await card.locator('button', { hasText: 'Adicionar' }).click();
  await page.waitForTimeout(500);
}

async function submitLocalOrder(page, form) {
  await page.fill('#customer-name', form.customer);
  await page.fill('#command-code', form.commandCode);
  await page.selectOption('#table-select', String(form.tableId));
  await page.selectOption('#waiter-select', String(form.waiterId));
  await page.selectOption('#payment-select', form.payment);
  await page.fill('#phone-input', form.phone);
  await page.fill('#obs-input', form.obs);
  await page.getByRole('button', { name: 'Enviar para cozinha' }).click();
  await page.waitForTimeout(1800);
}

async function openKanban(page) {
  await page.evaluate(() => {
    localStorage.setItem('lc_kanban_enabled', 'true');
  });
  await gotoAdminPage(page, 'kanban.html');
  await page.locator('#kb-board').waitFor({ timeout: 20000 });
}

async function waitForKanbanCard(page, customerName) {
  const card = page.locator('.kb-card').filter({ hasText: customerName }).first();
  await card.waitFor({ timeout: 20000 });
  await card.scrollIntoViewIfNeeded();
  return card;
}

async function showKanbanColumnTitles(page) {
  const board = page.locator('#kb-board');
  await board.waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    const boardEl = document.getElementById('kb-board');
    if (boardEl) boardEl.scrollLeft = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  });
  await pause(page, 0.8);
  await page.evaluate(() => {
    const boardEl = document.getElementById('kb-board');
    if (boardEl) boardEl.scrollLeft = Math.max(0, Math.round(boardEl.scrollWidth * 0.28));
  });
  await pause(page, 1.0);
  await page.evaluate(() => {
    const boardEl = document.getElementById('kb-board');
    if (boardEl) boardEl.scrollLeft = 0;
  });
  await pause(page, 0.8);
}

async function dragKanbanOrder(page, customerName, targetColumnKey) {
  const card = await waitForKanbanCard(page, customerName);
  const targetColumn = page.locator(`.kb-col-body[data-col="${targetColumnKey}"]`).first();
  await targetColumn.waitFor({ timeout: 15000 });

  const cardBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!cardBox || !targetBox) {
    throw new Error('Não foi possível calcular a área para arrastar o pedido no Painel de Pedidos.');
  }

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + Math.min(cardBox.height / 2, 60));
  await pause(page, 0.2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 110, { steps: 18 });
  await pause(page, 0.2);
  await page.mouse.up();
  await page.waitForTimeout(1800);
}

async function moveOrderFromDrawer(page, customerName) {
  const card = await waitForKanbanCard(page, customerName);
  await card.click();
  await page.locator('#kb-detail-drawer.open').waitFor({ timeout: 10000 });
  await page.locator('.kd-action-btn.primary').first().click();
  await page.waitForTimeout(1600);
}

async function closeCommandInPwa(page, customerName) {
  const commandCard = page.locator('.command-card').filter({ hasText: customerName }).first();
  await commandCard.waitFor({ timeout: 15000 });
  await commandCard.click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Fechar conta' }).click();
  await page.waitForTimeout(1800);
}

async function recordLocalFlow(page, sceneAssets, scenario) {
  await showAdminLoginScreen(page);

  await runTimedScene(page, sceneById(sceneAssets, 'intro-title'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'intro-title'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'login-admin'), async () => {
    await ensureVideoSafeFrame(page);
    await moveMouseToLocator(page, page.locator('#username'), 0.9);
    await moveMouseToLocator(page, page.locator('#password'), 0.9);
    await moveMouseToLocator(page, page.getByRole('button', { name: 'Entrar' }), 1.0);
    await ensureAdminSessionToken(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'transition-dashboard'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'transition-dashboard'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'dashboard-entry'), async () => {
    await gotoAdminPage(page, 'dashboard.html');
    try {
      await page.locator('#finance-gross').waitFor({ timeout: 20000, state: 'attached' });
    } catch (err) {
      const url = page.url();
      throw new Error(`Falha ao abrir dashboard (url atual: ${url}). ${err?.message || err}`);
    }
    await page.locator('#finance-gross').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#finance-gross'), 1.0);
    await pause(page, 0.8);
    const localAccessButton = page.locator('#btn-local-service-link');
    if (await localAccessButton.isVisible().catch(() => false)) {
      await moveMouseToLocator(page, localAccessButton, 1.0);
      await pause(page, 0.8);
    } else {
      await page.locator('#finance-channel-breakdown').scrollIntoViewIfNeeded();
      await moveMouseToLocator(page, page.locator('#finance-channel-breakdown'), 1.0);
      await pause(page, 0.8);
    }
    await smoothWindowScroll(page, 420, 4, 0.55);
    await moveMouseToLocator(page, page.locator('#finance-waiter-breakdown'), 1.0);
    await smoothWindowScroll(page, -420, 4, 0.45);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'transition-settings'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'transition-settings'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'cadastros-local'), async () => {
    await gotoAdminPage(page, 'cadastros.html');
    await openToolPanel(page);
    await page.locator('#cfg-local-service-enabled').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#cfg-local-service-enabled'), 0.9);
    await pause(page, 0.8);
    await page.locator('#cfg-local-command-prefix').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#cfg-local-command-prefix'), 0.9);
    await pause(page, 0.8);
    await page.locator('#cfg-service-tables-body').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#cfg-service-tables-body'), 1.1);
    await pause(page, 1.0);
    await page.locator('#cfg-service-waiters-body').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#cfg-service-waiters-body'), 1.1);
    await pause(page, 1.0);
    await smoothWindowScroll(page, -280, 3, 0.45);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'transition-waiter-tool'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'transition-waiter-tool'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'pwa-overview'), async () => {
    await openLocalService(page);
    await moveMouseToLocator(page, page.locator('#summary-card, .summary-grid').first(), 0.9);
    await page.locator('#open-orders').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#open-orders'), 1.0);
    await page.locator('.command-card').filter({ hasText: DEMO.existingCustomer.customer }).first().scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('.command-card').filter({ hasText: DEMO.existingCustomer.customer }).first(), 1.0);
    await page.locator('#products').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#products .product-card').first(), 1.0);
    await smoothWindowScroll(page, 240, 3, 0.4);
    await smoothWindowScroll(page, -240, 3, 0.4);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'open-command'), async () => {
    await page.getByRole('button', { name: 'Nova comanda' }).click();
    await moveMouseToLocator(page, page.locator('#customer-name'), 0.7);
    await addProductByName(page, scenario.products[0].name);
    await addProductByName(page, scenario.products[1].name);
    await moveMouseToLocator(page, page.locator('#draft-items'), 1.0);
    await submitLocalOrder(page, {
      customer: DEMO.draftCustomer.customer,
      commandCode: DEMO.draftCustomer.commandCode,
      tableId: scenario.tables.varandaId,
      waiterId: scenario.waiters.lucasId,
      payment: DEMO.draftCustomer.payment,
      phone: DEMO.draftCustomer.phone,
      obs: DEMO.draftCustomer.obs,
    });
    await moveMouseToLocator(page, page.locator('#open-orders').locator('.command-card').filter({ hasText: DEMO.draftCustomer.customer }).first(), 1.0);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'add-more-items'), async () => {
    const beatrizCard = page.locator('.command-card').filter({ hasText: DEMO.draftCustomer.customer }).first();
    await beatrizCard.waitFor({ timeout: 15000 });
    await beatrizCard.click();
    await moveMouseToLocator(page, beatrizCard, 0.9);
    await pause(page, 0.8);
    await addProductByName(page, scenario.products[2]?.name || scenario.products[0].name);
    await moveMouseToLocator(page, page.locator('#draft-items'), 1.0);
    await page.getByRole('button', { name: 'Enviar para cozinha' }).click();
    await page.waitForTimeout(1800);
    await moveMouseToLocator(page, page.locator('#sticky-title'), 1.0);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'transition-kanban'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'transition-kanban'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'kanban-local-order'), async () => {
    await openKanban(page);
    await showKanbanColumnTitles(page);
    const orderCard = await waitForKanbanCard(page, DEMO.draftCustomer.customer);
    await moveMouseToLocator(page, page.locator('.kb-col-header').first(), 0.9);
    await moveMouseToLocator(page, orderCard, 1.0);
    await pause(page, 1.0);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'kanban-progress'), async () => {
    await dragKanbanOrder(page, DEMO.draftCustomer.customer, 'em_producao');
    await showKanbanColumnTitles(page);
    await moveMouseToLocator(page, page.locator('.kb-col-body[data-col="em_producao"]'), 1.0);
    await moveOrderFromDrawer(page, DEMO.draftCustomer.customer);
    await waitForKanbanCard(page, DEMO.draftCustomer.customer);
    await moveMouseToLocator(page, page.locator('.kb-col-body[data-col="pronto_para_servir"]'), 1.0);
    await pause(page, 0.8);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'transition-close-command'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'transition-close-command'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'close-command'), async () => {
    await openLocalService(page);
    await moveMouseToLocator(page, page.locator('.command-card').filter({ hasText: DEMO.draftCustomer.customer }).first(), 1.0);
    await closeCommandInPwa(page, DEMO.draftCustomer.customer);
    await moveMouseToLocator(page, page.locator('#sync-status'), 1.0);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'transition-dashboard-results'), async () => {
    await showTransitionOverlay(page, sceneById(sceneAssets, 'transition-dashboard-results'));
    await pause(page, 0.4);
    await hideTransitionOverlay(page);
  });

  await runTimedScene(page, sceneById(sceneAssets, 'dashboard-results'), async () => {
    await gotoAdminPage(page, 'dashboard.html');
    await page.locator('#finance-local-total').waitFor({ timeout: 20000, state: 'attached' });
    await page.locator('#finance-local-total').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#finance-local-total'), 1.0);
    await pause(page, 0.9);
    await page.locator('#finance-channel-breakdown').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#finance-channel-breakdown'), 1.0);
    await pause(page, 1.0);
    await page.locator('#finance-waiter-breakdown').scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, page.locator('#finance-waiter-breakdown'), 1.0);
    await smoothWindowScroll(page, -320, 3, 0.45);
    await pause(page, 1.2);
  });
}

async function recordVideo(sceneAssets) {
  const scenario = await setupLocalDemoState();
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    slowMo: Number(process.env.SLOW_MO || 120) || 120,
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
    await recordLocalFlow(page, sceneAssets, scenario);
    await fs.writeFile(
      RESULT_FILE,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        finalVideo: FINAL_VIDEO_FILE,
        rawVideo: RAW_VIDEO_FILE,
        draftCustomer: DEMO.draftCustomer.customer,
        existingCustomer: DEMO.existingCustomer.customer,
        table: DEMO.tables[0].name,
        waiter: DEMO.waiters[0].name,
        products: scenario.products.map((item) => item.name),
      }, null, 2),
      'utf8',
    );
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
  const sceneAssets = await synthesizeNarration();
  await recordVideo(sceneAssets);
  await padAndConcatNarration(sceneAssets);
  await renderFinalVideo(FINAL_AUDIO_FILE);
  console.log(`Vídeo final gerado em: ${FINAL_VIDEO_FILE}`);
}

main().catch((error) => {
  console.error('\nFalha ao gerar o vídeo do fluxo local.');
  console.error(error);
  process.exitCode = 1;
});
