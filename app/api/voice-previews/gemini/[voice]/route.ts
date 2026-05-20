import { NextResponse } from 'next/server';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
  _request: Request,
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
    await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
    const url = await getSignedUrl(
      r2.client,
      new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
      { expiresIn: 300 },
    );

    return NextResponse.redirect(url, 307);
  } catch {
    return NextResponse.json({ error: 'Voice preview was not found.' }, { status: 404 });
  }
}
