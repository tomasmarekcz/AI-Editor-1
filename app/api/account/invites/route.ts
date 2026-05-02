import { requireAccountApi, requireOwner } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  const { inviteId } = await req.json() as { inviteId?: string };
  if (!inviteId) return Response.json({ error: 'inviteId is required.' }, { status: 400 });

  const { error } = await auth.supabase
    .from('account_invites')
    .delete()
    .eq('id', inviteId)
    .eq('account_id', auth.account.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
