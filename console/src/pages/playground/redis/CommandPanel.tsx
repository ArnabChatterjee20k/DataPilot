import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, SendHorizontal, TerminalSquare, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatDuration } from "@/lib/format";
import type { RedisCommandResultModel } from "@/lib/sdk";
import { EmptyState } from "../components/primitives";
import { JsonView, parseJson } from "./JsonValue";
import { useRunCommand } from "./useRedis";

interface Entry {
  id: number;
  command: string;
  result?: RedisCommandResultModel;
  error?: string;
}

const EXAMPLES = [
  "HGETALL user:7",
  "TTL session:abc",
  "SCAN 0 MATCH user:* COUNT 100",
  "INFO memory",
];

/**
 * Typing a command the way redis-cli takes it.
 *
 * The key browser covers what keys hold; this covers everything else a
 * person reaches for a terminal to do. The server decides what may run, so a
 * read-only connection refuses writes here exactly as it does everywhere else.
 */
export function CommandPanel({
  connectionId,
  allowWrites,
}: {
  connectionId?: string;
  allowWrites: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recall, setRecall] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const run = useRunCommand(connectionId, allowWrites);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [entries.length]);

  const history = entries.map((entry) => entry.command);

  const send = async (command: string, confirm = false) => {
    const text = command.trim();
    if (!text) return;
    setConfirming(null);
    setRecall(null);
    setDraft("");

    try {
      const result = await run.mutateAsync({ command: text, confirm });
      setEntries((current) => [...current, { id: nextId.current++, command: text, result }]);
    } catch (error) {
      const message = errorMessage(error, "The command did not run");
      // a database wipe comes back asking to be confirmed rather than failing,
      // and the server's own sentence is what decides that
      if (!confirm && message.includes("Confirm it")) {
        setConfirming(text);
        setDraft(text);
        return;
      }
      setEntries((current) => [
        ...current,
        { id: nextId.current++, command: text, error: message },
      ]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={logRef} className="min-h-0 flex-1 overflow-auto" aria-label="Command output">
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={TerminalSquare}
              title="Run a command"
              description="Anything redis-cli takes. A read-only connection runs reads only, unless this tab allows writes."
            />
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setDraft(example)}
                  className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="divide-y font-mono text-xs">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-1 px-4 py-2">
                <p className="flex items-center gap-2">
                  <span className="text-muted-foreground">&gt;</span>
                  <span className="min-w-0 flex-1 break-all">{entry.command}</span>
                  {entry.result && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {entry.result.kind} · {formatDuration(entry.result.elapsed_ms ?? 0)}
                    </span>
                  )}
                </p>
                {entry.error ? (
                  <p className="flex items-start gap-1.5 break-words text-destructive">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    {entry.error}
                  </p>
                ) : (
                  entry.result && (
                    <>
                      {entry.result.warning && (
                        <p className="text-[11px] text-amber-400">{entry.result.warning}</p>
                      )}
                      <Reply value={entry.result.reply} />
                    </>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 text-destructive">
            <span className="font-mono">{confirming}</span> deletes keys and cannot
            be undone.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setConfirming(null)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={() => void send(confirming, true)}
          >
            Run it
          </Button>
        </div>
      )}

      <form
        className="flex items-center gap-1.5 border-t px-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <span className="font-mono text-xs text-muted-foreground">&gt;</span>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setRecall(null);
          }}
          onKeyDown={(event) => {
            // up and down walk back through what was run, as a terminal does
            if (event.key === "ArrowUp" && history.length) {
              event.preventDefault();
              const index = recall === null ? history.length - 1 : Math.max(recall - 1, 0);
              setRecall(index);
              setDraft(history[index]);
            }
            if (event.key === "ArrowDown" && recall !== null) {
              event.preventDefault();
              const index = recall + 1;
              if (index >= history.length) {
                setRecall(null);
                setDraft("");
              } else {
                setRecall(index);
                setDraft(history[index]);
              }
            }
          }}
          aria-label="Redis command"
          placeholder="GET greeting"
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
        />
        <Button
          size="sm"
          type="submit"
          className="h-8 gap-1.5 px-3 text-xs"
          disabled={run.isPending || !draft.trim()}
        >
          {run.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SendHorizontal className="h-3.5 w-3.5" />
          )}
          Run
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          className="h-8 px-2 text-xs"
          onClick={() => setEntries([])}
          disabled={!entries.length}
          aria-label="Clear output"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}

/**
 * A reply laid out the way redis-cli prints one.
 *
 * `(nil)` is not an empty string and `(integer) 0` is not "0"; the difference
 * is usually the answer to the question that was asked.
 */
function Reply({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <p className="text-muted-foreground">(nil)</p>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <p className="text-amber-400">
        <span className="text-muted-foreground">(integer)</span> {String(value)}
      </p>
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return <p className="text-muted-foreground">(empty array)</p>;
    return (
      <ol className={cn("space-y-0.5", depth > 0 && "pl-4")}>
        {value.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">{index + 1})</span>
            <div className="min-w-0 flex-1">
              <Reply value={item} depth={depth + 1} />
            </div>
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === "object") {
    return (
      <ul className="space-y-0.5">
        {Object.entries(value as Record<string, unknown>).map(([name, item]) => (
          <li key={name} className="flex gap-2">
            <span className="shrink-0 text-sky-400">{name}</span>
            <span className="text-muted-foreground">=&gt;</span>
            <div className="min-w-0 flex-1">
              <Reply value={item} depth={depth + 1} />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const text = String(value);
  const parsed = parseJson(text);
  if (parsed !== undefined) {
    return (
      <div className="rounded border bg-background p-1.5">
        <JsonView value={parsed} />
      </div>
    );
  }
  // INFO and friends answer with many lines, which quotes would mangle
  if (text.includes("\n")) {
    return <pre className="whitespace-pre-wrap break-words text-foreground">{text}</pre>;
  }
  return <p className="break-all text-emerald-400">&quot;{text}&quot;</p>;
}
