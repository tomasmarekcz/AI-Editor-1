import { NextResponse } from 'next/server';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';

export async function POST(request: Request) {
  if (hasSupabaseEnv()) {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL('/login', request.url), {
    status: 303,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
