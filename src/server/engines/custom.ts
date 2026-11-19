import { EMPTY_USAGE, type EngineAdapter } from './types.ts';

/** Any user command: prompt on stdin, plain-text stdout, no session. */
export const custom: EngineAdapter = {
  command(agent) {
    if (!agent.command.trim()) throw new Error(`Agent "${agent.name}" has no command`);
    return [agent.command.trim(), agent.extraArgs.trim()].filter(Boolean).join(' ');
  },
  parse(stdout, stderr, exitCode) {
    return {
      // A silent failure still needs a reason the human can read.
      text: stdout.trim() || stderr.trim() || (exitCode !== 0 ? `command exited with code ${exitCode}` : ''),
      sessionId: null,
      usage: EMPTY_USAGE,
      isError: exitCode !== 0,
    };
  },
};
