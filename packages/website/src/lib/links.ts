export const discordInviteUrl = 'https://discord.gg/dz9mUMvYg';
export const loggerheadLiteUrl = 'https://addons.wago.io/addons/loggerheadlite';
export const contactEmailAddress = 'contact@mythiciq.app';

function normalizeVenmoUsername(value: string | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';

  const fromProfileUrl = raw.match(/venmo\.com\/u\/([^/?#]+)/i)?.[1];
  return (fromProfileUrl ?? raw).replace(/^@+/, '').replace(/^\/+/, '');
}

export const venmoUsername = normalizeVenmoUsername(import.meta.env.VITE_VENMO_USERNAME);
export const venmoProfileUrl = venmoUsername
  ? `https://venmo.com/u/${encodeURIComponent(venmoUsername)}`
  : '';
