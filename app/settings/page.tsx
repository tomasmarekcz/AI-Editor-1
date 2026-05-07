import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { MembersPanel, type AccountInviteView, type AccountMemberView } from './MembersPanel';
import { YouTubeIntegrationPanel, type YouTubeConnectionView } from './YouTubeIntegrationPanel';

export const dynamic = 'force-dynamic';

type Profile = {
  email: string | null;
  plan: string | null;
  created_at: string | null;
};

export default async function SettingsPage() {
  const { supabase, user, account } = await requireAccountPage();

  const { data: profile } = await supabase
    .from('profiles')
    .select('email,plan,created_at')
    .eq('id', user.id)
    .maybeSingle<Profile>();

  const [{ data: members }, { data: invites }, { data: youtubeConnection }] = await Promise.all([
    supabase
      .from('account_members')
      .select('id,email,role,created_at,joined_at,user_id')
      .eq('account_id', account.id)
      .order('created_at', { ascending: true }),
    account.role === 'owner'
      ? supabase
          .from('account_invites')
          .select('id,email,role,created_at,expires_at')
          .eq('account_id', account.id)
          .is('accepted_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from('social_connections')
      .select('id,status,platform_channel_title,platform_channel_url,last_verified_at,disconnected_at')
      .eq('account_id', account.id)
      .eq('platform', 'youtube')
      .maybeSingle<YouTubeConnectionView>(),
  ]);

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="flex-1 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Settings</p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">Account</h1>
          <section className="mt-8 rounded-lg border border-gray-800 bg-gray-900/70 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Email</p>
                <p className="mt-2 text-sm font-bold">{profile?.email ?? user.email ?? 'Unknown'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Workspace</p>
                <p className="mt-2 text-sm font-bold">{account.name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Role / Plan</p>
                <p className="mt-2 text-sm font-bold">{account.role} · {account.plan ?? profile?.plan ?? 'free'}</p>
              </div>
            </div>
          </section>
          <MembersPanel
            currentUserId={user.id}
            isOwner={account.role === 'owner'}
            members={(members ?? []) as AccountMemberView[]}
            invites={(invites ?? []) as AccountInviteView[]}
          />
          <YouTubeIntegrationPanel
            isOwner={account.role === 'owner'}
            connection={(youtubeConnection ?? null) as YouTubeConnectionView | null}
          />
        </div>
      </main>
    </div>
  );
}
