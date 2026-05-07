import fs from 'fs';
import path from 'path';
import type { Orientation } from '@/types';

const IMAGEN_MODEL = 'imagen-4.0-generate-001';

export async function generateImagenImage(
  prompt: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

  const aspectRatio = orientation === 'vertical' ? '9:16' : '16:9';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Imagen API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
  };

  const prediction = data.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    throw new Error('Imagen returned no image data');
  }

  return {
    buffer: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
    mimeType: prediction.mimeType || 'image/png',
  };
}

export async function generateWithImagen(
  prompt: string,
  segmentId: string,
  orientation: Orientation,
): Promise<string> {
  const image = await generateImagenImage(prompt, orientation);

  const dir = path.join(process.cwd(), 'public', 'tmp', 'images');
  fs.mkdirSync(dir, { recursive: true });

  const ext = image.mimeType === 'image/png' ? 'png' : 'jpg';
  const filename = `${segmentId}.${ext}`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, image.buffer);

  return `/tmp/images/${filename}`;
}
