/*
 * Top-down office illustrations for the Home floor plan, drawn like the app's comic look: ink outlines,
 * hard offset shadows and flat cel shading. Decoration only (aria-hidden), not UI icons.
 * Every paint is a theme token (`fill-office-*`, `fill-chart-*`), so the scene follows light/dark mode.
 */

type ArtProps = { className?: string };

const INK = 2.2;
const SHADOW = 3;
const KEY_COLUMNS = 9;
const KEY_ROWS = 3;
const BOOK_COLORS = ['fill-chart-1', 'fill-chart-3', 'fill-chart-4', 'fill-chart-2', 'fill-chart-5'];
const BOOK_WIDTHS = [7, 5, 9, 6, 8, 5, 7, 10, 6, 8, 5, 7];

const inked = (fill: string) => `${fill} stroke-office-ink`;

/**
 * Top-down doorway in a vertical wall, drawn like a floor-plan door: the opening cuts both rooms' borders,
 * ink jambs cap it, and the wood leaf stands open into the room on the right with a dashed swing arc.
 * Rotate the svg to put the door in a horizontal wall, mirror it to open the other way.
 */
export function DoorwayArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 80 80" className={className} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <rect x="29" y="25" width="22" height="30" className="fill-office-wall" />
      <rect x="29" y="21" width="22" height="5" rx="1.5" className="fill-office-ink" />
      <rect x="29" y="54" width="22" height="5" rx="1.5" className="fill-office-ink" />
      <path
        d="M75 28A27 27 0 0 1 48 55"
        className="fill-none stroke-office-ink/60"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <rect x="47" y="24" width="29" height="5" rx="1.5" className={inked('fill-office-wood')} strokeWidth={INK} />
      <circle cx="48" cy="26.5" r="2" className="fill-office-ink" />
    </svg>
  );
}

/** A rounded box with its comic drop shadow: the shadow first, then the inked shape on top. */
function Box({
  x,
  y,
  width,
  height,
  rx,
  fill,
  hasShadow = true,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  fill: string;
  hasShadow?: boolean;
}) {
  return (
    <>
      {hasShadow && (
        <rect x={x + SHADOW} y={y + SHADOW} width={width} height={height} rx={rx} className="fill-office-ink" />
      )}
      <rect x={x} y={y} width={width} height={height} rx={rx} className={inked(fill)} strokeWidth={INK} />
    </>
  );
}

function Disc({
  cx,
  cy,
  r,
  fill,
  hasShadow = true,
}: {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  hasShadow?: boolean;
}) {
  return (
    <>
      {hasShadow && <circle cx={cx + SHADOW} cy={cy + SHADOW} r={r} className="fill-office-ink" />}
      <circle cx={cx} cy={cy} r={r} className={inked(fill)} strokeWidth={INK} />
    </>
  );
}

/** A desk seen from above: wood top with grain and edge, monitor (glowing while working), keyboard, mouse, mug, papers. */
export function DeskArt({
  isLead = false,
  isScreenOn = false,
  className,
}: ArtProps & { isLead?: boolean; isScreenOn?: boolean }) {
  const w = isLead ? 200 : 160;
  const cx = w / 2 - 2;
  return (
    <svg viewBox={`0 0 ${w} 86`} className={className} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <Box x={3} y={4} width={w - 10} height={74} rx={6} fill="fill-office-wood" />
      <path d={`M4 66H${w - 8}`} className="stroke-office-ink" strokeWidth={INK} />
      <rect x={4.5} y={67} width={w - 13} height={9.5} rx={4} className="fill-office-shade/30" />
      <path
        d={`M14 22H${w - 22}M20 38H${w - 30}M12 54H${w - 40}`}
        className="stroke-office-shade/20"
        strokeWidth="1.5"
      />
      {isScreenOn && (
        <path
          d={`M${cx - 30} 25L${cx + 30} 25L${cx + 46} 50L${cx - 46} 50Z`}
          className="fill-office-screen/40 stroke-office-screen motion-safe:animate-pulse"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      <ellipse cx={cx} cy="13" rx="9" ry="4.5" className={inked('fill-office-metal')} strokeWidth={INK} />
      <Box x={cx - 37} y={16} width={74} height={9} rx={4} fill="fill-office-metal" />
      <rect
        x={cx - 33}
        y="21.5"
        width="66"
        height="2.5"
        rx="1.25"
        className={isScreenOn ? 'fill-office-screen' : 'fill-office-highlight/30'}
      />
      <Box x={cx - 27} y={43} width={54} height={16} rx={3} fill="fill-office-highlight" />
      {Array.from({ length: KEY_ROWS * KEY_COLUMNS }, (_, i) => (
        <rect
          key={i}
          x={cx - 23.5 + (i % KEY_COLUMNS) * 5.4}
          y={46 + Math.floor(i / KEY_COLUMNS) * 4}
          width="4"
          height="2.6"
          rx="0.6"
          className="fill-office-ink/35"
        />
      ))}
      <Box x={cx + 33} y={45} width={10} height={14} rx={5} fill="fill-office-highlight" />
      <path d={`M${cx + 38} 46V51`} className="stroke-office-ink" strokeWidth="1.3" />
      <g transform="rotate(-9 24 34)">
        <Box x={12} y={14} width={25} height={32} rx={1.5} fill="fill-office-highlight" />
        <path d="M16 21H31M16 26H32M16 31H28M16 36H30" className="stroke-office-ink/40" strokeWidth="1.4" />
      </g>
      <Disc cx={w - 28} cy={24} r={8.5} fill="fill-office-highlight" />
      <circle cx={w - 28} cy="24" r="5" className="fill-office-pot" />
      <circle cx={w - 29.5} cy="22.5" r="1.4" className="fill-office-highlight/70" />
      <rect
        x={w - 20}
        y="20.5"
        width="5.5"
        height="7"
        rx="2.75"
        className={inked('fill-office-highlight')}
        strokeWidth="1.6"
      />
      {isLead && (
        <g>
          <circle cx={w - 32} cy="54" r="17" className="fill-chart-1/35" />
          <Disc cx={w - 32} cy={54} r={8} fill="fill-office-metal" />
          <circle cx={w - 32} cy="54" r="3.8" className="fill-chart-1" />
        </g>
      )}
    </svg>
  );
}

/** Office chair from above: five-star base, seat, armrests and a backrest behind the sitter. */
export function ChairArt({ className }: ArtProps) {
  const legs = [0, 72, 144, 216, 288].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: 40 + Math.cos(rad) * 32, y: 42 + Math.sin(rad) * 32 };
  });
  return (
    <svg viewBox="0 0 84 84" className={className} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      {legs.map((leg, i) => (
        <g key={i}>
          <path d={`M40 42L${leg.x} ${leg.y}`} className="stroke-office-ink" strokeWidth="6.5" />
          <path d={`M40 42L${leg.x} ${leg.y}`} className="stroke-office-metal" strokeWidth="3" />
          <circle cx={leg.x} cy={leg.y} r="3.5" className={inked('fill-office-metal')} strokeWidth="1.6" />
        </g>
      ))}
      <Box x={13} y={13} width={54} height={50} rx={16} fill="fill-office-chair" />
      <rect x="19" y="18" width="42" height="7" rx="3.5" className="fill-office-highlight/30" />
      <Box x={4} y={24} width={10} height={30} rx={5} fill="fill-office-metal" hasShadow={false} />
      <Box x={66} y={24} width={10} height={30} rx={5} fill="fill-office-metal" hasShadow={false} />
      <Box x={9} y={58} width={62} height={18} rx={9} fill="fill-office-chair" />
      <rect x="11" y="67" width="58" height="7.5" rx="3.75" className="fill-office-shade/30" />
    </svg>
  );
}

function Leaves({ cx, cy, length, angles }: { cx: number; cy: number; length: number; angles: number[] }) {
  return (
    <>
      {angles.map((deg, i) => (
        <g key={deg} transform={`rotate(${deg} ${cx} ${cy})`}>
          <ellipse
            cx={cx}
            cy={cy - length / 2}
            rx={length / 4}
            ry={length / 2}
            className={inked(i % 2 ? 'fill-office-leaf-dark' : 'fill-office-leaf')}
            strokeWidth="1.8"
          />
          <path d={`M${cx} ${cy - 2}V${cy - length + 3}`} className="stroke-office-ink/50" strokeWidth="1.2" />
        </g>
      ))}
    </>
  );
}

/** Potted plant from above: terracotta rim, soil and inked leaves with midribs. */
export function PlantArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 68 68" className={className} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <Disc cx={32} cy={32} r={18} fill="fill-office-pot" />
      <circle cx="32" cy="32" r="13.5" className="fill-office-shade/55" />
      <Leaves cx={32} cy={32} length={28} angles={[0, 52, 104, 156, 208, 260, 312]} />
      <circle cx="32" cy="32" r="4" className={inked('fill-office-leaf-dark')} strokeWidth="1.6" />
    </svg>
  );
}

/** Bookshelf against a wall: shelf frame with colored spines. */
export function BookshelfArt({ className }: ArtProps) {
  let x = 7;
  const books = BOOK_WIDTHS.map((width, i) => {
    const book = { x, width, color: BOOK_COLORS[i % BOOK_COLORS.length] };
    x += width + 1.4;
    return book;
  });
  return (
    <svg viewBox="0 0 126 34" className={className} strokeLinejoin="round" aria-hidden>
      <Box x={2} y={2} width={118} height={27} rx={3} fill="fill-office-wood" />
      {books.map((book, i) => (
        <rect
          key={i}
          x={book.x}
          y="6"
          width={book.width}
          height="16"
          rx="1"
          className={inked(book.color)}
          strokeWidth="1.4"
        />
      ))}
      <path d="M3 23.5H119" className="stroke-office-ink" strokeWidth={INK} />
    </svg>
  );
}

/** Two-seat sofa with a small coffee table in front of it. */
export function LoungeArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 112 102" className={className} strokeLinejoin="round" aria-hidden>
      <Box x={3} y={3} width={100} height={46} rx={12} fill="fill-office-chair" />
      <path d="M8 17H98" className="stroke-office-ink" strokeWidth={INK} />
      <rect x="5" y="5" width="96" height="11" rx="5" className="fill-office-shade/30" />
      <Box x={17} y={20} width={35} height={25} rx={6} fill="fill-office-chair" hasShadow={false} />
      <Box x={54} y={20} width={35} height={25} rx={6} fill="fill-office-chair" hasShadow={false} />
      <rect x="20" y="23" width="12" height="4" rx="2" className="fill-office-highlight/35" />
      <rect x="57" y="23" width="12" height="4" rx="2" className="fill-office-highlight/35" />
      <Box x={26} y={60} width={52} height={30} rx={7} fill="fill-office-wood" />
      <Disc cx={41} cy={74} r={5.5} fill="fill-office-highlight" hasShadow={false} />
      <circle cx="41" cy="74" r="3" className="fill-office-pot" />
      <rect x="53" y="67" width="17" height="13" rx="1.5" className={inked('fill-chart-3')} strokeWidth="1.6" />
    </svg>
  );
}

function SmallChair({ x, y, isFacingDown }: { x: number; y: number; isFacingDown: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Box x={0} y={0} width={22} height={20} rx={7} fill="fill-office-chair" />
      <path d={isFacingDown ? 'M2 7H20' : 'M2 13H20'} className="stroke-office-ink" strokeWidth="1.8" />
    </g>
  );
}

/** Oval meeting table with chairs on both sides, laptops, notes and water. */
export function MeetingTableArt({ className }: ArtProps) {
  const seats = [40, 88, 136, 184];
  return (
    <svg viewBox="0 0 250 122" className={className} strokeLinejoin="round" aria-hidden>
      {seats.map((x) => (
        <SmallChair key={`top-${x}`} x={x} y={3} isFacingDown />
      ))}
      {seats.map((x) => (
        <SmallChair key={`bottom-${x}`} x={x} y={96} isFacingDown={false} />
      ))}
      <Box x={10} y={22} width={226} height={72} rx={36} fill="fill-office-wood" />
      <rect x="44" y="28" width="150" height="4" rx="2" className="fill-office-highlight/40" />
      <Box x={44} y={36} width={28} height={18} rx={2} fill="fill-office-metal" hasShadow={false} />
      <rect x="47" y="39" width="22" height="12" rx="1" className="fill-office-screen" />
      <Box x={152} y={62} width={28} height={18} rx={2} fill="fill-office-metal" hasShadow={false} />
      <rect x="155" y="65" width="22" height="12" rx="1" className="fill-office-screen" />
      <g transform="rotate(8 110 58)">
        <Box x={98} y={43} width={23} height={29} rx={1.5} fill="fill-office-highlight" />
        <path d="M102 50H117M102 55H118M102 60H112" className="stroke-office-ink/40" strokeWidth="1.4" />
      </g>
      <Disc cx={82} cy={72} r={5} fill="fill-office-screen" hasShadow={false} />
      <Disc cx={200} cy={44} r={5} fill="fill-office-screen" hasShadow={false} />
    </svg>
  );
}
