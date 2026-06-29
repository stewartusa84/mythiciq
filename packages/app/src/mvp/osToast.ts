// Cross-platform OS toast. On desktop (Tauri) it uses the native notification plugin; on the web it uses
// the browser Notifications API. The point: a user may be IN-GAME (the app behind the game / another tab),
// so a match or invite must reach them OUTSIDE the app window — an in-app card alone isn't enough. Both
// paths are best-effort and request permission on first use; everything is wrapped so a missing/blocked
// notification never breaks the caller.

import { isDesktop, notify as desktopNotify } from './desktop.js';

/** Ask for OS-notification permission ahead of time (best-effort) so the first real alert isn't dropped
 *  while a prompt is pending. Desktop requests lazily inside notify(); web asks here. */
export async function requestToastPermission(): Promise<void> {
  if (isDesktop()) return;
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch {
    /* best-effort */
  }
}

/** Fire an OS-level notification (desktop native or browser). No-op if unsupported / permission denied. */
export async function osToast(title: string, body: string): Promise<void> {
  if (isDesktop()) {
    await desktopNotify(title, body);
    return;
  }
  try {
    if (typeof Notification === 'undefined') return;
    let granted = Notification.permission === 'granted';
    if (!granted && Notification.permission === 'default') granted = (await Notification.requestPermission()) === 'granted';
    if (granted) new Notification(title, { body });
  } catch {
    /* best-effort */
  }
}
