import fs from 'fs';
import path from 'path';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

type AssetRef = {
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sources: Set<string>;
};

type MigratedObject = {
  path: string;
  etag: string | null;
};

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function loadDotEnvLocal() {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    if (process.env[match[1]] != null) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function mimeFromPath(storagePath: string) {
  return MIME_BY_EXT[path.extname(storagePath).toLowerCase()] ?? 'application/octet-stream';
}

function parseArgs() {
  const execute = process.argv.includes('--execute');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;
  if (limitArg && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  return { dryRun: !execute, limit };
}

async function selectAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function upsertRef(refs: Map<string, AssetRef>, input: {
  storagePath: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  source: string;
}) {
  if (!input.storagePath) return;
  const existing = refs.get(input.storagePath);
  if (existing) {
    existing.mimeType ||= input.mimeType ?? null;
    existing.sizeBytes ||= input.sizeBytes ?? null;
    existing.sources.add(input.source);
    return;
  }
  refs.set(input.storagePath, {
    path: input.storagePath,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    sources: new Set([input.source]),
  });
}

async function objectHead(s3: S3Client, bucket: string, key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    const status = typeof err === 'object' && err && '$metadata' in err
      ? Number((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0)
      : 0;
    const name = typeof err === 'object' && err && 'name' in err ? String((err as { name?: string }).name) : '';
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

async function updateMigratedRows(
  supabase: ReturnType<typeof createClient<any>>,
  migratedObjects: MigratedObject[],
) {
  for (const object of migratedObjects) {
    const { error } = await (supabase as any)
      .from('video_assets')
      .update({
        storage_provider: 'r2',
        migrated_to_r2_at: new Date().toISOString(),
        r2_etag: object.etag,
      })
      .eq('storage_path', object.path);

    if (error) {
      console.warn(`[storage:migrate] DB metadata update skipped for ${object.path}: ${error.message}`);
    }
  }
}

async function main() {
  loadDotEnvLocal();
  const { dryRun, limit } = parseArgs();

  const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'video-assets';
  const r2Bucket = requiredEnv('R2_BUCKET');
  const supabase = createClient<any>(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
  const s3 = new S3Client({
    region: process.env.R2_REGION ?? 'auto',
    endpoint: requiredEnv('R2_ENDPOINT'),
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: true,
  });

  const refs = new Map<string, AssetRef>();

  const assets = await selectAll<{
    storage_path: string | null;
    mime_type: string | null;
    size_bytes: number | null;
  }>((from, to) => supabase
    .from('video_assets')
    .select('storage_path,mime_type,size_bytes')
    .range(from, to));

  for (const asset of assets) {
    upsertRef(refs, {
      storagePath: asset.storage_path,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      source: 'video_assets.storage_path',
    });
  }

  const videos = await selectAll<{
    final_video_path: string | null;
    thumbnail_path: string | null;
    final_video_mime_type: string | null;
    final_video_size_bytes: number | null;
  }>((from, to) => supabase
    .from('videos')
    .select('final_video_path,thumbnail_path,final_video_mime_type,final_video_size_bytes')
    .range(from, to));

  for (const video of videos) {
    upsertRef(refs, {
      storagePath: video.final_video_path,
      mimeType: video.final_video_mime_type,
      sizeBytes: video.final_video_size_bytes,
      source: 'videos.final_video_path',
    });
    upsertRef(refs, {
      storagePath: video.thumbnail_path,
      source: 'videos.thumbnail_path',
    });
  }

  const scheduledPosts = await selectAll<{
    video_storage_path: string | null;
    thumbnail_storage_path: string | null;
  }>((from, to) => supabase
    .from('scheduled_posts')
    .select('video_storage_path,thumbnail_storage_path')
    .range(from, to));

  for (const post of scheduledPosts) {
    upsertRef(refs, {
      storagePath: post.video_storage_path,
      source: 'scheduled_posts.video_storage_path',
    });
    upsertRef(refs, {
      storagePath: post.thumbnail_storage_path,
      source: 'scheduled_posts.thumbnail_storage_path',
    });
  }

  const allRefs = [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
  const selectedRefs = limit ? allRefs.slice(0, limit) : allRefs;
  const summary = {
    mode: dryRun ? 'dry-run' : 'execute',
    supabaseBucket,
    r2Bucket,
    discoveredObjects: allRefs.length,
    selectedObjects: selectedRefs.length,
    alreadyInR2: 0,
    wouldUpload: 0,
    uploaded: 0,
    missingInSupabase: 0,
    failed: 0,
    bytesUploaded: 0,
  };
  const migratedObjects: MigratedObject[] = [];

  for (const [index, ref] of selectedRefs.entries()) {
    const existing = await objectHead(s3, r2Bucket, ref.path);
    if (existing) {
      summary.alreadyInR2 += 1;
      migratedObjects.push({ path: ref.path, etag: existing.ETag ?? null });
      continue;
    }

    if (dryRun) {
      summary.wouldUpload += 1;
      continue;
    }

    const { data, error } = await supabase.storage.from(supabaseBucket).download(ref.path);
    if (error || !data) {
      summary.missingInSupabase += 1;
      console.warn(`[storage:migrate] Missing in Supabase: ${ref.path} (${error?.message ?? 'no data'})`);
      continue;
    }

    try {
      const buffer = Buffer.from(await data.arrayBuffer());
      const contentType = ref.mimeType ?? data.type ?? mimeFromPath(ref.path);
      const uploaded = await s3.send(new PutObjectCommand({
        Bucket: r2Bucket,
        Key: ref.path,
        Body: buffer,
        ContentType: contentType,
      }));
      summary.uploaded += 1;
      summary.bytesUploaded += buffer.byteLength;
      migratedObjects.push({ path: ref.path, etag: uploaded.ETag ?? null });
      console.log(`[storage:migrate] ${index + 1}/${selectedRefs.length} uploaded ${ref.path}`);
    } catch (err) {
      summary.failed += 1;
      console.warn(`[storage:migrate] Failed upload ${ref.path}:`, err);
    }
  }

  if (!dryRun && migratedObjects.length > 0) {
    await updateMigratedRows(supabase, migratedObjects);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[storage:migrate] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
