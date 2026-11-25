import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { parseJsonLine } from './engines/json.ts';
import type { LiveProtocol } from './engines/index.ts';
import { lineReader } from './lines.ts';

export interface LiveInput {
  /** Send the turn's prompt and keep the stream for what follows. */
  attach(stdin: Writable): void;
  /** Feed the CLI's output, which says what it has read and when it is done. */
  stdout(chunk: string): void;
  /** Hand the running turn one more message; false when it takes no more. */
  send(messageId: string, text: string): boolean;
  close(): void;
  /** Messages the CLI never said it read. */
  unread(): string[];
}

/** The stdin of a CLI that takes messages while it works. It stays open until the turn ends with nothing left to read. */
export function liveInput(protocol: LiveProtocol, prompt: string): LiveInput {
  const unread = new Map<string, string>();
  let stdin: Writable | null = null;
  const close = () => {
    stdin?.end();
    stdin = null;
  };
  const reader = lineReader((line) => {
    const event = parseJsonLine(line);
    if (!event) return;
    unread.delete(protocol.readId(event) ?? '');
    // A message that arrived as the turn ended starts another round, which ends with its own result.
    if (protocol.isResult(event) && !unread.size) close();
  });
  return {
    attach(stream) {
      stdin = stream;
      stream.write(protocol.encode(randomUUID(), prompt));
    },
    stdout: reader.push,
    send(messageId, text) {
      if (!stdin?.writable) return false;
      const id = randomUUID();
      unread.set(id, messageId);
      stdin.write(protocol.encode(id, text));
      return true;
    },
    close,
    unread: () => [...unread.values()],
  };
}
