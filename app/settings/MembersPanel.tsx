'use client';

import { useState } from 'react';

export type AccountMemberView = {
  id: string;
  user_id: string;
  email: string;
  role: 'owner' | 'editor';
  created_at: string;
  joined_at: string;
};

export type AccountInviteView = {
  id: string;
  email: string;
  role: 'owner' | 'editor';
  created_at: string;
  expires_at: string;
};

type Props = {
  currentUserId: string;
  isOwner: boolean;
  members: AccountMemberView[];
  invites: AccountInviteView[];
};

export function MembersPanel({ currentUserId, isOwner, members: initialMembers, invites: initialInvites }: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'owner'>('editor');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/account/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json() as {
        error?: string;
        member?: AccountMemberView;
        invite?: AccountInviteView;
        message?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.member) {
        setMembers((current) => current.some((member) => member.id === data.member!.id)
          ? current.map((member) => member.id === data.member!.id ? data.member! : member)
          : [...current, data.member!]);
      }
      if (data.invite) {
        setInvites((current) => current.some((invite) => invite.id === data.invite!.id)
          ? current.map((invite) => invite.id === data.invite!.id ? data.invite! : invite)
          : [data.invite!, ...current]);
      }
      setEmail('');
      setRole('editor');
      setMessage(data.message ?? 'Member access updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update members.');
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(memberId: string, nextRole: 'owner' | 'editor') {
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/account/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, role: nextRole }),
      });
      const data = await res.json() as { error?: string; member?: AccountMemberView };
      if (!res.ok || data.error || !data.member) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMembers((current) => current.map((member) => member.id === memberId ? data.member! : member));
      setMessage('Member role updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role.');
    }
  }

  async function removeMember(memberId: string) {
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/account/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMembers((current) => current.filter((member) => member.id !== memberId));
      setMessage('Member removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove member.');
    }
  }

  async function cancelInvite(inviteId: string) {
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/account/invites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      setMessage('Invite cancelled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel invite.');
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Members</p>
        <h2 className="mt-1 text-2xl font-black tracking-normal">Workspace access</h2>
      </div>

      {isOwner ? (
        <form onSubmit={addMember} className="mt-5 grid gap-3 sm:grid-cols-[1fr_140px_auto]">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="email@example.com"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as 'editor' | 'owner')}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          >
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>
          <button disabled={busy || !email.trim()} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-black text-gray-950 transition hover:bg-cyan-300 disabled:opacity-40">
            Add
          </button>
        </form>
      ) : (
        <p className="mt-4 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-400">
          Editors can create and edit videos. Only owners can manage members.
        </p>
      )}

      {message && <p className="mt-4 text-sm font-bold text-emerald-300">{message}</p>}
      {error && <p className="mt-4 text-sm font-bold text-red-300">{error}</p>}

      <div className="mt-5 divide-y divide-gray-800 rounded-lg border border-gray-800">
        {members.map((member) => (
          <div key={member.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-white">{member.email}</p>
              <p className="mt-1 text-xs text-gray-500">{member.user_id === currentUserId ? 'You' : 'Member'} · joined {new Date(member.joined_at).toLocaleDateString()}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isOwner ? (
                <select value={member.role} onChange={(event) => updateMember(member.id, event.target.value as 'owner' | 'editor')} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white">
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                </select>
              ) : (
                <span className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-gray-300">{member.role}</span>
              )}
              {isOwner && member.user_id !== currentUserId && (
                <button onClick={() => removeMember(member.id)} className="rounded-lg border border-red-900 px-3 py-2 text-xs font-bold text-red-200 transition hover:border-red-500">
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOwner && invites.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">Pending invites</p>
          <div className="divide-y divide-gray-800 rounded-lg border border-gray-800">
            {invites.map((invite) => (
              <div key={invite.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{invite.email}</p>
                  <p className="mt-1 text-xs text-gray-500">{invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}</p>
                </div>
                <button onClick={() => cancelInvite(invite.id)} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold text-gray-300 transition hover:border-red-500 hover:text-red-200">
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
