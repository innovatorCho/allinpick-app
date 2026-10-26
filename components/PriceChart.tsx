import type { PriceHistoryEntry } from "@/lib/domain/types";
import { formatKrw, formatDate } from "@/lib/format";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CHART_WIDTH = 300;
const CHART_HEIGHT = 110;
const PADDING_X = 10;
const PADDING_Y = 18; // extra room top/bottom so the 최저/최고 labels never clip

interface ChartData {
  heading: string;
  windowed: PriceHistoryEntry[];
}

// Plain helper (not a component) so reading the current time here doesn't
// trip the React "components must be pure" rule — it's a one-shot,
// request-time computation on the server, not a value React re-renders with.
function buildChartData(history: PriceHistoryEntry[]): ChartData {
  const now = Date.now();
  const firstRecordedAt = new Date(history[0].recordedAt).getTime();
  const daysElapsed = Math.max(1, Math.floor((now - firstRecordedAt) / (24 * 60 * 60 * 1000)) + 1);

  const heading =
    daysElapsed <= 1
      ? "가격 데이터가 쌓이고 있습니다"
      : daysElapsed >= 7
        ? "최근 7일 가격 추이"
        : `최근 ${daysElapsed}일 가격 추이`;

  const windowStart = now - SEVEN_DAYS_MS;
  let windowed = history.filter((h) => new Date(h.recordedAt).getTime() >= windowStart);
  // If nothing changed in the last 7 days, still show the latest known point(s) rather than an empty chart.
  if (windowed.length === 0) {
    windowed = history.slice(-2);
  }

  return { heading, windowed };
}

const LOW_COLOR = "#2563eb"; // blue-600
const HIGH_COLOR = "#d97706"; // amber-600

/**
 * Renders the recent price trend (AGENTS.md §8) plus how the current price
 * compares to the lowest/highest ever seen *over the whole tracking period*
 * (not just the windowed chart line) — same all-time range ProductCard's
 * badge uses, so the message is consistent wherever a product shows up.
 *
 * The low/high are called out three ways at once (dashed reference lines
 * spanning the chart, a marked point, and a bold summary line below) after
 * feedback that a single small label wasn't easy to spot at a glance.
 */
export function PriceChart({ history }: { history: PriceHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-zinc-500">아직 가격 데이터가 없습니다.</p>;
  }

  const { heading, windowed } = buildChartData(history);
  const allTimeMin = Math.min(...history.map((h) => h.price));
  const allTimeMax = Math.max(...history.map((h) => h.price));
  const currentPrice = history[history.length - 1].price;
  const hasRange = allTimeMin !== allTimeMax;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{heading}</p>
        {windowed.length === 1 ? (
          <p className="text-sm text-zinc-500">{formatKrw(windowed[0].price)} (데이터 1건)</p>
        ) : (
          <Sparkline points={windowed} allTimeMin={allTimeMin} allTimeMax={allTimeMax} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center gap-0.5 rounded-lg bg-blue-50 py-2 dark:bg-blue-950">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">▼ 추적 후 최저가</span>
          <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{formatKrw(allTimeMin)}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 rounded-lg bg-amber-50 py-2 dark:bg-amber-950">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">▲ 추적 후 최고가</span>
          <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{formatKrw(allTimeMax)}</span>
        </div>
      </div>

      {hasRange && currentPrice <= allTimeMin && (
        <p className="text-center text-sm font-semibold text-blue-600 dark:text-blue-400">
          🎉 지금이 추적을 시작한 이후 가장 저렴한 가격이에요.
        </p>
      )}
      {hasRange && currentPrice >= allTimeMax && (
        <p className="text-center text-sm font-semibold text-amber-600 dark:text-amber-400">
          지금은 추적을 시작한 이후 가장 비싼 가격이에요.
        </p>
      )}
    </div>
  );
}

function Sparkline({
  points,
  allTimeMin,
  allTimeMax,
}: {
  points: PriceHistoryEntry[];
  allTimeMin: number;
  allTimeMax: number;
}) {
  const windowPrices = points.map((p) => p.price);
  // Scale by the wider of (recent window, all-time range) so the min/max
  // reference lines always land inside the visible chart — even when the
  // last 7 days never actually touched the all-time extreme.
  const scaleMin = Math.min(...windowPrices, allTimeMin);
  const scaleMax = Math.max(...windowPrices, allTimeMax);
  const range = scaleMax - scaleMin || 1;
  const step = points.length > 1 ? (CHART_WIDTH - PADDING_X * 2) / (points.length - 1) : 0;

  const toY = (price: number) => PADDING_Y + (1 - (price - scaleMin) / range) * (CHART_HEIGHT - PADDING_Y * 2);

  const coords = points.map((p, i) => ({ x: PADDING_X + step * i, y: toY(p.price), entry: p }));
  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");

  const lowY = toY(allTimeMin);
  const highY = toY(allTimeMax);
  const hasRange = allTimeMin !== allTimeMax;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-28 w-full overflow-visible"
      role="img"
      aria-label="최근 가격 추이 그래프"
    >
      {/* Reference lines spanning the full width — the fastest way to see at a
          glance how today's line relates to the all-time low/high, even for
          points the recent window itself never reached. Skipped entirely
          when there's only ever been one price (low === high): two
          overlapping dashed lines at the same spot would just look broken. */}
      {hasRange && (
        <>
          <line x1={0} y1={lowY} x2={CHART_WIDTH} y2={lowY} stroke={LOW_COLOR} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <line x1={0} y1={highY} x2={CHART_WIDTH} y2={highY} stroke={HIGH_COLOR} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <text x={2} y={lowY - 3} fontSize={10} fontWeight={700} fill={LOW_COLOR}>
            최저 {formatKrw(allTimeMin)}
          </text>
          <text x={2} y={highY - 3} fontSize={10} fontWeight={700} fill={HIGH_COLOR}>
            최고 {formatKrw(allTimeMax)}
          </text>
        </>
      )}

      <polyline points={polylinePoints} fill="none" stroke="currentColor" strokeWidth={2} className="text-emerald-600" />
      {coords.map((c, i) => {
        const isAllTimeLow = hasRange && c.entry.price === allTimeMin;
        const isAllTimeHigh = hasRange && !isAllTimeLow && c.entry.price === allTimeMax;
        if (isAllTimeLow || isAllTimeHigh) {
          return <circle key={i} cx={c.x} cy={c.y} r={5} fill={isAllTimeLow ? LOW_COLOR : HIGH_COLOR} stroke="white" strokeWidth={2} />;
        }
        return <circle key={i} cx={c.x} cy={c.y} r={2.5} className="fill-emerald-600" />;
      })}
      <title>{points.map((p) => `${formatDate(p.recordedAt)} ${formatKrw(p.price)}`).join(" / ")}</title>
    </svg>
  );
}
