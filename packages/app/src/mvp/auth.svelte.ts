// Sign-in via the Cognito Hosted UI using the OAuth2 Authorization-Code + PKCE flow — no SDK, no deps
// (just fetch + Web Crypto). The user signs in (Google / TikTok / Cognito) on the Hosted UI, we exchange
// the returned code for tokens, and hand the ACCESS token to the backup client for the authed backend
// routes. The combat log never leaves the browser; only the backed-up per-run blobs do, and only when
// the user explicitly backs a run up.
//
// Config (Vite env, from the app-stack outputs): VITE_COGNITO_DOMAIN (Hosted UI base URL) +
// VITE_COGNITO_CLIENT_ID. When unset, auth is simply UNCONFIGURED — `configured` is false and the UI
// hides the sign-in entry (everything else works offline, exactly like the other backend seams).

import { isDesktop, oauthCapture } from './desktop.js';

const DOMAIN = (import.meta.env.VITE_COGNITO_DOMAIN as string | undefined)?.replace(/\/$/, '');
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
// Desktop uses a FIXED loopback callback (RFC 8252 — captured natively, see src-tauri/src/auth.rs); it
// must match the desktop Cognito app client's registered URL. The web app redirects to its own origin.
const DESKTOP_REDIRECT_URI = 'http://localhost:8765/';
const WEB_REDIRECT_URI =
  (import.meta.env.VITE_COGNITO_REDIRECT_URI as string | undefined) ??
  (typeof window !== 'undefined' ? window.location.origin + '/' : '');
/** The OAuth redirect_uri for this platform — must be identical in the authorize URL and token exchange. */
function redirectUri(): string {
  return isDesktop() ? DESKTOP_REDIRECT_URI : WEB_REDIRECT_URI;
}

const TOKENS_KEY = 'wow.auth.v1';
const PKCE_KEY = 'wow.auth.pkce'; // sessionStorage: { verifier, state }
const RETURN_KEY = 'wow.auth.returnTo'; // sessionStorage: path to return to after the web redirect
const SCOPE = 'openid email profile';
const REFRESH_SKEW_MS = 60_000; // refresh a minute before expiry

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthUser {
  sub: string;
  email?: string;
  username?: string;
}

interface StoredTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

// ---- small base64url / PKCE / JWT helpers ----------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(byteLen = 48): string {
  const a = new Uint8Array(byteLen);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}
/** Decode a JWT payload (display only — trust comes from the backend verifying the access token). */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}
function saveTokens(t: StoredTokens | null): void {
  try {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* private mode — auth just won't persist */
  }
}

function userFromIdToken(idToken: string): AuthUser | null {
  const c = decodeJwt(idToken);
  if (!c || typeof c.sub !== 'string') return null;
  return {
    sub: c.sub,
    email: typeof c.email === 'string' ? c.email : undefined,
    username: typeof c['cognito:username'] === 'string' ? (c['cognito:username'] as string) : undefined,
  };
}

class Auth {
  /** 'loading' until init() resolves the redirect / restores a session. */
  status = $state<AuthStatus>('loading');
  user = $state<AuthUser | null>(null);
  /** Whether a Cognito pool is configured (env present). When false the sign-in UI is hidden. */
  readonly configured = !!DOMAIN && !!CLIENT_ID;

  #tokens: StoredTokens | null = null;
  #refreshing: Promise<string | null> | null = null;

  /** Call once on app mount. Completes the redirect (if returning from Hosted UI) or restores a session. */
  async init(): Promise<void> {
    if (!this.configured) {
      this.status = 'signed-out';
      return;
    }
    // Returning from the Hosted UI? URL carries ?code=… (&state=…).
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      await this.#exchangeCode(code, params.get('state'));
      // Strip the OAuth params from the URL so a refresh doesn't re-exchange a spent code.
      const url = new URL(window.location.href);
      for (const k of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(k);
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      // The web redirect always lands at the registered origin root; if sign-in was started from another
      // in-app route (e.g. the /r/<code> shared replay), return there now that we're signed in.
      const returnTo = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      if (returnTo && returnTo.startsWith('/') && this.status === 'signed-in' && returnTo !== url.pathname) {
        window.location.assign(returnTo);
      }
      return;
    }
    // Otherwise restore any stored session.
    this.#tokens = loadTokens();
    if (this.#tokens?.idToken) {
      // Compute into a local first: init() runs inside an App `$effect`, and READING the reactive
      // `this.user` right after writing it would register `user` as a dependency of that effect —
      // which also wrote it — looping forever (effect_update_depth_exceeded freezes the whole UI).
      const restored = userFromIdToken(this.#tokens.idToken);
      this.user = restored;
      this.status = restored ? 'signed-in' : 'signed-out';
    } else {
      this.status = 'signed-out';
    }
  }

  /** Sign in via the Hosted UI. `idp` (e.g. 'Google') skips the chooser. On the web this redirects the
   *  page; on desktop it opens the system browser and captures the loopback redirect natively (the
   *  webview can't navigate to the Hosted UI and back), then exchanges the code in place. */
  async login(idp?: string, returnTo?: string): Promise<void> {
    if (!this.configured) return;
    // On the web the page redirects away and back to the origin root; stash where to return so a sign-in
    // started from /r/<code> (the shared replay) lands back there. Ignored on desktop (captured in place).
    if (returnTo && returnTo.startsWith('/') && !isDesktop()) sessionStorage.setItem(RETURN_KEY, returnTo);
    const verifier = randomString();
    const state = randomString(16);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
    const challenge = await sha256(verifier);
    const url = new URL(`${DOMAIN}/oauth2/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID!);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    if (idp) url.searchParams.set('identity_provider', idp);

    if (isDesktop()) {
      try {
        const res = await oauthCapture(url.toString());
        if (res.error || !res.code) {
          this.status = 'signed-out';
          return;
        }
        await this.#exchangeCode(res.code, res.state ?? null);
      } catch {
        this.status = 'signed-out';
      }
      return;
    }
    window.location.assign(url.toString());
  }

  /** Sign out locally and at the Hosted UI (clears the Cognito session cookie), then return to the app.
   *  On desktop we only clear locally — navigating the webview to the Hosted UI logout would blow away
   *  the app, and there's no shared browser session cookie to clear. */
  logout(): void {
    saveTokens(null);
    this.#tokens = null;
    this.user = null;
    this.status = 'signed-out';
    if (this.configured && !isDesktop()) {
      const url = new URL(`${DOMAIN}/logout`);
      url.searchParams.set('client_id', CLIENT_ID!);
      url.searchParams.set('logout_uri', WEB_REDIRECT_URI);
      window.location.assign(url.toString());
    }
  }

  /** A valid access token (refreshing if near expiry), or null when signed out / refresh failed. */
  async getAccessToken(): Promise<string | null> {
    if (!this.#tokens) return null;
    if (Date.now() < this.#tokens.expiresAt - REFRESH_SKEW_MS) return this.#tokens.accessToken;
    return this.#refresh();
  }

  // ---- internals ----

  async #exchangeCode(code: string, state: string | null): Promise<void> {
    let verifier: string | undefined;
    try {
      const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string } | null;
      sessionStorage.removeItem(PKCE_KEY);
      if (!pkce || (state && pkce.state !== state)) {
        this.status = 'signed-out';
        return; // state mismatch → drop (possible CSRF / stale tab)
      }
      verifier = pkce.verifier;
    } catch {
      this.status = 'signed-out';
      return;
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID!,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    try {
      const res = await fetch(`${DOMAIN}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`token exchange ${res.status}`);
      this.#applyTokenResponse(await res.json());
    } catch {
      this.status = 'signed-out';
    }
  }

  async #refresh(): Promise<string | null> {
    if (this.#refreshing) return this.#refreshing;
    const refreshToken = this.#tokens?.refreshToken;
    if (!refreshToken) {
      this.#signOutLocal();
      return null;
    }
    this.#refreshing = (async () => {
      try {
        const res = await fetch(`${DOMAIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID!, refresh_token: refreshToken }),
        });
        if (!res.ok) throw new Error(`refresh ${res.status}`);
        this.#applyTokenResponse(await res.json(), refreshToken);
        return this.#tokens?.accessToken ?? null;
      } catch {
        this.#signOutLocal(); // refresh token expired/revoked → require re-login
        return null;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }

  #applyTokenResponse(json: unknown, keepRefresh?: string): void {
    const t = json as { access_token?: string; id_token?: string; refresh_token?: string; expires_in?: number };
    if (!t.access_token || !t.id_token) {
      this.status = 'signed-out';
      return;
    }
    this.#tokens = {
      accessToken: t.access_token,
      idToken: t.id_token,
      refreshToken: t.refresh_token ?? keepRefresh,
      expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    };
    saveTokens(this.#tokens);
    this.user = userFromIdToken(t.id_token);
    this.status = this.user ? 'signed-in' : 'signed-out';
  }

  #signOutLocal(): void {
    saveTokens(null);
    this.#tokens = null;
    this.user = null;
    this.status = 'signed-out';
  }
}

export const auth = new Auth();
