import { useMemo } from "react";
import { areaY, barY, defineChart, lineY } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart as TanStackChart } from "@tanstack/charts/react";

import { cn } from "@/lib/utils";

/**
 * One chart, and the only file that knows which charting library draws it.
 *
 * @tanstack/charts is at 0.x, so the whole dependency is kept behind this
 * component: swapping it later is editing one file rather than every node that
 * happens to draw something.
 */

export type ChartType = "line" | "bar" | "area";

export interface ChartPoint {
  x: string | number;
  [series: string]: string | number | null | undefined;
}

/**
 * The categorical slots, in fixed order and never cycled.
 *
 * Both columns are the same eight hues stepped for their own surface rather
 * than one palette lightened; the order is the colourblind-safety mechanism,
 * not decoration, so a series keeps its slot when its neighbours disappear.
 */
const SERIES_LIGHT = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

const SERIES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

/** Past this many, colour stops telling them apart. */
export const MAX_SERIES = 8;

function isDark(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

export function seriesColour(index: number): string {
  const slots = isDark() ? SERIES_DARK : SERIES_LIGHT;
  return slots[index % slots.length];
}

export function FlowChart({
  points,
  series,
  type,
  height = 180,
  label,
}: {
  points: ChartPoint[];
  series: string[];
  type: ChartType;
  height?: number;
  label: string;
}) {
  const definition = useMemo(() => {
    const mark = type === "bar" ? barY : type === "area" ? areaY : lineY;

    return defineChart({
      marks: series.slice(0, MAX_SERIES).map((name, index) =>
        mark(points, {
          x: (point: ChartPoint) => point.x,
          y: (point: ChartPoint) => {
            const value = Number(point[name]);
            return Number.isFinite(value) ? value : null;
          },
          // 2px: a data line is the subject, not a hairline and not a slab
          ...(type === "line"
            ? { stroke: seriesColour(index), strokeWidth: 2 }
            : { fill: seriesColour(index) }),
        })
      ),
      scales: {
        // bars sit in bands; a line over time reads on a continuous axis
        x: type === "bar" ? { scale: scaleBand } : { scale: scaleLinear },
        y: { scale: scaleLinear, nice: true },
      },
    });
  }, [points, series, type]);

  return (
    <div className="space-y-1">
      <TanStackChart definition={definition} height={height} ariaLabel={label} />

      {/* a legend from two series up, so identity is never colour alone */}
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label="Series">
          {series.slice(0, MAX_SERIES).map((name, index) => (
            <li
              key={name}
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
            >
              <span
                aria-hidden
                className={cn("h-2 w-2 shrink-0 rounded-sm")}
                style={{ background: seriesColour(index) }}
              />
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
