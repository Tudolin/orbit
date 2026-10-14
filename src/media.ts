import type { CaptureImage } from './db';

const MAX_EDGE = 1568; // borda máxima que a API usa sem redimensionar

/** Reduz a imagem para MAX_EDGE e converte em JPEG base64 (prints de tela ficam legíveis). */
export async function imageToCapture(file: Blob): Promise<CaptureImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export function imageSrc(img: CaptureImage): string {
  return `data:${img.mediaType};base64,${img.data}`;
}

// ---------- Áudio ----------

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

/**
 * Junta os resultados de uma sessão. Desktop: cada resultado é um trecho novo.
 * Android: cada resultado repete o anterior e acrescenta palavras ("a", "a b", "a b c").
 * Um resultado que começa com o anterior o substitui; um contido no anterior é ignorado.
 */
export function joinResults(results: ArrayLike<{ 0: { transcript: string } }>): string {
  return mergeSegments(Array.from({ length: results.length }, (_, i) => results[i][0].transcript));
}

/** Junta trechos descartando os que só repetem ou estendem o anterior (resultados cumulativos). */
export function mergeSegments(segments: string[]): string {
  const parts: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  for (const raw of segments) {
    const t = raw.trim();
    if (!t) continue;
    const last = parts[parts.length - 1];
    if (last !== undefined && norm(t).startsWith(norm(last))) parts[parts.length - 1] = t;
    else if (last !== undefined && norm(last).startsWith(norm(t))) continue;
    else parts.push(t);
  }
  return parts.join(' ');
}

export const speechSupported = () => speechCtor() !== null;
export const recorderSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export interface Recording {
  stop(): Promise<{ blob: Blob | null; liveText: string }>;
}

/**
 * Grava áudio (para Whisper) e, se disponível, transcreve ao vivo com Web Speech.
 * onLive recebe o texto parcial a cada atualização.
 */
export async function startRecording(opts: { record: boolean; live: boolean; onLive: (t: string) => void }): Promise<Recording> {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  const chunks: Blob[] = [];

  if (opts.record) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
  }

  // Texto das sessões de reconhecimento já encerradas + texto da sessão atual.
  const sessions: string[] = [];
  let current = '';
  const full = () => mergeSegments([...sessions, current]);
  let recognition: SpeechRecognitionLike | null = null;
  let stopping = false;
  const Ctor = opts.live ? speechCtor() : null;
  if (Ctor) {
    recognition = new Ctor();
    recognition.lang = 'pt-BR';
    // No Android o modo contínuo devolve resultados cumulativos e duplica o texto;
    // lá cada sessão captura uma fala e reiniciamos ao final.
    recognition.continuous = !/android/i.test(navigator.userAgent);
    recognition.interimResults = true;
    recognition.onresult = (ev) => {
      // Recalcula a sessão inteira a cada evento (não confia em resultIndex, que varia entre navegadores).
      current = joinResults(ev.results);
      opts.onLive(full());
    };
    recognition.onerror = () => {};
    // O reconhecimento encerra sozinho após pausas: guarda o texto da sessão e reinicia até o usuário parar.
    recognition.onend = () => {
      // Junta também entre sessões: há aparelhos que repetem a frase anterior ao reiniciar.
      if (current) sessions.push(current);
      current = '';
      if (!stopping) {
        try {
          recognition!.start();
        } catch {
          /* já iniciado */
        }
      }
    };
    recognition.start();
  }

  return {
    async stop() {
      stopping = true;
      recognition?.stop();
      let blob: Blob | null = null;
      if (recorder) {
        await new Promise<void>((res) => {
          recorder!.onstop = () => res();
          recorder!.stop();
        });
        blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        stream?.getTracks().forEach((t) => t.stop());
      }
      return { blob, liveText: full() };
    },
  };
}

const WHISPER_BLOCKED =
  'A OpenAI recusou a requisição ou a rede bloqueou. Confira em Config se a chave da OpenAI é válida (começa com "sk-", não "sk-ant-") e tem crédito, ou se uma VPN/bloqueador está barrando api.openai.com.';

/** Valida a forma da chave antes de usar (erro comum: colar a chave da Anthropic no campo da OpenAI). */
export function openaiKeyProblem(key: string): string | null {
  if (!key) return null;
  if (key.startsWith('sk-ant-')) return 'Essa é uma chave da Anthropic. O campo do Whisper precisa de uma chave da OpenAI (platform.openai.com).';
  if (!key.startsWith('sk-')) return 'Chave da OpenAI inválida: ela começa com "sk-".';
  return null;
}

/** Testa a chave da OpenAI. Erros de autenticação chegam ao navegador como falha de rede (sem CORS). */
export async function testOpenAIKey(apiKey: string): Promise<void> {
  const problem = openaiKeyProblem(apiKey);
  if (problem) throw new Error(problem);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new Error(WHISPER_BLOCKED);
  }
  if (!res.ok) throw new Error(`OpenAI respondeu ${res.status}. Verifique a chave e o crédito.`);
}

/** Transcrição via OpenAI Whisper (opcional, requer chave própria). */
export async function whisperTranscribe(blob: Blob, apiKey: string): Promise<string> {
  const problem = openaiKeyProblem(apiKey);
  if (problem) throw new Error(problem);
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', blob, `captura.${ext}`);
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new Error(WHISPER_BLOCKED);
  }
  if (!res.ok) throw new Error(`Whisper falhou (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { text: string }).text;
}
