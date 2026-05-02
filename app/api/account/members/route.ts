import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAccountApi, requireOwner } from '@/lib/accounts';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Role = 'owner' | 'editor';

function cleanRole(role: unknown): Role {
  return role === 'owner' ? 'owner' : 'editor';
}

function cleanEmail(email: unknown) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

async function findUserIdByEmail(email: string) {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error('[account/members] user lookup failed:', error.message);
    return null;
  }

  return data.users.find((user) => user.email?.toLowerCase() === email)?.id ?? null;
}

async function ownerCount(supabase: SupabaseClient, accountId: string) {
  const { count } = await supabase
    .from('account_members')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('role', 'owner');
  return count ?? 0;
}

export async function POST(req: Request) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  const { email: rawEmail, role: rawRole } = await req.json() as { email?: string; role?: Role };
  const email = cleanEmail(rawEmail);
  const role = cleanRole(rawRole);

  if (!email || !email.includes('@')) {
    return Response.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const existingUserId = await findUserIdByEmail(email);
  if (existingUserId) {
    const { data: member, error } = await auth.supabase
      .from('account_members')
      .upsert({
        account_id: auth.account.id,
        user_id: existingUserId,
        email,
        role,
      }, { onConflict: 'account_id,user_id' })
      .select('id,email,role,created_at,joined_at,user_id')
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ member, message: 'Existing user added to the workspace.' });
  }

  const { data: existingInvite } = await auth.supabase
    .from('account_invites')
    .select('id')
    .eq('account_id', auth.account.id)
    .eq('email', email)
    .is('accepted_at', null)
    .maybeSingle<{ id: string }>();

  const inviteQuery = existingInvite
    ? auth.supabase
        .from('account_invites')
        .update({ role, invited_by: auth.user.id })
        .eq('id', existingInvite.id)
        .eq('account_id', auth.account.id)
    : auth.supabase
        .from('account_invites')
        .insert({
          account_id: auth.account.id,
          email,
          role,
          invited_by: auth.user.id,
        });

  const { data: invite, error } = await inviteQuery
    .select('id,email,role,created_at,expires_at')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ invite, message: 'Invite saved. This email will join after signing in.' });
}

export async function PATCH(req: Request) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  const { memberId, role: rawRole } = await req.json() as { memberId?: string; role?: Role };
  const role = cleanRole(rawRole);
  if (!memberId) return Response.json({ error: 'memberId is required.' }, { status: 400 });

  const { data: existing } = await auth.supabase
    .from('account_members')
    .select('id,user_id,role')
    .eq('id', memberId)
    .eq('account_id', auth.account.id)
    .maybeSingle<{ id: string; user_id: string; role: Role }>();

  if (!existing) return Response.json({ error: 'Member not found.' }, { status: 404 });
  if (existing.role === 'owner' && role !== 'owner' && await ownerCount(auth.supabase, auth.account.id) <= 1) {
    return Response.json({ error: 'A workspace must have at least one owner.' }, { status: 400 });
  }

  const { data: member, error } = await auth.supabase
    .from('account_members')
    .update({ role })
    .eq('id', memberId)
    .eq('account_id', auth.account.id)
    .select('id,email,role,created_at,joined_at,user_id')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ member });
}

export async function DELETE(req: Request) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  const { memberId } = await req.json() as { memberId?: string };
  if (!memberId) return Response.json({ error: 'memberId is required.' }, { status: 400 });

  const { data: existing } = await auth.supabase
    .from('account_members')
    .select('id,user_id,role')
    .eq('id', memberId)
    .eq('account_id', auth.account.id)
    .maybeSingle<{ id: string; user_id: string; role: Role }>();

  if (!existing) return Response.json({ error: 'Member not found.' }, { status: 404 });
  if (existing.user_id === auth.user.id) {
    return Response.json({ error: 'You cannot remove yourself.' }, { status: 400 });
  }
  if (existing.role === 'owner' && await ownerCount(auth.supabase, auth.account.id) <= 1) {
    return Response.json({ error: 'A workspace must have at least one owner.' }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('account_members')
    .delete()
    .eq('id', memberId)
    .eq('account_id', auth.account.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
