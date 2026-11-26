import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { markSeen, useCoachmark } from '@/lib/coachmarks';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverTitle } from '@/components/ui/popover';
import { Avatar } from '@/components/shared';
import { MOTION } from '@/lib/motion';

/** Every coachmark in the app; its title and body live under `guide.<id>` in the locales. */
export const COACHMARK = {
  needsYou: 'needsYou',
  leanMode: 'leanMode',
  fallbackEngine: 'fallbackEngine',
  terminal: 'terminal',
  taskChanges: 'taskChanges',
} as const;
export type CoachmarkId = (typeof COACHMARK)[keyof typeof COACHMARK];

/** The guide character: a fixed face from the agent avatar set, on the brand color so it never reads as an agent. */
const GUIDE = { name: 'guide', avatarSeed: 'Guide', tint: 'transparent' };

export function GuideMascot({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full border-2 border-foreground bg-primary comic-shadow-sm',
        className,
      )}
    >
      <Avatar agent={GUIDE} size={size} />
    </span>
  );
}

/** Room left around the target inside the spotlight, in px. */
const SPOTLIGHT_PAD = 6;

/** Where the target sits on screen, followed every frame while shown; null while it is scrolled out of view. */
function useTargetRect(target: React.RefObject<Element | null>, isActive: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!isActive) return setRect(null);
    let frame = 0;
    const track = () => {
      const next = target.current?.getBoundingClientRect() ?? null;
      const isVisible =
        !!next &&
        next.width > 0 &&
        next.bottom > 0 &&
        next.top < innerHeight &&
        next.right > 0 &&
        next.left < innerWidth;
      setRect((current) => (!isVisible ? null : current && sameRect(current, next) ? current : next));
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [target, isActive]);
  return rect;
}

const sameRect = (a: DOMRect, b: DOMRect) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Dims and blurs the page around the target, leaving it lit. Four panels rather than one with a hole, because
 * a backdrop blur cannot have a hole cut in it. Clicks pass through, so the page stays usable.
 */
function Spotlight({ rect }: { rect: DOMRect }) {
  const top = rect.top - SPOTLIGHT_PAD;
  const left = rect.left - SPOTLIGHT_PAD;
  const bottom = rect.bottom + SPOTLIGHT_PAD;
  const right = rect.right + SPOTLIGHT_PAD;
  const panel = 'pointer-events-none fixed z-50 bg-overlay supports-backdrop-filter:backdrop-blur-xs';
  return createPortal(
    <motion.div
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={MOTION.coachmark.spotlight}
    >
      <div className={cn(panel, 'inset-x-0 top-0')} style={{ height: Math.max(0, top) }} />
      <div className={cn(panel, 'inset-x-0 bottom-0')} style={{ top: bottom }} />
      <div className={cn(panel, 'left-0')} style={{ top, height: bottom - top, width: Math.max(0, left) }} />
      <div className={cn(panel, 'right-0')} style={{ top, height: bottom - top, left: right }} />
      <div
        className="pointer-events-none fixed z-50 rounded-lg ring-2 ring-primary"
        style={{ top, left, width: right - left, height: bottom - top }}
      />
    </motion.div>,
    document.body,
  );
}

const skipAll = () => Object.values(COACHMARK).forEach((id) => markSeen(`coachmark.${id}`));

/**
 * Points at `children` the first time the user sees it, until they close it: the guide character flies in
 * beside it with a comic speech bubble. Only one shows at a time. The child must take a ref.
 */
export function Coachmark({
  id,
  side = 'bottom',
  children,
}: {
  id: CoachmarkId;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactElement;
}) {
  const key = `coachmark.${id}`;
  const isOpen = useCoachmark(key);
  const target = useRef<HTMLDivElement>(null);
  const rect = useTargetRect(target, isOpen);
  return (
    <Popover open={isOpen} onOpenChange={(open) => !open && markSeen(key)}>
      {/* Mounts after the bubble (it waits for the first measure), so the bubble sits a layer higher: z-60. */}
      <AnimatePresence>{rect && <Spotlight key="spotlight" rect={rect} />}</AnimatePresence>
      <PopoverAnchor asChild ref={target}>
        {children}
      </PopoverAnchor>
      {/* No focus move: the user keeps typing or clicking where they were. The character and bubble carry the look. */}
      <PopoverContent
        side={side}
        sideOffset={10}
        className="z-60 w-auto flex-row items-end gap-3 bg-transparent p-0 shadow-none ring-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Waits off screen while its target is scrolled out of view, and stays until the user answers it:
        // a click elsewhere in the page must not count as having read it.
        hideWhenDetached
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Fly-in and float sit on separate elements so one animation does not override the other. */}
        <motion.span
          initial={MOTION.coachmark.characterStart}
          animate={MOTION.coachmark.characterRest}
          transition={MOTION.coachmark.character}
        >
          <motion.span
            animate={{
              y: [0, -MOTION.coachmark.floatDistance, 0],
              rotate: [0, -MOTION.coachmark.floatRotation, 0],
            }}
            transition={MOTION.coachmark.float}
          >
            <GuideMascot />
          </motion.span>
        </motion.span>
        <motion.div
          initial={MOTION.coachmark.bubbleStart}
          animate={MOTION.coachmark.bubbleRest}
          transition={MOTION.coachmark.bubble}
          className="relative max-w-80 rounded-xl border-2 border-foreground bg-card px-4 py-3 text-card-foreground comic-shadow"
        >
          <span
            aria-hidden
            className="absolute bottom-5 -left-2 size-3.5 rotate-45 border-b-2 border-l-2 border-foreground bg-card"
          />
          <PopoverTitle className="text-xs font-black tracking-wider text-primary-ink uppercase">
            {t(`guide.${id}.title`)}
          </PopoverTitle>
          <PopoverDescription className="mt-1 text-sm/5 text-card-foreground">
            {t(`guide.${id}.body`)}
          </PopoverDescription>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={skipAll}>
              {t('guide.skipAll')}
            </Button>
            <Button size="sm" onClick={() => markSeen(key)}>
              {t('guide.gotIt')}
            </Button>
          </div>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}
