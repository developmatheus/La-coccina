import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : '';
}

async function main() {
  const inputTextFile = getArg('--input');
  const outputAudioFile = getArg('--output');
  const piperExe = getArg('--exe');
  const modelFile = getArg('--model');
  const configFile = getArg('--config');
  const espeakDataDir = getArg('--espeak-data');

  if (!inputTextFile || !outputAudioFile || !piperExe || !modelFile || !configFile || !espeakDataDir) {
    throw new Error('Uso esperado: node synthesize-speech-piper.mjs --input <txt> --output <wav> --exe <piper.exe> --model <onnx> --config <json> --espeak-data <dir>');
  }

  const text = (await fs.readFile(inputTextFile, 'utf8')).trim();
  if (!text) {
    throw new Error(`Arquivo de narração vazio: ${inputTextFile}`);
  }

  await fs.mkdir(path.dirname(outputAudioFile), { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawn(
      piperExe,
      [
        '--model',
        modelFile,
        '--config',
        configFile,
        '--espeak_data',
        espeakDataDir,
        '--output_file',
        outputAudioFile,
      ],
      {
        cwd: path.dirname(piperExe),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Piper finalizou com código ${code}: ${stderr}`));
      }
    });

    child.stdin.write(text, 'utf8');
    child.stdin.end();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
