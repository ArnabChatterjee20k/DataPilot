import { useMemo } from "react";
import { areaY, barX, barY, defineChart, dot, lineY } from "@tanstack/charts";
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

export type ChartType = "line" | "step" | "area" | "bar" | "bars-across" | "scatter";

/** The types on offer, and the shape of data each one is for. */
export const CHART_TYPES: { value: ChartType; label: string; hint: string }[] = [
  { value: "line", label: "Line", hint: "a number over time" },
  { value: "step", label: "Step", hint: "a value that holds, then jumps" },
  { value: "area", label: "Area", hint: "a number over time, filled" },
  { value: "bar", label: "Bar", hint: "one bar per row" },
  { value: "bars-across", label: "Bars across", hint: "bars with room for labels" },
  { value: "scatter", label: "Scatter", hint: "one point per row" },
];

/**
 * A line that holds its value and then jumps, rather than sloping between
 * readings.
 *
 * Written here rather than pulled from d3-shape: a curve is two functions
 * returning path strings, which is cheaper than another dependency.
 */
const STEP_CURVE = {
  line: (points: readonly (readonly [number, number])[]) =>
    points
      .map(([x, y], index) =>
        index === 0 ? `M${x},${y}` : `H${x}V${y}`
      )
      .join(""),
  area: (
    top: readonly (readonly [number, number])[],
    bottom: readonly (readonly [number, number])[]
  ) => {
    const up = top.map(([x, y], index) => (index === 0 ? `M${x},${y}` : `H${x}V${y}`));
    const down = [...bottom]
      .reverse()
      .map(([x, y], index) => (index === 0 ? `L${x},${y}` : `H${x}V${y}`));
    return `${up.join("")}${down.join("")}Z`;
  },
};

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
    const across = type === "bars-across";
    const chosen = series.slice(0, MAX_SERIES);

    const value = (name: string) => (point: ChartPoint) => {
      const number = Number(point[name]);
      return Number.isFinite(number) ? number : null;
    };
    const along = (point: ChartPoint) => point.x;

    const marks = chosen.map((name, index) => {
      const colour = seriesColour(index);

      if (across) {
        // the categories run down the side, which is where a long label fits
        return barX(points, { x: value(name), y: along, fill: colour });
      }
      if (type === "bar") {
        return barY(points, { x: along, y: value(name), fill: colour });
      }
      if (type === "area") {
        return areaY(points, { x: along, y: value(name), fill: colour });
      }
      if (type === "scatter") {
        // >= 8px across, so a point is a mark rather than a speck
        return dot(points, { x: along, y: value(name), fill: colour, r: 4 });
      }
      return lineY(points, {
        x: along,
        y: value(name),
        // 2px: a data line is the subject, not a hairline and not a slab
        stroke: colour,
        strokeWidth: 2,
        ...(type === "step" ? { curve: STEP_CURVE } : {}),
      });
    });

    return defineChart({
      marks,
      scales: {
        // bars sit in bands; everything else reads on a continuous axis
        x: across
          ? { scale: scaleLinear, nice: true }
          : type === "bar"
            ? { scale: scaleBand }
            : { scale: scaleLinear },
        y: across ? { scale: scaleBand } : { scale: scaleLinear, nice: true },
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
