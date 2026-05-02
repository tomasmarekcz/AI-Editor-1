import { NextResponse } from 'next/server';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { getSiteUrl, normalizePostLoginPath } from '@/lib/siteUrl';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = normalizePostLoginPath(requestUrl.searchParams.get('next'));

  if (code && hasSupabaseEnv()) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, getSiteUrl()));
}
