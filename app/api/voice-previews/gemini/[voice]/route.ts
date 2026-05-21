import { NextResponse } from 'next/server';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GEMINI_TTS_VOICES, type GeminiTTSVoice } from '@/lib/geminiTtsPresets';

export const runtime = 'nodejs';

const VALID_VOICES = new Set<GeminiTTSVoice>(GEMINI_TTS_VOICES.map((voice) => voice.id));

let r2Client: S3Client | null = null;

function getR2Client() {
  const bucket = process.env.R2_VOICE_PREVIEW_BUCKET || 'ai-editor-voice-previews';
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;

  if (!r2Client) {
    r2Client = new S3Client({
      region: process.env.R2_REGION ?? 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  return { client: r2Client, bucket };
}

export async function GET(
  request: Request,
  { params }: { params: { voice: string } },
) {
  const voice = decodeURIComponent(params.voice) as GeminiTTSVoice;
  if (!VALID_VOICES.has(voice)) {
    return NextResponse.json({ error: 'Unknown Gemini voice.' }, { status: 404 });
  }

  const r2 = getR2Client();
  if (!r2) {
    return NextResponse.json({ error: 'Voice preview storage is not configured.' }, { status: 503 });
  }

  const key = `gemini/${voice}.mp3`;

  try {
    const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
    const body = object.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) {
      return NextResponse.json({ error: 'Voice preview could not be read.' }, { status: 502 });
    }

    const buffer = Buffer.from(await body.transformToByteArray());
    const range = request.headers.get('range');
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': object.ContentType ?? 'audio/mpeg',
    };

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const requestedEnd = match?.[2] ? Number(match[2]) : buffer.byteLength - 1;
      const end = Math.min(requestedEnd, buffer.byteLength - 1);

      if (start >= buffer.byteLength || end < start) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes */${buffer.byteLength}`,
          },
        });
      }

      const chunk = buffer.subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(chunk.byteLength),
          'Content-Range': `bytes ${start}-${end}/${buffer.byteLength}`,
        },
      });
    }

    return new NextResponse(buffer, {
      headers: {
        ...baseHeaders,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Voice preview was not found.' }, { status: 404 });
  }
}
