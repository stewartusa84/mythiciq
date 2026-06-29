# MythicIQ (WoW addon)

Bridges a MythicIQ-coordinated group into WoW's **Premade Group Finder**. Install by copying the
`MythicIQ` folder into `World of Warcraft/_retail_/Interface/AddOns/`, then `/reload`.

## Use it

1. In the **MythicIQ app** (Groups tab), open a Run Card and click **Addon** to copy your code.
2. In-game, type `/miq` and paste it into the single field, then press **Load**. The addon detects
   whether you're the leader or an applicant and does the right thing.

**Leader** — the Group Finder opens. The addon shows a click-to-copy **listing name**
(e.g. `MythicIQ 37DF1Q`); paste it as your premade's title. A live roster then tracks every expected
player: **Awaiting → Applied → Joined** (rows flash as their state changes).

**Applicant** — the Group Finder opens and the group name is dropped into the search box where possible.
Search for it and apply with your role.

The addon makes **no protected API calls** — it only opens UI and reads applicant/group info, so it can't
taint or auto-apply. Searching and applying are always done by the player.

## Manifest format (the contract)

One pipe-delimited line with percent-encoded values. The app writer is
`packages/app/src/mvp/addonManifest.ts`; the reader is `ParseManifest`/`UrlDecode` in `MythicIQ.lua`.
**Change one ⇒ change both.**

```
Leader:    MIQ1|MODE=LEADER|CODE=37DF1Q|NAME=MythicIQ%2037DF1Q|P1=Name-Realm|P2=Name-Realm
Applicant: MIQ1|MODE=APPLY|CODE=37DF1Q|NAME=MythicIQ%2037DF1Q|ROLE=DAMAGER
```

| Field   | Who      | Meaning |
| ------- | -------- | ------- |
| `MIQ1`  | both     | Format version marker (must be first). |
| `MODE`  | both     | `LEADER` or `APPLY`. |
| `CODE`  | both     | Stable 6-char base36 code derived from the Run Card id — identical for leader and every applicant of a run. |
| `NAME`  | both     | Listing name to use/search. Optional; defaults to `MythicIQ <CODE>`. |
| `P1..n` | leader   | Expected players as `Name-Realm` (the accepted roster, minus the leader). |
| `ROLE`  | applicant| `TANK` / `HEALER` / `DAMAGER`. |

**Encoding** (reversed by `UrlDecode`): `%`→`%25` (replace first), `|`→`%7C`, `=`→`%3D`, `,`→`%2C`,
space→`%20`. Use realm **display names** (`Area 52`), not slugs — `NormalizeNameRealm` strips spaces and
lowercases both the manifest value and the in-game `UnitName` realm so they match.

## Slash commands

- `/miq` — open/close the panel.
- `/miq paste <manifest>` — load a manifest directly.
- `/miq open` — open the Group Finder.
- `/miq clear` — clear the loaded manifest.

## Verify in-game

Two paths aren't confirmed against a live client (both have a click-to-copy fallback if they differ):
the search-box frame path `LFGListFrame.SearchPanel.SearchBox`, and that armory realm display names equal
WoW's `UnitName` realm strings.
