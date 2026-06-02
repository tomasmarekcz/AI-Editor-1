import fs from 'fs';
import path from 'path';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const VIDEO_ASSETS_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'video-assets';
const DEFAULT_VIDEO_BUCKET_LIMIT_BYTES = 300 * 1024 * 1024;

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

export function storageBasePath(userId: string, projectId: string, videoId: string) {
  return `users/${userId}/projects/${projectId}/videos/${videoId}`;
}

export function publicLocalPathToAbsolute(localPath: string) {
  const normalized = localPath.startsWith('/') ? localPath.slice(1) : localPath;
  return path.join(process.cwd(), 'public', normalized);
}

export function mimeFromPath(filePath: string) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageStatus(err: unknown) {
  const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status?: number }).status) : 0;
  const statusCode = typeof err === 'object' && err && 'statusCode' in err ? Number((err as { statusCode?: string | number }).statusCode) : 0;
  const httpStatusCode = typeof err === 'object' && err && '$metadata' in err
    ? Number((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0)
    : 0;
  return { status, statusCode, httpStatusCode };
}

function isNotFound(err: unknown) {
  const { status, statusCode, httpStatusCode } = storageStatus(err);
  const name = typeof err === 'object' && err && 'name' in err ? String((err as { name?: string }).name) : '';
  return status === 404 || statusCode === 404 || httpStatusCode === 404 || name === 'NotFound' || name === 'NoSuchKey';
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const { status, statusCode } = storageStatus(err);
      if (status === 413 || statusCode === 413) break;
      if (attempt === attempts) break;
      const delay = 500 * attempt * attempt;
      console.warn(`[storage] ${label} failed on attempt ${attempt}/${attempts}, retrying in ${delay}ms`, err);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function createStorageAdminClient() {
  return createSupabaseAdminClient();
}

type R2Config = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type StorageProvider = 'supabase' | 'r2';

let r2Client: S3Client | null = null;

function storageProvider() {
  return (process.env.STORAGE_PROVIDER ?? 'supabase').toLowerCase();
}

export function currentStorageProvider(): StorageProvider {
  return isR2Selected() ? 'r2' : 'supabase';
}

function fallbackProvider() {
  return (process.env.STORAGE_FALLBACK_PROVIDER ?? '').toLowerCase();
}

function isR2Selected() {
  return storageProvider() === 'r2';
}

function getR2Config(): R2Config | null {
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    endpoint,
    region: process.env.R2_REGION ?? 'auto',
    accessKeyId,
    secretAccessKey,
  };
}

function getR2Client() {
  const config = getR2Config();
  if (!config) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return { client: r2Client, config };
}

function useR2Primary() {
  return isR2Selected() && !!getR2Config();
}

function useSupabaseFallback() {
  return fallbackProvider() === 'supabase' || !isR2Selected();
}

function shouldBlockSupabaseFallback() {
  return isR2Selected() && fallbackProvider() !== 'supabase';
}

async function r2AssetExists(storagePath: string) {
  const r2 = getR2Client();
  if (!r2) return false;
  try {
    await r2.client.send(new HeadObjectCommand({
      Bucket: r2.config.bucket,
      Key: storagePath,
    }));
    return true;
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn(`[storage:r2] head ${storagePath} failed`, err);
    }
    return false;
  }
}

async function uploadBufferAssetToR2(storagePath: string, buffer: Buffer, contentType: string) {
  const r2 = getR2Client();
  if (!r2) throw new Error('R2 storage is selected, but R2 env is incomplete.');
  await r2.client.send(new PutObjectCommand({
    Bucket: r2.config.bucket,
    Key: storagePath,
    Body: buffer,
    ContentType: contentType,
  }));
}

async function downloadR2AssetBlob(storagePath: string) {
  const r2 = getR2Client();
  if (!r2) return null;
  try {
    const result = await r2.client.send(new GetObjectCommand({
      Bucket: r2.config.bucket,
      Key: storagePath,
    }));
    const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) return null;
    const bytes = await body.transformToByteArray();
    return new Blob([Buffer.from(bytes)], {
      type: result.ContentType ?? mimeFromPath(storagePath),
    });
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn(`[storage:r2] download ${storagePath} failed`, err);
    }
    return null;
  }
}

async function createR2SignedUrl(storagePath: string, expiresIn: number) {
  const r2 = getR2Client();
  if (!r2) return null;
  const exists = await r2AssetExists(storagePath);
  if (!exists) return null;
  return getSignedUrl(
    r2.client,
    new GetObjectCommand({
      Bucket: r2.config.bucket,
      Key: storagePath,
    }),
    { expiresIn },
  );
}

async function listR2Prefix(storagePrefix: string) {
  const r2 = getR2Client();
  if (!r2) return [];

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await r2.client.send(new ListObjectsV2Command({
      Bucket: r2.config.bucket,
      Prefix: storagePrefix.endsWith('/') ? storagePrefix : `${storagePrefix}/`,
      ContinuationToken: continuationToken,
    }));
    for (const item of result.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function deleteR2Assets(storagePaths: string[]) {
  const r2 = getR2Client();
  if (!r2 || storagePaths.length === 0) return;

  for (let i = 0; i < storagePaths.length; i += 1000) {
    const batch = storagePaths.slice(i, i + 1000);
    if (batch.length === 1) {
      try {
        await r2.client.send(new DeleteObjectCommand({
          Bucket: r2.config.bucket,
          Key: batch[0],
        }));
      } catch (err) {
        if (!isNotFound(err)) console.warn(`[storage:r2] delete ${batch[0]} failed`, err);
      }
      continue;
    }

    await r2.client.send(new DeleteObjectsCommand({
      Bucket: r2.config.bucket,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
        Quiet: true,
      },
    }));
  }
}

async function ensureVideoBucketLimit(requiredBytes: number) {
  if (useR2Primary()) return;
  const admin = createStorageAdminClient();
  if (!admin) {
    console.warn('[storage] SUPABASE_SERVICE_ROLE_KEY missing; cannot auto-update bucket file size limit.');
    return;
  }

  const fileSizeLimit = Math.max(
    DEFAULT_VIDEO_BUCKET_LIMIT_BYTES,
    Math.ceil(requiredBytes * 1.25),
  );

  const { error } = await admin.storage.updateBucket(VIDEO_ASSETS_BUCKET, {
    public: false,
    fileSizeLimit,
  });

  if (error) {
    const { status, statusCode } = storageStatus(error);
    if (status === 413 || statusCode === 413) {
      console.warn(
        `[storage] ${VIDEO_ASSETS_BUCKET} file size limit update was rejected at ${fileSizeLimit} bytes; continuing with the existing bucket limit.`,
      );
      return;
    }
    console.warn(`[storage] Could not update ${VIDEO_ASSETS_BUCKET} file size limit to ${fileSizeLimit} bytes`, error);
  }
}

export async function uploadBufferAsset({
  supabase,
  userId,
  projectId,
  videoId,
  folder,
  filename,
  buffer,
  contentType,
}: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  videoId: string;
  folder: string;
  filename: string;
  buffer: Buffer;
  contentType: string;
}) {
  const storagePath = `${storageBasePath(userId, projectId, videoId)}/${folder}/${filename}`;
  const provider = currentStorageProvider();
  if (isR2Selected()) {
    if (!useR2Primary()) {
      throw new Error('STORAGE_PROVIDER=r2 is selected, but R2 env is incomplete. Refusing to upload to Supabase fallback.');
    }
    await withRetry(
      () => uploadBufferAssetToR2(storagePath, buffer, contentType),
      `r2 upload ${storagePath}`,
    );
  } else {
    const { error } = await withRetry(
      async () => {
        const result = await supabase.storage
          .from(VIDEO_ASSETS_BUCKET)
          .upload(storagePath, buffer, {
            contentType,
            upsert: true,
          });
        if (result.error) throw result.error;
        return result;
      },
      `supabase upload ${storagePath}`,
    );
    if (error) throw error;
  }

  return { storagePath, sizeBytes: buffer.byteLength, mimeType: contentType, storageProvider: provider };
}

export async function uploadLocalAsset({
  supabase,
  userId,
  projectId,
  videoId,
  folder,
  localPath,
  filename,
}: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  videoId: string;
  folder: string;
  localPath: string;
  filename?: string;
}) {
  const absPath = localPath.startsWith('/tmp/')
    ? publicLocalPathToAbsolute(localPath)
    : localPath;
  const stat = fs.statSync(absPath);
  const mimeType = mimeFromPath(absPath);
  if (mimeType.startsWith('video/')) {
    await ensureVideoBucketLimit(stat.size);
  }
  const buffer = fs.readFileSync(absPath);
  const finalFilename = filename ?? path.basename(absPath);
  const uploaded = await uploadBufferAsset({
    supabase,
    userId,
    projectId,
    videoId,
    folder,
    filename: finalFilename,
    buffer,
    contentType: mimeType,
  });

  return { ...uploaded, sizeBytes: stat.size, mimeType };
}

export async function createSignedUrl(
  supabase: SupabaseClient,
  storagePath: string | null,
  expiresIn = Number(process.env.R2_SIGNED_URL_EXPIRES_SECONDS ?? 3600) || 3600,
) {
  if (!storagePath) return null;

  if (isR2Selected()) {
    if (!useR2Primary()) {
      console.warn(`[storage:r2] signed-url ${storagePath} skipped because R2 env is incomplete.`);
      return null;
    }
    const signedUrl = await createR2SignedUrl(storagePath, expiresIn);
    if (signedUrl) return signedUrl;
    if (shouldBlockSupabaseFallback()) return null;
  }

  const admin = createStorageAdminClient();

  if (admin) {
    const adminResult = await admin.storage
      .from(VIDEO_ASSETS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (!adminResult.error && adminResult.data?.signedUrl) {
      return adminResult.data.signedUrl;
    }
    const { status, statusCode } = storageStatus(adminResult.error);
    if (status !== 404 && statusCode !== 404) {
      console.warn(`[storage] signed-url ${storagePath} failed`, adminResult.error);
    }
  }

  try {
    const result = await supabase.storage
      .from(VIDEO_ASSETS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (result.error) {
      const { status, statusCode } = storageStatus(result.error);
      if (status === 404 || statusCode === 404) return null;
      throw result.error;
    }
    const { data } = result;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function downloadAssetBlob(supabase: SupabaseClient, storagePath: string | null) {
  if (!storagePath) return null;

  if (isR2Selected()) {
    if (!useR2Primary()) {
      console.warn(`[storage:r2] download ${storagePath} skipped because R2 env is incomplete.`);
      return null;
    }
    const r2Blob = await downloadR2AssetBlob(storagePath);
    if (r2Blob) return r2Blob;
    if (shouldBlockSupabaseFallback()) return null;
  }

  const primary = await supabase.storage.from(VIDEO_ASSETS_BUCKET).download(storagePath);
  if (!primary.error && primary.data) return primary.data;

  const admin = createStorageAdminClient();
  if (!admin) return null;
  const fallback = await admin.storage.from(VIDEO_ASSETS_BUCKET).download(storagePath);
  return fallback.data ?? null;
}

async function listSupabasePrefix(
  supabase: SupabaseClient,
  prefix: string,
): Promise<string[]> {
  const normalized = prefix.replace(/^\/+|\/+$/g, '');
  const { data, error } = await supabase.storage.from(VIDEO_ASSETS_BUCKET).list(normalized, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) {
    const { status, statusCode } = storageStatus(error);
    if (status === 404 || statusCode === 404) return [];
    console.warn(`[storage] list ${normalized} failed`, error);
    return [];
  }

  const paths: string[] = [];
  for (const item of data ?? []) {
    const name = String(item.name ?? '');
    if (!name) continue;
    const itemPath = `${normalized}/${name}`;
    const maybeFile = item as { id?: string | null; metadata?: unknown };
    if (maybeFile.id || maybeFile.metadata) {
      paths.push(itemPath);
    } else {
      paths.push(...await listSupabasePrefix(supabase, itemPath));
    }
  }
  return paths;
}

async function deleteSupabaseAssets(supabase: SupabaseClient, storagePaths: string[]) {
  const uniquePaths = [...new Set(storagePaths.filter(Boolean))];
  for (let i = 0; i < uniquePaths.length; i += 100) {
    const batch = uniquePaths.slice(i, i + 100);
    const { error } = await supabase.storage.from(VIDEO_ASSETS_BUCKET).remove(batch);
    if (error) {
      const { status, statusCode } = storageStatus(error);
      if (status !== 404 && statusCode !== 404) {
        console.warn(`[storage] remove batch failed`, error);
      }
    }
  }
}

export async function deleteVideoStorageAssets({
  supabase,
  userId,
  projectId,
  videoId,
  storagePaths = [],
}: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  videoId: string;
  storagePaths?: string[];
}) {
  const prefix = storageBasePath(userId, projectId, videoId);
  const paths = new Set(storagePaths.filter(Boolean));

  if (useR2Primary()) {
    for (const key of await listR2Prefix(prefix)) paths.add(key);
    await deleteR2Assets([...paths]);
    if (shouldBlockSupabaseFallback()) return { deletedPaths: paths.size, prefix };
  }

  if (shouldBlockSupabaseFallback()) {
    return { deletedPaths: paths.size, prefix };
  }

  const admin = createStorageAdminClient();
  const supabaseClient = admin ?? supabase;
  for (const pathFromList of await listSupabasePrefix(supabaseClient, prefix)) {
    paths.add(pathFromList);
  }
  await deleteSupabaseAssets(supabaseClient, [...paths]);

  return { deletedPaths: paths.size, prefix };
}
