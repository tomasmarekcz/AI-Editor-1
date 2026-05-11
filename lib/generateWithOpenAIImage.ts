import fs from 'fs';
import path from 'path';
import type { Orientation } from '@/types';

export const OPENAI_IMAGE_MODEL = 'gpt-image-2-2026-04-21';
export const OPENAI_IMAGE_QUALITY = 'low';

export function openAIImageSizeForOrientation(orientation: Orientation) {
  return orientation === 'vertical' ? '1024x1536' : '1536x1024';
}

export async function generateOpenAIImage(
  prompt: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string; size: string; quality: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const size = openAIImageSizeForOrientation(orientation);
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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI image API error ${res.status}: ${body.slice(0, 300)}`);
  }

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
