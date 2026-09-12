import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts for the canvas.
 *
 * The table is the only definition: the handler dispatches from it and the
 * help panel renders from it, so a shortcut cannot quietly stop matching the
 * line that documents it.
 */

export type ShortcutAction =
  | "addQuery"
  | "addRequest"
  | "addConstants"
  | "duplicate"
  | "remove"
  | "selectAll"
  | "save"
  | "run"
  | "deselect"
  | "help";

interface Shortcut {
  action: ShortcutAction;
  keys: string[];
  label: string;
  /** Held down with Ctrl on Windows and Linux, Cmd on a Mac. */
  mod?: boolean;
  /** Safe to fire while a field has focus, because it cannot be typed. */
  whileTyping?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { action: "addQuery", keys: ["q"], label: "Add a query node" },
  { action: "addRequest", keys: ["r"], label: "Add a request node" },
  { action: "addConstants", keys: ["c"], label: "Add a constants node" },
  { action: "duplicate", keys: ["d"], mod: true, label: "Duplicate the selection" },
  { action: "remove", keys: ["Delete", "Backspace"], label: "Delete the selection" },
  { action: "selectAll", keys: ["a"], mod: true, label: "Select every node" },
  { action: "save", keys: ["s"], mod: true, label: "Save", whileTyping: true },
  { action: "run", keys: ["Enter"], mod: true, label: "Save and run", whileTyping: true },
  { action: "deselect", keys: ["Escape"], label: "Clear the selection", whileTyping: true },
  // the character, not Shift plus the key that makes it, because which key
  // that is depends on the layout
  { action: "help", keys: ["?"], label: "Show this list" },
];

/** How a shortcut is written out, using the symbols the platform uses. */
export function shortcutLabel(shortcut: Shortcut, isMac: boolean): string {
  const key = shortcut.keys[0];
  const name =
    key === " "
      ? "Space"
      : key.length === 1
        ? key.toUpperCase()
        : key === "Backspace"
          ? "Del"
          : key;

  const parts: string[] = [];
  if (shortcut.mod) parts.push(isMac ? "⌘" : "Ctrl");
  parts.push(name);
  return parts.join(isMac ? "" : " + ");
}

export const isMacPlatform = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * A field has focus, so a bare letter belongs to it.
 *
 * Typing `q` into a SQL editor must not drop a node on the canvas, which is
 * the way a shortcut layer usually ruins a builder.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export interface ShortcutHandlers
  extends Partial<Record<ShortcutAction, () => void>> {
  nudge?: (dx: number, dy: number) => void;
}

export function useFlowShortcuts(handlers: ShortcutHandlers, enabled = true) {
  // the canvas rebuilds these on every render, and rebinding the listener each
  // time would mean adding and removing it on every keystroke
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const typing = isTyping(event.target);
      const mod = event.ctrlKey || event.metaKey;

      for (const shortcut of SHORTCUTS) {
        if (!shortcut.keys.some((key) => key.toLowerCase() === event.key.toLowerCase()))
          continue;
        if (!!shortcut.mod !== mod) continue;
        if (typing && !shortcut.whileTyping) continue;

        const handler = latest.current[shortcut.action];
        if (!handler) continue;

        event.preventDefault();
        handler();
        return;
      }

      // arrows nudge the selection, which is the only way to line nodes up
      // without a steady hand on the mouse
      if (!typing && event.key.startsWith("Arrow") && latest.current.nudge) {
        const step = event.shiftKey ? 1 : 10;
        const delta = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key];
        if (delta) {
          event.preventDefault();
          latest.current.nudge(delta[0], delta[1]);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
