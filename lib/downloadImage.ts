import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.google.com/',
};

// Magic bytes for common image formats
function isValidImageBuffer(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true; // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true; // WebP
  return false;
}

/**
 * Try downloading from a list of candidate URLs, returning the first that works.
 * Falls back to each subsequent URL on any per-URL error.
 */
export async function downloadImage(urlOrUrls: string | string[], id: string): Promise<string> {
  const candidates = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];

  const dir = path.join(process.cwd(), 'public', 'tmp', 'images');
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${id}.jpg`;
  const filepath = path.join(dir, filename);

  let lastError: Error = new Error('No candidates');

  for (const url of candidates) {
    try {
      await downloadToFile(url, filepath, 0);

      // Validate magic bytes
      const stat = fs.statSync(filepath);
      if (stat.size < 1024) {
        fs.unlinkSync(filepath);
        throw new Error(`File too small (${stat.size} bytes)`);
      }
      const header = Buffer.alloc(12);
      const fd = fs.openSync(filepath, 'r');
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);
      if (!isValidImageBuffer(header)) {
        fs.unlinkSync(filepath);
        throw new Error('Not a valid image (bad magic bytes)');
      }

      return `/tmp/images/${filename}`;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[downloadImage] ${url.slice(0, 80)}... failed: ${lastError.message}`);
      // Try next candidate
    }
  }

  throw lastError;
}

function downloadToFile(url: string, filepath: string, redirectCount: number): Promise<void> {
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);

    const req = protocol.get(url, { headers: BROWSER_HEADERS }, (res) => {
      const status = res.statusCode ?? 0;

      if (status === 301 || status === 302 || status === 307 || status === 308) {
        file.close();
        try { fs.unlinkSync(filepath); } catch {}
        downloadToFile(res.headers.location!, filepath, redirectCount + 1)
          .then(resolve).catch(reject);
        return;
      }

      if (status !== 200) {
        file.close();
        res.resume();
        try { fs.unlinkSync(filepath); } catch {}
        reject(new Error(`HTTP ${status} downloading image`));
        return;
      }

      const ct = res.headers['content-type'] ?? '';
      if (ct && !ct.startsWith('image/') && !ct.startsWith('application/octet')) {
        file.close();
        res.resume();
        try { fs.unlinkSync(filepath); } catch {}
        reject(new Error(`Unexpected content-type: ${ct}`));
        return;
      }

      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    });

    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(filepath); } catch {}
      reject(err);
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Image download timeout'));
    });
  });
}
