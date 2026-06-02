import fs from 'fs';
import path from 'path';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

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

function parseArgs() {
  const execute = process.argv.includes('--execute');
  return { dryRun: !execute };
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

async function objectExistsInR2(s3: S3Client, bucket: string, key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = typeof err === 'object' && err && '$metadata' in err
      ? Number((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0)
      : 0;
    const name = typeof err === 'object' && err && 'name' in err ? String((err as { name?: string }).name) : '';
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false;
    throw err;
  }
}

async function main() {
  loadDotEnvLocal();
  const { dryRun } = parseArgs();

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

  const migratedAssets = await selectAll<{
    storage_path: string | null;
  }>((from, to) => supabase
    .from('video_assets')
    .select('storage_path')
    .eq('storage_provider', 'r2')
    .range(from, to));
  const objects = [...new Set(
    migratedAssets
      .map((asset) => asset.storage_path)
      .filter((value): value is string => Boolean(value)),
  )];
  const candidates: string[] = [];
  const summary = {
    mode: dryRun ? 'dry-run' : 'execute',
    supabaseBucket,
    r2Bucket,
    discoveredObjects: objects.length,
    missingInR2: 0,
    deletable: 0,
    deleted: 0,
    failed: 0,
  };

  for (const object of objects) {
    const existsInR2 = await objectExistsInR2(s3, r2Bucket, object);
    if (!existsInR2) {
      summary.missingInR2 += 1;
      continue;
    }
    candidates.push(object);
  }

  summary.deletable = candidates.length;

  if (!dryRun && candidates.length > 0) {
    for (let i = 0; i < candidates.length; i += 100) {
      const batch = candidates.slice(i, i + 100);
      const { error } = await supabase.storage.from(supabaseBucket).remove(batch);
      if (error) {
        summary.failed += batch.length;
        console.warn(`[storage:cleanup] remove batch failed (${batch[0]})`, error.message);
        continue;
      }
      summary.deleted += batch.length;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[storage:cleanup] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
