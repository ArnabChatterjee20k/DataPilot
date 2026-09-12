import { BarChart3 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCount } from "@/lib/format";
import { EmptyState } from "../components/primitives";
import { FlowChart, MAX_SERIES, seriesColour, type ChartType } from "./Chart";
import { numericFields, toPoints } from "./chartData";
import type { ChartConfig } from "./types";

/**
 * Setting up what a graph node draws, next to the thing it draws.
 *
 * The fields come from the data that actually arrived rather than from a
 * schema, so a live feed and a finished query are configured the same way and
 * neither needs to be described twice.
 */
export function GraphPanel({
  chart,
  rows,
  onChange,
}: {
  chart: ChartConfig;
  rows: Record<string, unknown>[];
  onChange: (chart: ChartConfig) => void;
}) {
  const fields = numericFields(rows);
  const series = (chart.y ?? []).filter((name) => fields.includes(name));
  const points = toPoints(rows, chart.x ?? "", series, chart.window ?? 100);

  const toggle = (name: string) => {
    const next = series.includes(name)
      ? series.filter((item) => item !== name)
      : [...series, name].slice(0, MAX_SERIES);
    onChange({ ...chart, y: next });
  };

  if (!rows.length) {
    return (
      <div className="space-y-2 border-t pt-3">
        <EmptyState
          icon={BarChart3}
          title="Nothing to draw yet"
          description="Join this to a query or a websocket, then run or connect it."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-1.5">
        <Select
          value={chart.type ?? "line"}
          onValueChange={(type) => onChange({ ...chart, type: type as ChartType })}
        >
          <SelectTrigger className="h-7 w-24 text-[11px]" aria-label="Chart type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="line">Line</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
            <SelectItem value="area">Area</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={chart.x || "__order__"}
          onValueChange={(x) => onChange({ ...chart, x: x === "__order__" ? "" : x })}
        >
          <SelectTrigger className="h-7 min-w-0 flex-1 text-[11px]" aria-label="Bottom axis">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__order__">in the order they arrived</SelectItem>
            {fields.map((field) => (
              <SelectItem key={field} value={field}>
                {field}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Draw</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Series">
          {fields.map((field) => {
            const index = series.indexOf(field);
            return (
              <label
                key={field}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <Checkbox
                  checked={index >= 0}
                  onCheckedChange={() => toggle(field)}
                  aria-label={field}
                />
                {index >= 0 && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-sm"
                    style={{ background: seriesColour(index) }}
                  />
                )}
                {field}
              </label>
            );
          })}
        </div>
      </div>

      {series.length ? (
        <div className="rounded border bg-background p-2">
          <FlowChart
            points={points}
            series={series}
            type={chart.type ?? "line"}
            label={`${series.join(", ")} by ${chart.x || "arrival"}`}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {/* what is drawn is a window onto the data, not all of it */}
            {formatCount(points.length)} of {formatCount(rows.length)} points
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Pick a field to draw. Only fields holding numbers are offered.
        </p>
      )}
    </div>
  );
}
