import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { ConnectionStatusModel } from "@/lib/sdk";

/**
 * A dot saying whether a connection actually answers.
 *
 * Finding out that a database is unreachable by running a query against it is
 * one round trip too late; the sidebar dials every connection as it lists
 * them, so the answer is already on screen.
 */
export function ConnectionHealth({
  status,
  isChecking,
  onRetest,
}: {
  status: ConnectionStatusModel | null;
  isChecking: boolean;
  onRetest: () => void;
}) {
  const state = !status ? "checking" : status.reachable ? "up" : "down";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRetest();
      }}
      aria-label={healthLabel(status)}
      title={healthLabel(status)}
      className="shrink-0 rounded p-1 hover:bg-background"
    >
      <span
        className={cn(
          "block h-1.5 w-1.5 rounded-full",
          state === "up" && "bg-emerald-500",
          state === "down" && "bg-rose-500",
          (state === "checking" || isChecking) && "animate-pulse bg-muted-foreground/60"
        )}
      />
    </button>
  );
}

/**
 * The failure itself, once the connection is opened.
 *
 * The first line is the whole point; the detail can run to several sentences
 * of hint, which would otherwise push the tree off the screen, so it is folded
 * away until asked for.
 */
export function ConnectionFailure({
  status,
  isChecking,
  onRetest,
}: {
  status: ConnectionStatusModel | null;
  isChecking: boolean;
  onRetest: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!status || status.reachable) return null;
  const detail = status.detail || "No answer.";

  return (
    <div className="mb-1 ml-6 mr-1 rounded border border-destructive/30 bg-destructive/10 p-1.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 truncate font-medium text-destructive">
          Cannot reach this connection
        </span>
        <button
          type="button"
          onClick={onRetest}
          disabled={isChecking}
          aria-label="Try this connection again"
          className="shrink-0 rounded p-0.5 text-destructive hover:bg-destructive/20 disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3 w-3", isChecking && "animate-spin")} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label="Why it could not be reached"
        className="mt-1 flex w-full items-start gap-1 text-left text-destructive/80 hover:text-destructive"
      >
        {isOpen ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
        )}
        <span className={cn("min-w-0 break-words", !isOpen && "truncate")}>{detail}</span>
      </button>
    </div>
  );
}

function healthLabel(status: ConnectionStatusModel | null): string {
  if (!status) return "Checking the connection";
  if (!status.reachable) return `Unreachable: ${status.detail || "no answer"}`;
  return [
    "Reachable",
    status.latency_ms != null ? formatDuration(status.latency_ms) : null,
    shortVersion(status.server_version),
  ]
    .filter(Boolean)
    .join(" - ");
}

/** Server banners run to a paragraph; the product and number are the useful part. */
function shortVersion(version?: string | null): string | null {
  if (!version) return null;
  const trimmed = version.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}
