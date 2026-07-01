// Feature flags — single place to gate optional product surfaces.
//
// `accounts`: sign-in/account UI backed by Cognito. It is ON by default for normal app builds when
// Cognito env is configured (and still hidden when auth.configured is false). Set
// VITE_FEATURE_ACCOUNTS=0 to force it off for a build.
//
// The DESKTOP build (Tauri) ALWAYS ships sign-in: it's a downloaded app with long-lived sessions, and
// sign-in unlocks collaboration features (replay sharing / Groups). A getter so it's evaluated after
// Tauri injects its globals.

import { isDesktop } from './desktop.js';

const demoMode = import.meta.env.MODE === 'demo' || import.meta.env.VITE_APP_MODE === 'demo';
const enabledUnlessOff = (value: unknown): boolean => value !== '0' && value !== 'false';
const enabledOnlyWhenOn = (value: unknown): boolean => value === '1' || value === 'true';

export const FLAGS = {
  get demo(): boolean {
    return demoMode;
  },
  get accounts(): boolean {
    if (demoMode) return false;
    return isDesktop() || enabledUnlessOff(import.meta.env.VITE_FEATURE_ACCOUNTS);
  },
  // `groups`: the group-coordination / LFG pilot (characters + Looking Cards + Run Cards + broadcast +
  // near-instant WS push). Desktop keeps the pilot on by default; public web builds keep it locked out
  // unless VITE_FEATURE_GROUPS=1/true is set for an explicit pilot build. Requires accounts/sign-in + a
  // configured backend; for live match push it also needs VITE_LFG_WS_URL set (else it falls back to the
  // poll-on-open inbox).
  get groups(): boolean {
    if (demoMode) return false;
    if (isDesktop()) return enabledUnlessOff(import.meta.env.VITE_FEATURE_GROUPS);
    return enabledOnlyWhenOn(import.meta.env.VITE_FEATURE_GROUPS);
  },
};
