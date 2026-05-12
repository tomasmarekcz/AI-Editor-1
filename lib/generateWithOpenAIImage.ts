import fs from 'fs';
import path from 'path';
import type { Orientation } from '@/types';

export const OPENAI_IMAGE_MODEL = 'gpt-image-2-2026-04-21';
export const OPENAI_IMAGE_QUALITY = 'low';
const DEFAULT_IMAGE_MIN_INTERVAL_MS = 15_000;
const OPENAI_IMAGE_MAX_RETRIES = 8;

let imageQueue: Promise<unknown> = Promise.resolve();
let lastImageRequestAt = 0;

export function openAIImageSizeForOrientation(orientation: Orientation) {
  return orientation === 'vertical' ? '1024x1536' : '1536x1024';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageMinIntervalMs() {
  const value = Number(process.env.OPENAI_IMAGE_MIN_INTERVAL_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_IMAGE_MIN_INTERVAL_MS;
}

async function waitForImageRateSlot() {
  const elapsed = Date.now() - lastImageRequestAt;
  const delay = Math.max(0, imageMinIntervalMs() - elapsed);
  if (delay > 0) await sleep(delay);
  lastImageRequestAt = Date.now();
}

function retryDelayFromError(body: string, retryAfter: string | null) {
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }

  const match = body.match(/try again in\s+(\d+(?:\.\d+)?)s/i);
  if (match) {
    return Math.ceil(Number(match[1]) * 1000);
  }

  return imageMinIntervalMs();
}

function enqueueImageGeneration<T>(task: () => Promise<T>) {
  const run = imageQueue.then(task, task);
  imageQueue = run.catch(() => undefined);
  return run;
}

async function callOpenAIImageApi(prompt: string, size: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= OPENAI_IMAGE_MAX_RETRIES; attempt += 1) {
    await waitForImageRateSlot();

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt,
        size,
        quality: OPENAI_IMAGE_QUALITY,
        n: 1,
      }),
    });

    if (res.ok) return res;

    const body = await res.text();
    lastError = new Error(`OpenAI image API error ${res.status}: ${body.slice(0, 300)}`);

    if (res.status !== 429 || attempt === OPENAI_IMAGE_MAX_RETRIES) {
      throw lastError;
    }

    const delay = Math.max(retryDelayFromError(body, res.headers.get('retry-after')), imageMinIntervalMs());
    await sleep(delay + 500);
  }

  throw lastError ?? new Error('OpenAI image API failed');
}

export async function generateOpenAIImage(
  prompt: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string; size: string; quality: string }> {
  const size = openAIImageSizeForOrientation(orientation);

  return enqueueImageGeneration(async () => {
    const res = await callOpenAIImageApi(prompt, size);
    const data = await res.json() as {
      data?: { b64_json?: string; url?: string }[];
    };

    const image = data.data?.[0];
    if (image?.b64_json) {
      return {
        buffer: Buffer.from(image.b64_json, 'base64'),
        mimeType: 'image/png',
        size,
        quality: OPENAI_IMAGE_QUALITY,
      };
    }

    if (image?.url) {
      const imageRes = await fetch(image.url);
      if (!imageRes.ok) {
        throw new Error(`OpenAI image download error ${imageRes.status}`);
      }
      const contentType = imageRes.headers.get('content-type') || 'image/png';
      return {
        buffer: Buffer.from(await imageRes.arrayBuffer()),
        mimeType: contentType,
        size,
        quality: OPENAI_IMAGE_QUALITY,
      };
    }

    throw new Error('OpenAI image API returned no image data');
  });
}

export async function generateWithOpenAIImage(
  prompt: string,
  segmentId: string,
  orientation: Orientation,
): Promise<string> {
  const image = await generateOpenAIImage(prompt, orientation);

  const dir = path.join(process.cwd(), 'public', 'tmp', 'images');
  fs.mkdirSync(dir, { recursive: true });

  const ext = image.mimeType.includes('jpeg') || image.mimeType.includes('jpg') ? 'jpg' : 'png';
  const filename = `${segmentId}.${ext}`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, image.buffer);

  return `/tmp/images/${filename}`;
}
