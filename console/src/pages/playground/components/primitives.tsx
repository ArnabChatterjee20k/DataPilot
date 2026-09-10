import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";
import { KIND_CLASS, KIND_LABEL } from "@/lib/format";
import type { Column } from "../store/store";

export function ColumnTypeBadge({ column }: { column: Column }) {
  return (
    <span
      className={cn(
        "font-normal text-[10px] uppercase tracking-wide leading-none",
        KIND_CLASS[column.kind]
      )}
      title={column.type ?? undefined}
    >
      {KIND_LABEL[column.kind]}
      {column.primary_key && <span className="ml-1 text-amber-400">pk</span>}
      {!column.primary_key && column.indexed && (
        <span className="ml-1 text-muted-foreground/70">idx</span>
      )}
      {!column.nullable && <span className="ml-1 text-rose-400">*</span>}
    </span>
  );
}

export function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // clipboard is unavailable outside a secure context; fall back to a
        // hidden textarea so copy still works over plain http
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), timeout);
    },
    [timeout]
  );

  return { copied, copy };
}

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void copy(value);
      }}
      title={copied ? "Copied" : label}
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground",
        "transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function GridSkeleton({
  columns = 6,
  rows = 12,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="h-full overflow-hidden" aria-busy="true" aria-label="Loading rows">
      <div className="flex border-b bg-muted/30 px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => (
          <div key={index} className="flex-1 pr-6">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex border-b border-border/40 px-4 py-2.5">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <div key={columnIndex} className="flex-1 pr-6">
              <div
                className="h-3 animate-pulse rounded bg-muted/60"
                style={{
                  width: `${45 + ((rowIndex * 7 + columnIndex * 13) % 45)}%`,
                  animationDelay: `${(rowIndex * columns + columnIndex) * 12}ms`,
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const ENVIRONMENT_STYLE: Record<string, string> = {
  production: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  staging: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  local: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function EnvironmentBadge({
  environment,
  role,
  readOnly,
  className,
}: {
  environment: string;
  role?: string;
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          ENVIRONMENT_STYLE[environment] ?? ENVIRONMENT_STYLE.local
        )}
      >
        {environment}
      </span>
      {role === "replica" && (
        <span className="rounded border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
          replica
        </span>
      )}
      {readOnly && (
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          read-only
        </span>
      )}
    </span>
  );
}
