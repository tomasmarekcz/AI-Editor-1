import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';

export const WORKSPACE_ACCESS_DENIED_MESSAGE = 'Access denied. You are not a member of this workspace.';

export type AccountRole = 'owner' | 'editor';

export type CurrentAccount = {
  id: string;
  name: string;
  plan: string;
  status: string;
  role: AccountRole;
};

type AccountMemberRow = {
  account_id: string;
  role: AccountRole;
};

type AccountRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
};

export async function acceptPendingInvites(supabase: SupabaseClient, email?: string | null) {
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail) return;

  const { data: invites, error } = await supabase
    .from('account_invites')
    .select('id')
    .eq('email', cleanEmail)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());

  if (error) {
    console.error('[accounts] pending invite lookup failed:', error.message);
    return;
  }

  for (const invite of invites ?? []) {
    const { error: acceptError } = await supabase.rpc('accept_account_invite', { p_invite_id: invite.id });
    if (acceptError) {
      console.error('[accounts] invite accept failed:', acceptError.message);
    }
  }
}

export async function getCurrentAccount(
  supabase: SupabaseClient,
  email?: string | null,
  userId?: string | null,
): Promise<CurrentAccount | null> {
  await acceptPendingInvites(supabase, email);

  let membershipQuery = supabase
    .from('account_members')
    .select('account_id,role')
    .order('joined_at', { ascending: false })
    .limit(1);

  if (userId) {
    membershipQuery = membershipQuery.eq('user_id', userId);
  }

  const { data: memberships, error: membershipError } = await membershipQuery;

  if (membershipError) {
    console.error('[accounts] membership lookup failed:', membershipError.message);
    return null;
  }

  const membership = (memberships?.[0] ?? null) as AccountMemberRow | null;
  if (!membership) return null;

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id,name,plan,status')
    .eq('id', membership.account_id)
    .maybeSingle<AccountRow>();

  if (accountError) {
    console.error('[accounts] account lookup failed:', accountError.message);
    return null;
  }

  if (!account || account.status !== 'active') return null;

  return {
    id: account.id,
    name: account.name,
    plan: account.plan,
    status: account.status,
    role: membership.role,
  };
}

export async function requireAccountPage() {
  if (!hasSupabaseEnv()) redirect('/login');

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const account = await getCurrentAccount(supabase, user.email, user.id);
  if (!account) redirect('/access-denied');

  return { supabase, user, account };
}

export async function requireAccountApi(): Promise<
  | { ok: true; supabase: SupabaseClient; user: User; account: CurrentAccount }
  | { ok: false; response: Response }
> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const account = await getCurrentAccount(supabase, user.email, user.id);
  if (!account) {
    return { ok: false, response: Response.json({ error: WORKSPACE_ACCESS_DENIED_MESSAGE }, { status: 403 }) };
  }

  return { ok: true, supabase, user, account };
}

export function requireOwner(account: CurrentAccount) {
  if (account.role !== 'owner') {
    return Response.json({ error: 'Only workspace owners can manage members and account settings.' }, { status: 403 });
  }
  return null;
}
