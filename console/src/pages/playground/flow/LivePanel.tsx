import { AlertCircle, Loader2, Plug, PlugZap, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { BUFFER, type LiveFeed } from "./useLiveNodes";

export interface LiveControls {
  feed: LiveFeed;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

/**
 * A socket node's subscription, and what has arrived on it.
 *
 * The rest of a flow runs once and stops. This one keeps going for as long as
 * the tab is open, so it says plainly whether it is connected and how much of
 * the feed is still being held.
 */
export function LivePanel({ feed, onStart, onStop, onClear }: LiveControls) {
  const connected = feed.state === "open";
  const dropped = feed.received > feed.messages.length;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={connected || feed.state === "connecting" ? onStop : onStart}
        >
          {feed.state === "connecting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : connected ? (
            <PlugZap className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          {connected ? "Disconnect" : feed.state === "connecting" ? "Connecting…" : "Connect"}
        </Button>

        <span className="text-[10px] text-muted-foreground">
          {connected
            ? `${formatCount(feed.received)} received`
            : "Runs here, not on the server"}
        </span>

        {!!feed.messages.length && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear the feed"
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!!feed.failure && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {feed.failure}
        </p>
      )}

      {!!feed.messages.length && (
        <>
          {dropped && (
            <p className="text-[10px] text-muted-foreground">
              {/* saying so, because a chart drawn from this is not drawn from
                  everything that arrived */}
              Showing the last {formatCount(BUFFER)} of{" "}
              {formatCount(feed.received)}.
            </p>
          )}
          <ul
            aria-label="Feed"
            className="max-h-48 space-y-0.5 overflow-auto rounded border bg-background p-1.5"
          >
            {/* newest at the top: a feed is read from where it is now */}
            {[...feed.messages].reverse().slice(0, 50).map((message, index) => (
              <li key={index} className="flex gap-2 font-mono text-[10px]">
                <span className="shrink-0 text-muted-foreground/70">
                  {new Date(message.at).toLocaleTimeString(undefined, {
                    hour12: false,
                  })}
                </span>
                <span className={cn("min-w-0 break-all")}>{message.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
