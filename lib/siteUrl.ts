const DEFAULT_SITE_URL = 'http://localhost:3000';

export function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

export function getAuthCallbackUrl(next = '/projects') {
  const url = new URL('/auth/callback', getSiteUrl());
  url.searchParams.set('next', next);
  return url.toString();
}

export function normalizePostLoginPath(next: string | null) {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/projects';
  return next;
}
