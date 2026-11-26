export const MOTION = {
  page: { offsetY: 8, duration: 0.18, ease: 'easeOut' as const },
  list: { offsetY: 8, duration: 0.16, ease: 'easeOut' as const },
  coachmark: {
    characterStart: { x: -96, y: 64, rotate: -35, scale: 0.3, opacity: 0 },
    characterRest: { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 },
    character: { type: 'spring' as const, stiffness: 260, damping: 18, delay: 0.12 },
    floatDistance: 5,
    floatRotation: 3,
    float: {
      duration: 2.4,
      ease: 'easeInOut' as const,
      delay: 0.6,
      repeat: Infinity,
      repeatType: 'reverse' as const,
    },
    bubbleStart: { scale: 0.2, x: -24, opacity: 0 },
    bubbleRest: { scale: 1, x: 0, opacity: 1 },
    bubble: { type: 'spring' as const, stiffness: 320, damping: 16, delay: 0.38 },
    spotlight: { duration: 0.18, ease: 'easeOut' as const },
  },
} as const;
