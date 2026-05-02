import type { CurrentAccount } from '@/lib/accounts';

export const FREE_PLAN_GENERATION_MESSAGE =
  'Your current workspace plan is free. Generation features are disabled for free workspaces.';

export function enforcePaidPlan(account: Pick<CurrentAccount, 'plan'>, action: string) {
  const plan = String(account.plan ?? 'free').trim().toLowerCase();

  if (plan === 'free') {
    console.warn('[plan] blocked generation action for free workspace', { action });
    return {
      ok: false as const,
      response: Response.json({ error: FREE_PLAN_GENERATION_MESSAGE }, { status: 403 }),
    };
  }

  return { ok: true as const };
}
