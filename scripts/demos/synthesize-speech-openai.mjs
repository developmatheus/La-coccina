import fs from 'node:fs/promises';
import path from 'node:path';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : '';
}

async function main() {
  const inputTextFile = getArg('--input');
  const outputAudioFile = getArg('--output');
  const voice = getArg('--voice') || process.env.OPENAI_TTS_VOICE || 'alloy';
  const instructions = getArg('--instructions') || process.env.OPENAI_TTS_INSTRUCTIONS || 'Voz clara, natural, confiante e acolhedora para demonstracao comercial de software em portugues do Brasil.';
  const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
  const apiKey = process.env.OPENAI_API_KEY || '';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY nao configurada.');
  }
  if (!inputTextFile || !outputAudioFile) {
    throw new Error('Uso esperado: node synthesize-speech-openai.mjs --input <txt> --output <mp3>');
  }

  const text = (await fs.readFile(inputTextFile, 'utf8')).trim();
  if (!text) {
    throw new Error(`Arquivo de narracao vazio: ${inputTextFile}`);
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      format: 'mp3',
      instructions,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha no OpenAI TTS (${response.status}): ${body}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputAudioFile), { recursive: true });
  await fs.writeFile(outputAudioFile, bytes);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
