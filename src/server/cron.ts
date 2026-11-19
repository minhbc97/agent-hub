/** Minimal 5-field cron: minute hour day-of-month month day-of-week. Supports *, lists, ranges, steps. */

// Day-of-week accepts 0-7; 7 is folded into 0 (Sunday).
const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

export function parseCron(expr: string): Set<number>[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron needs exactly 5 fields: minute hour day month weekday');
  const sets = parts.map((p, i) => parseField(p, RANGES[i]!));
  if (sets[4]!.delete(7)) sets[4]!.add(0);
  return sets;
}

function parseField(field: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid step: ${part}`);
    let lo: number;
    let hi: number;
    if (range === '*') [lo, hi] = [min, max === 7 ? 6 : max];
    else if (range!.includes('-')) [lo, hi] = range!.split('-').map(Number) as [number, number];
    else {
      lo = Number(range);
      hi = stepStr === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`value outside ${min}-${max}: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function cronMatches(expr: string, d: Date): boolean {
  const [mi, h, dom, mon, dow] = parseCron(expr);
  return (
    mi!.has(d.getMinutes()) &&
    h!.has(d.getHours()) &&
    dom!.has(d.getDate()) &&
    mon!.has(d.getMonth() + 1) &&
    dow!.has(d.getDay())
  );
}

/** Next n times the expression fires, scanning up to ~2 months ahead. */
export function nextRuns(expr: string, n = 3, from = new Date()): Date[] {
  parseCron(expr);
  const out: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 62 && out.length < n; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (cronMatches(expr, d)) out.push(new Date(d));
  }
  return out;
}

/** Key for "this minute", so a schedule fires once per matching minute. */
export function minuteKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
