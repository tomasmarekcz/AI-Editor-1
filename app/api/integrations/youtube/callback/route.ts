import { NextResponse } from 'next/server';
import { getCurrentAccount, requireOwner } from '@/lib/accounts';
import { exchangeYouTubeCode, encryptedTokenRows, fetchYouTubeChannel, verifyYouTubeOAuthState, YOUTUBE_SCOPES } from '@/lib/integrations/youtube';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function settingsRedirect(req: Request, status: 'connected' | 'error', message?: string) {
  const base = process.env.BASE_URL || new URL(req.url).origin;
  const url = new URL('/settings', base);
  url.searchParams.set('youtube', status);
  if (message) url.searchParams.set('message', message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const rawState = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return settingsRedirect(req, 'error', oauthError);
    if (!code || !rawState) return settingsRedirect(req, 'error', 'Missing OAuth code or state.');

    const state = verifyYouTubeOAuthState(rawState);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.id !== state.userId) return settingsRedirect(req, 'error', 'Please sign in again before connecting YouTube.');

    const account = await getCurrentAccount(supabase, user.email, user.id);
    if (!account || account.id !== state.accountId) return settingsRedirect(req, 'error', 'Workspace access could not be verified.');
    const ownerError = requireOwner(account);
    if (ownerError) return settingsRedirect(req, 'error', 'Only workspace owners can connect YouTube.');

    const admin = createSupabaseAdminClient();
    if (!admin) return settingsRedirect(req, 'error', 'Supabase service role is not configured.');

    const tokens = await exchangeYouTubeCode(code);
    const channel = await fetchYouTubeChannel(tokens.access_token ?? '');
    const now = new Date().toISOString();

    const { data: connection, error: connectionError } = await admin
      .from('social_connections')
      .upsert({
        account_id: account.id,
        connected_by: user.id,
        platform: 'youtube',
        status: 'connected',
        platform_account_id: channel.id,
        platform_account_name: channel.title,
        platform_channel_id: channel.id,
        platform_channel_title: channel.title,
        platform_channel_url: channel.url,
        scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : YOUTUBE_SCOPES,
        last_verified_at: now,
        disconnected_at: null,
        error_message: null,
        updated_at: now,
      }, { onConflict: 'account_id,platform' })
      .select('id')
      .single<{ id: string }>();

    if (connectionError || !connection) {
      throw new Error(connectionError?.message ?? 'Could not save YouTube connection.');
    }

    const { error: tokenError } = await admin
      .from('social_connection_tokens')
      .upsert({
        connection_id: connection.id,
        ...encryptedTokenRows(tokens),
      }, { onConflict: 'connection_id' });

    if (tokenError) throw new Error(tokenError.message);

    return settingsRedirect(req, 'connected');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[youtube/callback]', message);
    return settingsRedirect(req, 'error', message);
  }
}
