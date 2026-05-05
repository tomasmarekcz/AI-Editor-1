import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const VIDEO_ASSETS_BUCKET = 'video-assets';
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
  return { status, statusCode };
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

async function ensureVideoBucketLimit(requiredBytes: number) {
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
    `upload ${storagePath}`,
  );

  if (error) throw error;
  return { storagePath, sizeBytes: buffer.byteLength, mimeType: contentType };
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

export async function createSignedUrl(supabase: SupabaseClient, storagePath: string | null, expiresIn = 3600) {
  if (!storagePath) return null;
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
    const admin = createStorageAdminClient();
    if (!admin) return null;
    const adminResult = await admin.storage
      .from(VIDEO_ASSETS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (adminResult.error) {
      const { status, statusCode } = storageStatus(adminResult.error);
      if (status !== 404 && statusCode !== 404) {
        console.warn(`[storage] signed-url ${storagePath} failed`, adminResult.error);
      }
    }
    return adminResult.data?.signedUrl ?? null;
  }
}
