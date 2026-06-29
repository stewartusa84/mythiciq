// Battle.net account-link state machine (runes singleton). Coordinates the multi-step link → load roster
// → import flow across the web redirect boundary: App reads `?bnet=linked` on return and hands off here
// (`markReturn`), then the Groups view drives `consumeReturnIfAny` once it's mounted + signed in. The
// import either runs automatically (the roster fits in the free slots) or surfaces a picker (`choosing`).

import {
  startBlizzardLink, blizzardStatus, getBlizzardAccount, importBlizzardCharacters,
  type AccountRoster, type AccountCandidate,
} from './blizzard.js';
import type { Region } from './lfg.js';

/** Desktop link polling: the user authorizes in the system browser; we poll /status until the token lands. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

export type LinkPhase = 'idle' | 'starting' | 'loading' | 'choosing' | 'importing';

class BlizzardLinkState {
  phase = $state<LinkPhase>('idle');
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  /** The fetched roster while `phase==='choosing'` (the picker reads `candidates`/`slotsLeft`). */
  roster = $state<AccountRoster | null>(null);
  /** Set by App from the `?bnet=` return param; consumed once Groups is mounted. */
  #returnStatus: 'linked' | 'error' | null = null;

  get busy(): boolean {
    return this.phase === 'starting' || this.phase === 'loading' || this.phase === 'importing';
  }

  /** App calls this from the `?bnet=linked|error` redirect param (web). */
  markReturn(status: 'linked' | 'error'): void {
    this.#returnStatus = status;
  }

  /** Groups view calls this when it mounts (signed in); runs the deferred post-redirect step, if any. */
  async consumeReturnIfAny(onChanged: () => Promise<void> | void): Promise<void> {
    const status = this.#returnStatus;
    this.#returnStatus = null;
    if (status === 'error') {
      this.error = 'Battle.net link failed or was cancelled. Please try again.';
    } else if (status === 'linked') {
      await this.#loadAndMaybeImport(onChanged);
    }
  }

  /** Kick off the link. Web redirects away (resolves later via markReturn); desktop captures in place. */
  async start(region: Region, onChanged: () => Promise<void> | void): Promise<void> {
    this.error = null;
    this.notice = null;
    this.phase = 'starting';
    const r = await startBlizzardLink(region);
    if (!r.ok) {
      this.error = r.error;
      this.phase = 'idle';
      return;
    }
    if (r.value.mode === 'poll') {
      // Desktop: the user authorizes in the system browser; poll until the backend stores the token.
      const linked = await this.#pollUntilLinked();
      if (!linked) {
        this.error = 'Timed out waiting for Battle.net — finish the sign-in in your browser and try again.';
        this.phase = 'idle';
        return;
      }
      await this.#loadAndMaybeImport(onChanged);
    }
    // Web (mode 'redirect'): the page navigated to Battle.net; resumes via consumeReturnIfAny on return.
  }

  async #pollUntilLinked(): Promise<boolean> {
    this.phase = 'loading';
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      const s = await blizzardStatus();
      if (s.ok && s.value.linked) return true;
    }
    return false;
  }

  async #loadAndMaybeImport(onChanged: () => Promise<void> | void): Promise<void> {
    this.phase = 'loading';
    const r = await getBlizzardAccount();
    if (!r.ok) {
      this.error = r.error;
      this.phase = 'idle';
      return;
    }
    const acct = r.value;
    if (!acct.linked) {
      this.error = 'Account not linked.';
      this.phase = 'idle';
      return;
    }
    if (acct.needsRelink) {
      this.error = 'Your Battle.net session expired — please link again.';
      this.phase = 'idle';
      return;
    }
    this.roster = acct;
    const candidates = acct.candidates ?? [];
    if (candidates.length === 0) {
      this.notice = 'No max-level characters found on your Battle.net account.';
      this.phase = 'idle';
      this.roster = null;
      await onChanged();
      return;
    }
    // `alreadyImported` means the toon is on the roster (likely as an unverified manual/lookup entry) — we
    // still UPSERT it so it gets flipped to verified + re-synced. Only the NEW ones consume free slots.
    const newOnes = candidates.filter((c) => !c.alreadyImported);
    const slots = acct.slotsLeft ?? 0;
    if (newOnes.length <= slots) {
      // Everything fits: sync ALL of them (verifies the existing ones, adds the new ones).
      await this.#importKeys(candidates, onChanged);
    } else {
      // More NEW characters than free slots. Upgrade the already-on-roster ones now (they cost no slot),
      // then let the user choose which NEW ones to add.
      const existing = candidates.filter((c) => c.alreadyImported);
      if (existing.length > 0) {
        await importBlizzardCharacters(existing.map((c) => ({ realmSlug: c.realmSlug, name: c.name })));
        await onChanged();
      }
      this.phase = 'choosing';
    }
  }

  /** Import an explicit selection (from the picker). */
  async importSelected(candidates: AccountCandidate[], onChanged: () => Promise<void> | void): Promise<void> {
    await this.#importKeys(candidates, onChanged);
  }

  /** Re-sync an ALREADY-linked account (reuses the stored token — no re-authorization). Verifies +
   *  refreshes the roster, or surfaces the picker if there are more new characters than free slots. */
  async resync(onChanged: () => Promise<void> | void): Promise<void> {
    this.error = null;
    this.notice = null;
    await this.#loadAndMaybeImport(onChanged);
  }

  async #importKeys(candidates: AccountCandidate[], onChanged: () => Promise<void> | void): Promise<void> {
    this.phase = 'importing';
    const r = await importBlizzardCharacters(candidates.map((c) => ({ realmSlug: c.realmSlug, name: c.name })));
    if (!r.ok) {
      this.error = r.error;
      this.phase = 'choosing'; // let them retry / adjust
      return;
    }
    this.notice = `Synced ${r.value.imported} character${r.value.imported === 1 ? '' : 's'} from Battle.net.`;
    this.roster = null;
    this.phase = 'idle';
    await onChanged();
  }

  cancel(): void {
    this.phase = 'idle';
    this.roster = null;
    this.error = null;
  }

  dismiss(): void {
    this.error = null;
    this.notice = null;
  }
}

export const blizzardLink = new BlizzardLinkState();
