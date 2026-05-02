export interface GoogleImageCandidate {
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  title?: string;
  source?: string;
  link?: string;
}

interface SerperResponse {
  images?: GoogleImageCandidate[];
}

/**
 * Search Google Images via Serper and return candidate metadata.
 * Results are still size-sorted so callers have a reliable fallback order.
 */
export async function searchImageCandidateDetails(
  keywords: string,
  limit = 10,
): Promise<GoogleImageCandidate[]> {
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: keywords, num: 10 }),
  });

  if (!res.ok) {
    throw new Error(`Serper API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as SerperResponse;
  const images = data.images ?? [];

  if (images.length === 0) {
    throw new Error(`No images found for: ${keywords}`);
  }

  // Fallback order: prefer images with reasonable dimensions (not tiny thumbnails).
  const sorted = [...images].sort((a, b) => {
    const aSize = (a.imageWidth ?? 0) * (a.imageHeight ?? 0);
    const bSize = (b.imageWidth ?? 0) * (b.imageHeight ?? 0);
    return bSize - aSize;
  });

  return sorted.slice(0, limit);
}

/**
 * Search Google Images via Serper and return up to `limit` candidate URLs.
 */
export async function searchImageCandidates(
  keywords: string,
  limit = 5,
): Promise<string[]> {
  const candidates = await searchImageCandidateDetails(keywords, limit);
  return candidates.map((img) => img.imageUrl);
}

/** Legacy single-URL wrapper (used by existing callers that only need one URL). */
export async function searchImage(keywords: string): Promise<string> {
  const candidates = await searchImageCandidates(keywords, 1);
  return candidates[0];
}
