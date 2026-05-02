const DEFAULT_ADMIN_EMAIL = 'tomas.marek.cz@gmail.com';
const ALERT_DEDUPE_MS = 15 * 60 * 1000;
const sentAlerts = new Map<string, number>();

type AdminAlert = {
  key: string;
  subject: string;
  message: string;
  details?: Record<string, unknown>;
};

export async function sendAdminAlert({ key, subject, message, details }: AdminAlert) {
  const now = Date.now();
  const lastSentAt = sentAlerts.get(key);
  if (lastSentAt && now - lastSentAt < ALERT_DEDUPE_MS) return;
  sentAlerts.set(key, now);

  const to = process.env.ADMIN_ALERT_EMAIL || DEFAULT_ADMIN_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  const body = [
    message,
    details ? `\nDetails:\n${JSON.stringify(details, null, 2)}` : '',
  ].join('');

  if (!apiKey) {
    console.warn(`[admin-alert] ${subject}\nTo: ${to}\n${body}`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AI Video Generator <alerts@resend.dev>',
        to,
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      console.error('[admin-alert] Resend failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[admin-alert] Resend error:', err);
  }
}
