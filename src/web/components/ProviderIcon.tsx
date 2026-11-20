import { CodeXml, Network, SquareTerminal } from 'lucide-react';
import { siClaude, siGooglegemini, type SimpleIcon } from 'simple-icons';
import { ENGINE, type Engine } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Brand marks from simple-icons (CC0). OpenAI asked simple-icons to remove its logo, so Codex uses a Lucide
 * glyph instead of a redrawn mark; Antigravity is Google's Gemini-based CLI, so it shows the Gemini mark.
 */
const BRAND: Partial<Record<Engine, SimpleIcon>> = {
  [ENGINE.claude]: siClaude,
  [ENGINE.antigravity]: siGooglegemini,
};

export function ProviderIcon({ engine, className }: { engine: Engine; className?: string }) {
  const brand = BRAND[engine];
  if (!brand) {
    const Glyph = engine === ENGINE.codex ? CodeXml : engine === ENGINE.openrouter ? Network : SquareTerminal;
    return <Glyph aria-hidden className={cn('size-4 shrink-0', className)} />;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4 shrink-0', className)}>
      {/* The brand color comes with the icon data from the package, not from the theme. */}
      <path d={brand.path} style={{ fill: `#${brand.hex}` }} />
    </svg>
  );
}
