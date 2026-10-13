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

  let finalText = '';
  let interim = '';
  let recognition: SpeechRecognitionLike | null = null;
  let stopping = false;
  const Ctor = opts.live ? speechCtor() : null;
  if (Ctor) {
    recognition = new Ctor();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (ev) => {
      interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      opts.onLive((finalText + interim).trim());
    };
    recognition.onerror = () => {};
    // Safari/Chrome mobile encerram sozinhos após pausas: reinicia até o usuário parar.
    recognition.onend = () => {
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
      return { blob, liveText: (finalText + interim).trim() };
    },
  };
}

/** Transcrição via OpenAI Whisper (opcional, requer chave própria). */
export async function whisperTranscribe(blob: Blob, apiKey: string): Promise<string> {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', blob, `captura.${ext}`);
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper falhou (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { text: string }).text;
}
