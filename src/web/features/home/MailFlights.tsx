import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { USER_ID, type Message } from '@/lib/api';

/** Elements a letter can fly from or to carry this attribute with the agent id (or USER_ID for the composer). */
export const MAIL_ANCHOR = 'data-mail-anchor';
const FLIGHT_MS = 1200;
const ARC_STEPS = 12;
const MAX_LIFT_PX = 180;
/** Messages created a moment before mount still count (the composer's own send can race the page). */
const FRESH_SLACK_MS = 2000;

type Point = { x: number; y: number };
type Flight = { id: string; from: Point; to: Point; targetId: string };

/**
 * Comic envelopes flying between desks for every new message on the plan: the user's composer to an agent,
 * and agent to agent (the lead handing out work, reports coming back). History never flies.
 */
export function MailFlights({ messages, onArrive }: { messages: Message[]; onArrive: (agentId: string) => void }) {
  const [mountedAt] = useState(() => Date.now());
  const seen = useRef(new Set<string>());
  const [flights, setFlights] = useState<Flight[]>([]);
  useEffect(() => {
    const fresh = messages.filter(
      (m) => !seen.current.has(m.id) && Date.parse(m.createdAt) >= mountedAt - FRESH_SLACK_MS,
    );
    for (const m of messages) seen.current.add(m.id);
    const next = fresh.flatMap((m): Flight[] => {
      if (m.toId === USER_ID) return [];
      const from = anchorCenter(m.fromId);
      const to = anchorCenter(m.toId);
      return from && to ? [{ id: m.id, from, to, targetId: m.toId }] : [];
    });
    if (next.length) setFlights((current) => [...current, ...next]);
  }, [messages, mountedAt]);
  const land = useCallback(
    (flight: Flight) => {
      setFlights((current) => current.filter((f) => f.id !== flight.id));
      onArrive(flight.targetId);
    },
    [onArrive],
  );
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      {flights.map((flight) => (
        <Letter key={flight.id} flight={flight} onLand={land} />
      ))}
    </div>
  );
}

function anchorCenter(id: string): Point | null {
  const el = document.querySelector(`[${MAIL_ANCHOR}="${CSS.escape(id)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** One envelope following a quadratic arc above both ends, growing at the top of the arc like it comes closer. */
function Letter({ flight, onLand }: { flight: Flight; onLand: (flight: Flight) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = flight;
    const lift = Math.min(MAX_LIFT_PX, Math.hypot(to.x - from.x, to.y - from.y) / 2);
    const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
    const frames = Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const s = i / ARC_STEPS;
      const x = (1 - s) ** 2 * from.x + 2 * (1 - s) * s * control.x + s ** 2 * to.x;
      const y = (1 - s) ** 2 * from.y + 2 * (1 - s) * s * control.y + s ** 2 * to.y;
      const scale = 0.7 + Math.sin(Math.PI * s) * 0.6 - (s === 1 ? 0.3 : 0);
      const tilt = -14 + 26 * s;
      return {
        transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale}) rotate(${tilt}deg)`,
        opacity: i === 0 ? 0 : 1,
      };
    });
    const isReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = el.animate(frames, {
      duration: isReduced ? 1 : FLIGHT_MS,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    animation.onfinish = () => onLand(flight);
    return () => animation.cancel();
  }, [flight, onLand]);
  return (
    <span
      ref={ref}
      className="absolute top-0 left-0 rounded-sm border-2 border-office-ink bg-office-highlight p-1 text-office-ink opacity-0 ink-shadow"
    >
      <Mail className="size-5" />
    </span>
  );
}
