import { useState } from "react";
import { Plus, X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CHART_TYPES, MAX_SERIES, seriesColour, type ChartType } from "./Chart";
import { sampleIsBroken, suggestedFields } from "./chartData";
import type { ChartConfig } from "./types";

/**
 * Setting up what a graph node draws.
 *
 * A flow is drawn before it is run, so every field here can be typed by hand.
 * Waiting for data before the chart can be configured would mean building the
 * flow twice: once to make data, once to say what to do with it.
 *
 * Keys that have actually arrived are offered as suggestions, and so are the
 * keys in a pasted example, which is how a feed that has not started yet still
 * gets a chart ready for it.
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
  const [adding, setAdding] = useState("");
  const [showSample, setShowSample] = useState(false);

  const series = chart.y ?? [];
  const suggestions = suggestedFields(rows, chart.sample ?? "").filter(
    (field) => !series.includes(field)
  );
  const broken = sampleIsBroken(chart.sample ?? "");
  const bars = (chart.type ?? "line") === "bar" || chart.type === "bars-across";
  const crowded = bars && rows.length > 40;

  const add = (name: string) => {
    const key = name.trim();
    if (!key || series.includes(key)) return;
    onChange({ ...chart, y: [...series, key].slice(0, MAX_SERIES) });
    setAdding("");
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center gap-1.5">
        <Select
          value={chart.type ?? "line"}
          onValueChange={(type) => onChange({ ...chart, type: type as ChartType })}
        >
          <SelectTrigger className="h-7 w-24 text-[11px]" aria-label="Chart type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_TYPES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-muted-foreground">x</span>
          <input
            value={chart.x ?? ""}
            onChange={(event) => onChange({ ...chart, x: event.target.value })}
            list="graph-fields"
            aria-label="Bottom axis"
            placeholder="in the order they arrive"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>

      <p className="text-[10px] text-muted-foreground">
        {CHART_TYPES.find((option) => option.value === (chart.type ?? "line"))?.hint}
      </p>

      {crowded && (
        <p className="text-[10px] text-amber-400">
          {/* a hundred bars in a node is a solid block, which is a picture of
              nothing; saying so beats letting someone stare at it */}
          {rows.length} rows is a lot of bars for this space. A line or an area
          reads better, or narrow the query.
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Draw</p>

        {!!series.length && (
          <ul className="flex flex-wrap gap-1" aria-label="Series">
            {series.map((name, index) => (
              <li
                key={name}
                className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: seriesColour(index) }}
                />
                <span className="font-mono">{name}</span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...chart, y: series.filter((item) => item !== name) })
                  }
                  aria-label={`Stop drawing ${name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            add(adding);
          }}
        >
          <input
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            list="graph-fields"
            aria-label="Field to draw"
            placeholder="a field to draw"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="submit"
            aria-label="Draw this field"
            disabled={!adding.trim()}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>

        {/* both inputs share one list, so anything known can be typed or picked */}
        <datalist id="graph-fields">
          {suggestions.map((field) => (
            <option key={field} value={field} />
          ))}
        </datalist>

        {!!suggestions.length && (
          <div className="flex flex-wrap gap-1">
            {suggestions.slice(0, 12).map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => add(field)}
                className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                {field}
              </button>
            ))}
          </div>
        )}

        {!suggestions.length && !series.length && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Type the field you expect, or paste an example below and pick from
            it. Nothing has to have run yet.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setShowSample((current) => !current)}
          aria-expanded={showSample}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {showSample ? "Hide the example" : "Paste an example of the data"}
        </button>

        {showSample && (
          <>
            <textarea
              value={chart.sample ?? ""}
              onChange={(event) => onChange({ ...chart, sample: event.target.value })}
              aria-label="Example data"
              spellCheck={false}
              placeholder={'{"t": 1, "value": 10}'}
              className={cn(
                "h-20 w-full resize-y rounded-md border bg-background p-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring",
                broken && "border-amber-500/50"
              )}
            />
            <p className="text-[10px] text-muted-foreground">
              {broken
                ? "That is not JSON yet, so no keys could be read out of it."
                : "One object or a list of them. Its keys join the suggestions."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
