import { useState } from "react";
import { Plus, Radio, X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CHART_TYPES, MAX_SERIES, seriesColour, type ChartType } from "./Chart";
import { fieldsFromSample, numericFields, sampleIsBroken, type Source } from "./chartData";
import type { ChartConfig, ChartSeries } from "./types";

/**
 * Setting up what a graph node draws.
 *
 * Two things this has to get right. A flow is drawn before it is run, so every
 * field can be typed or taken from a pasted example rather than waiting for
 * data to exist. And a graph can be fed by more than one node, so a series
 * says which node it came from: a table queried once and a socket still
 * arriving are two lines, not one confused one.
 */
export function GraphPanel({
  chart,
  sources,
  onChange,
}: {
  chart: ChartConfig;
  sources: Source[];
  onChange: (chart: ChartConfig) => void;
}) {
  const [showSample, setShowSample] = useState(false);
  const [picking, setPicking] = useState("");
  const [typed, setTyped] = useState("");

  const series = seriesOf(chart, sources);
  // named before anything fed the graph, so they have no source to belong to
  const waiting = sources.length ? [] : (chart.y ?? []);
  const broken = sampleIsBroken(chart.sample ?? "");
  const from = sources.find((source) => source.id === picking) ?? sources[0];

  const known = from ? numericFields(from.rows) : [];
  const offered = [
    ...known,
    ...fieldsFromSample(chart.sample ?? "").filter((field) => !known.includes(field)),
  ];
  const taken = new Set(series.map((item) => `${item.from}:${item.field}`));

  const add = (field: string) => {
    const name = field.trim();
    if (!name) return;

    // nothing is feeding it yet, so the field cannot name a source: it is
    // held as a bare name and adopted by the first node joined to this one
    if (!from) {
      const waiting = chart.y ?? [];
      if (waiting.includes(name)) return;
      onChange({ ...chart, y: [...waiting, name].slice(0, MAX_SERIES) });
      setTyped("");
      return;
    }

    if (taken.has(`${from.id}:${name}`)) return;
    onChange({
      ...chart,
      series: [...series, { from: from.id, field: name }].slice(0, MAX_SERIES),
      // the field-only list is replaced once a series names its source
      y: undefined,
    });
    setTyped("");
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

      {mismatched(chart, sources) && (
        <p className="text-[10px] text-amber-400">
          {/* the fix is two graphs, never a second axis: one chart with two
              y scales is the most misread chart there is */}
          These are on very different scales, so the smaller one reads as flat.
          Two graph nodes side by side say more than one with both in it.
        </p>
      )}

      {sources.length > 1 && !chart.x && (
        <p className="text-[10px] text-muted-foreground">
          No shared x field, so the lines are laid alongside each other at the
          newest end. Name a field both sources carry to line them up properly.
        </p>
      )}

      {crowded(chart, sources) && (
        <p className="text-[10px] text-amber-400">
          {/* a hundred bars in a node is a solid block, a picture of nothing */}
          That is a lot of bars for this space. A line or an area reads better,
          or narrow the query.
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Draw</p>

        {!!waiting.length && (
          <ul className="flex flex-wrap gap-1" aria-label="Series">
            {waiting.map((field, index) => (
              <li
                key={field}
                className="flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[11px]"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: seriesColour(index) }}
                />
                <span className="font-mono">{field}</span>
                <span className="text-[9px] text-muted-foreground">waiting</span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...chart,
                      y: waiting.filter((entry) => entry !== field),
                    })
                  }
                  aria-label={`Stop drawing ${field}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!!series.length && (
          <ul className="flex flex-wrap gap-1" aria-label="Series">
            {series.map((item, index) => {
              const source = sources.find((entry) => entry.id === item.from);
              return (
                <li
                  key={`${item.from}:${item.field}`}
                  className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: seriesColour(index) }}
                  />
                  <span className="font-mono">
                    {sources.length > 1 && source && (
                      <span className="text-muted-foreground">{source.name}.</span>
                    )}
                    {item.field}
                  </span>
                  {/* which lines are still moving is worth seeing at a glance */}
                  {source?.live && <Radio className="h-2.5 w-2.5 text-sky-400" />}
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...chart,
                        series: series.filter(
                          (entry) =>
                            !(entry.from === item.from && entry.field === item.field)
                        ),
                        y: undefined,
                      })
                    }
                    aria-label={`Stop drawing ${item.field}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-1.5">
          {/* the node first, then the field out of it: picking a bare key is
              what made this guesswork when more than one thing fed the graph */}
          {sources.length > 1 && (
            <Select value={from?.id ?? ""} onValueChange={setPicking}>
              <SelectTrigger className="h-7 w-28 text-[11px]" aria-label="From node">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              add(typed);
            }}
          >
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              list="graph-fields"
              aria-label="Field to draw"
              placeholder="a field to draw"
              className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              aria-label="Draw this field"
              disabled={!typed.trim()}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>

        <datalist id="graph-fields">
          {offered.map((field) => (
            <option key={field} value={field} />
          ))}
        </datalist>

        {!!offered.length && (
          <div className="flex flex-wrap gap-1">
            {offered
              .filter((field) => !taken.has(`${from?.id}:${field}`))
              .slice(0, 12)
              .map((field) => (
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

        {!offered.length && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {from
              ? `Nothing has arrived from ${from.name} yet.`
              : "Nothing is feeding this yet."}{" "}
            Type the field you expect, or paste an example below. Joining a node
            to it later adopts whatever is named here.
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

/**
 * The series a chart holds, whichever way it was set up.
 *
 * Flows drawn before a graph knew about its sources stored bare field names.
 * They are read as belonging to the first node feeding it, which is what they
 * meant back when only one could.
 */
export function seriesOf(chart: ChartConfig, sources: Source[]): ChartSeries[] {
  if (chart.series?.length) return chart.series;
  const first = sources[0];
  if (!first) return [];
  return (chart.y ?? []).map((field) => ({ from: first.id, field }));
}

/**
 * Are two series so far apart in magnitude that one of them is a flat line?
 *
 * The answer is never a second y axis. A chart with two scales is the most
 * misread chart there is, so this points at two charts instead.
 */
function mismatched(chart: ChartConfig, sources: Source[]): boolean {
  const series = seriesOf(chart, sources);
  if (series.length < 2) return false;

  const peaks = series.map((item) => {
    const source = sources.find((entry) => entry.id === item.from);
    const values = (source?.rows ?? [])
      .map((row) => Number(row?.[item.field]))
      .filter((value) => Number.isFinite(value) && value !== 0)
      .map(Math.abs);
    return values.length ? Math.max(...values) : 0;
  }).filter(Boolean);

  if (peaks.length < 2) return false;
  return Math.max(...peaks) / Math.min(...peaks) > 20;
}

function crowded(chart: ChartConfig, sources: Source[]): boolean {
  const bars = (chart.type ?? "line") === "bar" || chart.type === "bars-across";
  return bars && Math.max(0, ...sources.map((source) => source.rows.length)) > 40;
}
