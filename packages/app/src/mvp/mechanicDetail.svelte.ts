// Global "open mechanic detail" state — lets any component (avoidable-damage rows, the library tiles)
// pop the full MechanicCard in a ROOT-LEVEL overlay (mounted once in App), so the detail pane floats
// over everything regardless of where it was triggered. Kept deliberately tiny: just the focused spell
// id + open/close. The overlay is sized large because cards will grow video content.
class MechanicDetailStore {
  spellId = $state<number | null>(null);

  open(spellId: number): void {
    this.spellId = spellId;
  }
  close(): void {
    this.spellId = null;
  }
}

export const mechanicDetail = new MechanicDetailStore();
