import { NextResponse } from 'next/server';
import { requireAccountApi, requireOwner } from '@/lib/accounts';
import { createYouTubeAuthorizationUrl, createYouTubeOAuthState } from '@/lib/integrations/youtube';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const ownerError = requireOwner(auth.account);
    if (ownerError) return ownerError;

    const state = createYouTubeOAuthState(auth.account.id, auth.user.id);
    return NextResponse.redirect(createYouTubeAuthorizationUrl(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[youtube/connect]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
