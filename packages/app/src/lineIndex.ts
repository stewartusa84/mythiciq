// Maps event index -> original log line, without holding the whole 239MB file in
// memory. The parser keeps exactly one row per non-empty (\r-stripped) line, in order,
// so event index === kept-line index. We stream the file once to record each kept
// line's [start, end) byte range, then slice the File on demand to read a single line.
//
// The "kept" rule mirrors the Rust builder: a line (split on \n, trailing \r removed)
// is kept iff it is non-empty.

const NL = 0x0a;
const CR = 0x0d;

export class LineIndex {
  private constructor(
    private readonly file: File,
    private readonly starts: number[],
    private readonly ends: number[],
  ) {}

  get count(): number {
    return this.starts.length;
  }

  /** The original log line for event index `i` (decoded UTF-8), or '' if out of range. */
  async line(i: number): Promise<string> {
    if (i < 0 || i >= this.starts.length) return '';
    return this.file.slice(this.starts[i]!, this.ends[i]!).text();
  }

  /**
   * Raw bytes spanning kept lines [from, toInclusive] of the original file — one contiguous slice
   * (runs are contiguous line ranges). Includes the line separators between them. Used to carve a
   * single run out of a whole-night log for local history.
   */
  async bytesForLines(from: number, toInclusive: number): Promise<Uint8Array> {
    const a = Math.max(0, from);
    const b = Math.min(this.ends.length - 1, toInclusive);
    if (b < a) return new Uint8Array(0);
    const buf = await this.file.slice(this.starts[a]!, this.ends[b]!).arrayBuffer();
    return new Uint8Array(buf);
  }

  static async build(file: File, onProgress?: (ratio: number) => void): Promise<LineIndex> {
    const reader = file.stream().getReader();
    const total = file.size;
    const starts: number[] = [];
    const ends: number[] = [];
    let g = 0; // global offset of the current chunk's start
    let lineStart = 0; // global offset of the current line's start
    let prevByte = -1; // last byte of the previous chunk (for \r before a chunk-boundary \n)

    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = value;
      let from = 0;
      for (;;) {
        const nl = chunk.indexOf(NL, from);
        if (nl === -1) break;
        const nlGlobal = g + nl;
        const beforeByte = nl > 0 ? chunk[nl - 1]! : prevByte;
        const contentEnd = beforeByte === CR ? nlGlobal - 1 : nlGlobal;
        if (contentEnd > lineStart) {
          starts.push(lineStart);
          ends.push(contentEnd);
        }
        lineStart = nlGlobal + 1;
        from = nl + 1;
      }
      prevByte = chunk.length > 0 ? chunk[chunk.length - 1]! : prevByte;
      g += chunk.length;
      onProgress?.(total > 0 ? g / total : 1);
    }
    // trailing line without a final newline
    if (lineStart < g) {
      const end = prevByte === CR ? g - 1 : g;
      if (end > lineStart) {
        starts.push(lineStart);
        ends.push(end);
      }
    }
    return new LineIndex(file, starts, ends);
  }
}
