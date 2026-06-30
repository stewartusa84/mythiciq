export const discordInviteUrl = 'https://discord.gg/dz9mUMvYg';
export const githubUrl = 'https://github.com/stewartusa84/mythiciq';
export const loggerheadLiteUrl = 'https://addons.wago.io/addons/loggerheadlite';
export const contactEmailAddress = 'contact@mythiciq.app';
export const tiktokUsername = 'mythiciq.app';
export const tiktokProfileUrl = `https://www.tiktok.com/@${tiktokUsername}`;
const defaultVenmoUsername = 'Paul-Stewart-84';
const placeholderVenmoUsernames = new Set(['your-venmo-username']);

function normalizeVenmoUsername(value: string | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';

  const fromProfileUrl = raw.match(/venmo\.com\/u\/([^/?#]+)/i)?.[1];
  const username = (fromProfileUrl ?? raw).replace(/^@+/, '').replace(/^\/+/, '');
  return placeholderVenmoUsernames.has(username.toLowerCase()) ? '' : username;
}

export const venmoUsername =
  normalizeVenmoUsername(import.meta.env.VITE_VENMO_USERNAME) || defaultVenmoUsername;
export const venmoProfileUrl = venmoUsername
  ? `https://venmo.com/u/${encodeURIComponent(venmoUsername)}`
  : '';
