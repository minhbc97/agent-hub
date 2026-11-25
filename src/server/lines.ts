/** A JSON event is one line and may carry a whole file; a longer line is skipped rather than buffered. */
const MAX_LINE_CHARS = 4_000_000;

/** Split a chunked stream into lines. */
export function lineReader(onLine: (line: string) => void) {
  let pending = '';
  let isSkipping = false;
  const read = (line: string) => {
    try {
      if (line.trim()) onLine(line);
    } catch (err) {
      // Reading along must never take the turn down with it.
      console.error('output line skipped', err instanceof Error ? err.message : '');
    }
  };
  return {
    push(chunk: string) {
      const lines = chunk.split(/\r?\n/);
      lines[0] = pending + lines[0]!;
      pending = lines.pop()!;
      if (isSkipping && lines.length) {
        lines.shift();
        isSkipping = false;
      }
      lines.forEach(read);
      if (isSkipping || pending.length > MAX_LINE_CHARS) {
        pending = '';
        isSkipping = true;
      }
    },
    flush() {
      read(pending);
      pending = '';
    },
  };
}
