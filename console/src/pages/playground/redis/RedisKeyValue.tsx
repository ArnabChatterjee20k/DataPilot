import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Database,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { RedisKeyEditModel, RedisKeyValueModel } from "@/lib/sdk";
import { CopyButton, EmptyState } from "../components/primitives";
import { JsonView, parseJson } from "./JsonValue";

/** `-1` means no expiry, which is a different thing from expired. */
function ttlLabel(ttl?: number | null): string {
  if (ttl == null || ttl < 0) return "no expiry";
  if (ttl < 60) return `${ttl}s left`;
  if (ttl < 3600) return `${Math.round(ttl / 60)}m left`;
  if (ttl < 86400) return `${Math.round(ttl / 3600)}h left`;
  return `${Math.round(ttl / 86400)}d left`;
}

/**
 * One key, shown as whatever it is.
 *
 * A hash rendered as a string is unreadable, and a sorted set without its
 * scores is not a sorted set, so each type gets its own table.
 */
/** What the value panel may change, and how. Absent when nothing is selected. */
export interface KeyWrites {
  canWrite: boolean;
  readOnlyHint: string;
  edit: (body: RedisKeyEditModel) => Promise<unknown>;
  expire: (ttl: number | null) => Promise<unknown>;
  rename: (to: string) => Promise<unknown>;
  pending: boolean;
  error: unknown;
  reset: () => void;
}

export function RedisKeyValue({
  value,
  isLoading,
  error,
  writes,
}: {
  value?: RedisKeyValueModel;
  isLoading: boolean;
  error: unknown;
  writes?: KeyWrites;
}) {
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Reading the key…
      </p>
    );
  }
  if (error) {
    return (
      <p className="p-4 text-xs text-destructive">
        {errorMessage(error, "Could not read that key")}
      </p>
    );
  }
  if (!value) {
    return (
      <EmptyState
        icon={Database}
        title="No key chosen"
        description="Pick a key on the left to see what it holds, or create one with the + button."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <EditableText
          text={value.key}
          label="Key name"
          writes={writes}
          mono
          onSave={(to) => writes?.rename(to)}
        >
          <span className="font-mono font-medium" data-testid="redis-key-name">
            {value.key}
          </span>
        </EditableText>
        <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {value.label}
        </span>
        <span className="text-muted-foreground">
          {value.type === "string"
            ? `${formatCount(value.size ?? 0)} bytes`
            : `${formatCount(value.size ?? 0)} ${
                value.type === "hash" ? "fields" : "entries"
              }`}
        </span>
        <TtlEditor ttl={value.ttl} writes={writes} />
        {value.encoding && (
          <span className="text-muted-foreground/70">{value.encoding}</span>
        )}
        {writes?.pending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {!!writes?.error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-[11px] text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            {errorMessage(writes.error, "That change was not saved")}
          </span>
          <button
            type="button"
            onClick={writes.reset}
            aria-label="Dismiss"
            className="text-destructive/70 hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {value.truncated && (
        <p
          role="status"
          className="border-b bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-400"
        >
          Showing the first {(value.entries?.length ?? 0) || (value.members?.length ?? 0)} of{" "}
          {formatCount(value.size ?? 0)}. A key this size is not worth loading
          whole into a browser tab.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <Body value={value} writes={writes} />
      </div>
    </div>
  );
}

/**
 * Text that turns into an input when there is permission to change it.
 *
 * A read-only connection still shows the pencil, disabled, with the reason on
 * hover: a missing button would read as "this cannot be edited", which is not
 * true, only not allowed here.
 */
function EditableText({
  text,
  label,
  writes,
  onSave,
  mono,
  multiline,
  children,
}: {
  text: string;
  label: string;
  writes?: KeyWrites;
  onSave: (next: string) => Promise<unknown> | void;
  mono?: boolean;
  multiline?: boolean;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (!writes) return <>{children}</>;

  const save = async () => {
    if (draft === null) return;
    if (draft !== text) {
      try {
        await onSave(draft);
      } catch {
        // the panel shows the error; keep what was typed so it is not lost
        return;
      }
    }
    setDraft(null);
  };

  if (draft !== null) {
    const shared = {
      value: draft,
      autoFocus: true,
      "aria-label": label,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => setDraft(event.target.value),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === "Escape") setDraft(null);
        if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void save();
        }
      },
      className: cn(
        "min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring",
        mono && "font-mono"
      ),
    };
    return (
      <span className="flex min-w-0 flex-1 items-start gap-1">
        {multiline ? (
          <textarea {...shared} rows={Math.min(12, Math.max(3, draft.split("\n").length))} />
        ) : (
          <input {...shared} />
        )}
        <IconButton label={`Save ${label.toLowerCase()}`} onClick={save}>
          <Check className="h-3 w-3" />
        </IconButton>
        <IconButton label="Cancel" onClick={() => setDraft(null)}>
          <X className="h-3 w-3" />
        </IconButton>
      </span>
    );
  }

  return (
    <span className="group/edit inline-flex min-w-0 items-start gap-1">
      {children}
      <IconButton
        label={`Edit ${label.toLowerCase()}`}
        onClick={() => setDraft(text)}
        disabled={!writes.canWrite}
        title={writes.canWrite ? undefined : writes.readOnlyHint}
        subtle
      >
        <Pencil className="h-3 w-3" />
      </IconButton>
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  title,
  subtle,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
        subtle && "opacity-40 group-hover/edit:opacity-100 focus:opacity-100"
      )}
    >
      {children}
    </button>
  );
}

/** How long a key has left, and the way to change it. */
function TtlEditor({ ttl, writes }: { ttl?: number | null; writes?: KeyWrites }) {
  const [draft, setDraft] = useState<string | null>(null);
  const expiring = ttl != null && ttl >= 0;

  const label = (
    <span className={cn("text-muted-foreground", expiring && "text-amber-400")}>
      {ttlLabel(ttl)}
    </span>
  );

  if (!writes) return label;

  if (draft !== null) {
    const save = async () => {
      const seconds = Number(draft);
      if (!draft.trim() || !Number.isFinite(seconds)) return;
      try {
        await writes.expire(seconds);
        setDraft(null);
      } catch {
        /* the panel shows why */
      }
    };
    return (
      <span className="flex items-center gap-1">
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") setDraft(null);
          }}
          aria-label="Expires in seconds"
          inputMode="numeric"
          placeholder="seconds"
          className="h-6 w-20 rounded border bg-background px-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <IconButton label="Save expiry" onClick={save}>
          <Check className="h-3 w-3" />
        </IconButton>
        {expiring && (
          <button
            type="button"
            onClick={async () => {
              try {
                await writes.expire(null);
                setDraft(null);
              } catch {
                /* the panel shows why */
              }
            }}
            className="rounded px-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Never expire
          </button>
        )}
        <IconButton label="Cancel" onClick={() => setDraft(null)}>
          <X className="h-3 w-3" />
        </IconButton>
      </span>
    );
  }

  return (
    <span className="group/edit inline-flex items-center gap-1">
      {label}
      <IconButton
        label="Change expiry"
        onClick={() => setDraft(expiring ? String(ttl) : "")}
        disabled={!writes.canWrite}
        title={writes.canWrite ? undefined : writes.readOnlyHint}
        subtle
      >
        <Pencil className="h-3 w-3" />
      </IconButton>
    </span>
  );
}

/**
 * A one-line form for adding to a collection.
 *
 * Each type adds a different shape - a field and value, a member and score -
 * so the inputs come from the caller, and this owns only submit and reset.
 */
function AddRow({
  writes,
  inputs,
  onAdd,
  label,
}: {
  writes?: KeyWrites;
  inputs: { name: string; placeholder: string; width?: string }[];
  onAdd: (values: Record<string, string>) => Promise<unknown> | void;
  label: string;
}) {
  const blank = () => Object.fromEntries(inputs.map((input) => [input.name, ""]));
  const [values, setValues] = useState<Record<string, string>>(blank);

  if (!writes) return null;
  const disabled = !writes.canWrite;

  return (
    <form
      className="flex items-center gap-1.5 border-t px-4 py-2"
      aria-label={label}
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !Object.values(values).some((item) => item.trim())) return;
        try {
          await onAdd(values);
          setValues(blank());
        } catch {
          /* the panel shows why, and the typed values stay */
        }
      }}
    >
      {inputs.map((input) => (
        <input
          key={input.name}
          value={values[input.name] ?? ""}
          onChange={(event) =>
            setValues((current) => ({ ...current, [input.name]: event.target.value }))
          }
          aria-label={input.placeholder}
          placeholder={input.placeholder}
          disabled={disabled}
          className={cn(
            "h-7 min-w-0 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50",
            input.width ?? "flex-1"
          )}
        />
      ))}
      <button
        type="submit"
        disabled={disabled}
        title={disabled ? writes.readOnlyHint : label}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
        {label}
      </button>
    </form>
  );
}

function RemoveButton({
  writes,
  label,
  onRemove,
}: {
  writes?: KeyWrites;
  label: string;
  onRemove: () => Promise<unknown>;
}) {
  if (!writes) return null;
  return (
    <td className="w-8 px-1 py-1 align-top">
      <IconButton
        label={label}
        onClick={() => void onRemove().catch(() => undefined)}
        disabled={!writes.canWrite}
        title={writes.canWrite ? label : writes.readOnlyHint}
      >
        <Trash2 className="h-3 w-3" />
      </IconButton>
    </td>
  );
}

function Body({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  if (value.type === "string") return <StringValue value={value} writes={writes} />;

  if (value.type === "hash") return <HashValue value={value} writes={writes} />;
  if (value.type === "zset") return <SortedSetValue value={value} writes={writes} />;
  if (value.type === "stream") return <StreamValue value={value} writes={writes} />;
  return <MembersValue value={value} writes={writes} />;
}

/**
 * A string, rendered as whatever it turns out to be.
 *
 * Most of what applications put in Redis is serialised JSON, and a session
 * blob printed as one escaped line is the difference between reading a value
 * and squinting at it.
 */
function StringValue({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  const parsed = useMemo(() => parseJson(value.value), [value.value]);
  const [raw, setRaw] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const draftIsBrokenJson =
    draft !== null && parsed !== undefined && parseJson(draft) === undefined;

  const save = async () => {
    if (draft === null || !writes) return;
    try {
      await writes.edit({ key: value.key, action: "set", value: draft });
      setDraft(null);
    } catch {
      /* the panel shows why, and the edit stays open */
    }
  };

  if (draft !== null) {
    return (
      <div className="space-y-2 p-4">
        <textarea
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDraft(null);
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
          }}
          aria-label="Edit value"
          spellCheck={false}
          className="h-64 w-full resize-y rounded border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-2">
          {/* was JSON and no longer parses: probably a typo, possibly intended */}
          {draftIsBrokenJson && (
            <p className="text-[11px] text-amber-400">
              This was JSON and no longer parses. It will be saved as plain text.
            </p>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            Ctrl+Enter to save, Esc to cancel. The expiry is kept.
          </span>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={writes?.pending}
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            Save value
          </button>
        </div>
      </div>
    );
  }

  const startEditing = () =>
    // pretty-printed to edit, because nobody edits a one-line JSON blob well
    setDraft(parsed !== undefined ? JSON.stringify(parsed, null, 2) : (value.value ?? ""));

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-center gap-2">
        {parsed !== undefined && (
          <div className="flex items-center rounded-md border p-0.5">
            {([["json", "JSON"], ["raw", "Raw"]] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRaw(mode === "raw")}
                aria-pressed={raw === (mode === "raw")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] transition-colors",
                  raw === (mode === "raw")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {!value.is_text && (
          <p className="text-[11px] text-muted-foreground">
            Not text, so it is shown base64 encoded.
          </p>
        )}
        <span className="ml-auto flex items-center gap-1">
          {writes && value.is_text && (
            <button
              type="button"
              onClick={startEditing}
              disabled={!writes.canWrite}
              title={writes.canWrite ? "Edit this value" : writes.readOnlyHint}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
          <CopyButton value={value.value ?? ""} label="Copy value" />
        </span>
      </div>

      {parsed !== undefined && !raw ? (
        <div className="overflow-auto rounded border bg-background p-2">
          <JsonView value={parsed} label="Key value" />
        </div>
      ) : (
        <pre
          aria-label="Key value"
          className="whitespace-pre-wrap break-words rounded border bg-background p-2 font-mono text-xs"
        >
          {value.value}
        </pre>
      )}
    </div>
  );
}

function HashValue({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  const entries = value.entries ?? [];
  const { rows, filter } = useFilter(entries, (entry) =>
    `${entry.field} ${entry.value}`
  );

  return (
    <>
      {filter}
      <Table
        headers={writes ? ["Field", "Value", ""] : ["Field", "Value"]}
        label="Hash fields"
      >
        {rows.map((entry) => (
          <tr key={String(entry.field)} className="border-b align-top hover:bg-muted/40">
            <Cell mono>{String(entry.field)}</Cell>
            <Cell>
              <EditableText
                text={String(entry.value)}
                label={`Value of ${entry.field}`}
                writes={writes}
                mono
                onSave={(next) =>
                  writes?.edit({
                    key: value.key,
                    action: "set",
                    field: String(entry.field),
                    value: next,
                  })
                }
              >
                <MaybeJson text={String(entry.value)} />
              </EditableText>
            </Cell>
            <RemoveButton
              writes={writes}
              label={`Remove field ${entry.field}`}
              onRemove={() =>
                writes!.edit({ key: value.key, action: "remove", field: String(entry.field) })
              }
            />
          </tr>
        ))}
      </Table>
      <AddRow
        writes={writes}
        label="Add field"
        inputs={[
          { name: "field", placeholder: "field", width: "w-40" },
          { name: "value", placeholder: "value" },
        ]}
        onAdd={(input) =>
          writes?.edit({
            key: value.key,
            action: "set",
            field: input.field,
            value: input.value,
          })
        }
      />
    </>
  );
}

function SortedSetValue({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  const entries = value.entries ?? [];
  const { rows, filter } = useFilter(entries, (entry) => String(entry.member));

  // the scores mean more against each other than alone
  const top = Math.max(...entries.map((entry) => Number(entry.score) || 0), 0);

  return (
    <>
      {filter}
      <Table
        headers={writes ? ["Member", "Score", ""] : ["Member", "Score"]}
        label="Sorted set members"
      >
        {rows.map((entry) => (
          <tr key={String(entry.member)} className="border-b hover:bg-muted/40">
            <Cell mono>{String(entry.member)}</Cell>
            <td className="w-56 px-4 py-1.5">
              <div className="flex items-center gap-2">
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{
                      width: top > 0 ? `${(Number(entry.score) / top) * 100}%` : "0%",
                    }}
                  />
                </div>
                <EditableText
                  text={String(entry.score)}
                  label={`Score of ${entry.member}`}
                  writes={writes}
                  mono
                  onSave={(next) =>
                    writes?.edit({
                      key: value.key,
                      action: "set",
                      member: String(entry.member),
                      score: Number(next),
                    })
                  }
                >
                  <span className="shrink-0 font-mono tabular-nums">
                    {String(entry.score)}
                  </span>
                </EditableText>
              </div>
            </td>
            <RemoveButton
              writes={writes}
              label={`Remove ${entry.member}`}
              onRemove={() =>
                writes!.edit({
                  key: value.key,
                  action: "remove",
                  member: String(entry.member),
                })
              }
            />
          </tr>
        ))}
      </Table>
      <AddRow
        writes={writes}
        label="Add member"
        inputs={[
          { name: "member", placeholder: "member" },
          { name: "score", placeholder: "score", width: "w-24" },
        ]}
        onAdd={(input) =>
          writes?.edit({
            key: value.key,
            action: "set",
            member: input.member,
            score: Number(input.score),
          })
        }
      />
    </>
  );
}

function StreamValue({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  const entries = value.entries ?? [];
  const { rows, filter } = useFilter(entries, (entry) =>
    `${entry.id} ${JSON.stringify(entry.fields ?? {})}`
  );

  return (
    <>
      {filter}
      <Table
        headers={writes ? ["Entry", "Fields", ""] : ["Entry", "Fields"]}
        label="Stream entries"
      >
        {rows.map((entry) => (
          <tr key={String(entry.id)} className="border-b align-top hover:bg-muted/40">
            <Cell mono>
              <span title={streamTime(String(entry.id))}>{String(entry.id)}</span>
            </Cell>
            <Cell>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries((entry.fields ?? {}) as Record<string, string>).map(
                  ([name, item]) => (
                    <p key={name} className="font-mono text-[11px]">
                      <span className="text-sky-400">{name}</span>{" "}
                      <span className="text-muted-foreground/60">=</span> {item}
                    </p>
                  )
                )}
              </div>
            </Cell>
            <RemoveButton
              writes={writes}
              label={`Remove entry ${entry.id}`}
              onRemove={() =>
                writes!.edit({ key: value.key, action: "remove", id: String(entry.id) })
              }
            />
          </tr>
        ))}
      </Table>
      <AddRow
        writes={writes}
        label="Add entry"
        inputs={[{ name: "fields", placeholder: "kind=signup user=7" }]}
        onAdd={(input) =>
          writes?.edit({
            key: value.key,
            action: "add",
            fields: parseFields(input.fields),
          })
        }
      />
    </>
  );
}

/** `kind=signup user=7`, the way stream entries are usually written out. */
function parseFields(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\s+/)
      .map((pair) => pair.split("="))
      .filter(([name]) => name)
      .map(([name, ...rest]) => [name, rest.join("=")])
  );
}

function MembersValue({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  const isList = value.type === "list";
  // the index is numbered before filtering, because a list position means
  // nothing once a search has removed the members in front of it
  const members = (value.members ?? []).map((member, index) => ({ member, index }));
  const { rows, filter } = useFilter(members, (item) => String(item.member));

  const headers = isList ? ["#", "Value"] : ["Member"];

  return (
    <>
      {filter}
      <Table
        headers={writes ? [...headers, ""] : headers}
        label={isList ? "List members" : "Set members"}
      >
        {rows.map((item) => (
          <tr key={`${item.index}-${item.member}`} className="border-b align-top hover:bg-muted/40">
            {isList && (
              <Cell mono align="right">
                {item.index}
              </Cell>
            )}
            <Cell>
              {isList ? (
                <EditableText
                  text={String(item.member)}
                  label={`Item ${item.index}`}
                  writes={writes}
                  mono
                  onSave={(next) =>
                    writes?.edit({
                      key: value.key,
                      action: "set",
                      index: item.index,
                      value: next,
                    })
                  }
                >
                  <MaybeJson text={String(item.member)} />
                </EditableText>
              ) : (
                <MaybeJson text={String(item.member)} />
              )}
            </Cell>
            <RemoveButton
              writes={writes}
              label={isList ? `Remove item ${item.index}` : `Remove ${item.member}`}
              onRemove={() =>
                writes!.edit(
                  isList
                    ? { key: value.key, action: "remove", index: item.index }
                    : { key: value.key, action: "remove", member: String(item.member) }
                )
              }
            />
          </tr>
        ))}
      </Table>
      {isList ? (
        <ListPush value={value} writes={writes} />
      ) : (
        <AddRow
          writes={writes}
          label="Add member"
          inputs={[{ name: "member", placeholder: "member" }]}
          onAdd={(input) =>
            writes?.edit({ key: value.key, action: "add", member: input.member })
          }
        />
      )}
    </>
  );
}

/** A list grows at either end, and which end is usually the whole point. */
function ListPush({ value, writes }: { value: RedisKeyValueModel; writes?: KeyWrites }) {
  const [draft, setDraft] = useState("");
  if (!writes) return null;

  const push = async (end: "head" | "tail") => {
    if (!draft.trim()) return;
    try {
      await writes.edit({ key: value.key, action: "push", value: draft, end });
      setDraft("");
    } catch {
      /* the panel shows why */
    }
  };

  return (
    <div className="flex items-center gap-1.5 border-t px-4 py-2">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void push("tail");
        }}
        aria-label="New item"
        placeholder="new item"
        disabled={!writes.canWrite}
        className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      {(["head", "tail"] as const).map((end) => (
        <button
          key={end}
          type="button"
          onClick={() => void push(end)}
          disabled={!writes.canWrite}
          title={writes.canWrite ? undefined : writes.readOnlyHint}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
          {end === "head" ? "Push to front" : "Push to end"}
        </button>
      ))}
    </div>
  );
}

/** A cell that folds out when its text is JSON, and stays plain when it is not. */
function MaybeJson({ text }: { text: string }) {
  const parsed = useMemo(() => parseJson(text), [text]);
  if (parsed === undefined) return <span className="font-mono">{text}</span>;
  return <JsonView value={parsed} />;
}

/**
 * A filter over a collection's own entries.
 *
 * A hash with two hundred fields is a search problem, not a reading problem,
 * and scrolling it is the wrong tool.
 */
function useFilter<T>(items: T[], text: (item: T) => string) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? items.filter((item) => text(item).toLowerCase().includes(needle))
    : items;

  const filter =
    items.length > 10 ? (
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-card px-4 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter entries"
          placeholder={`Filter ${items.length} entries`}
          className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        {needle && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {rows.length} of {items.length}
          </span>
        )}
      </div>
    ) : null;

  return { rows, filter };
}

/** A stream id begins with the millisecond it was added. */
function streamTime(id: string): string {
  const millis = Number(id.split("-")[0]);
  return Number.isFinite(millis) ? new Date(millis).toLocaleString() : id;
}

function Table({
  headers,
  label,
  children,
}: {
  headers: string[];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-xs" aria-label={label}>
      <thead className="sticky top-0 bg-card">
        <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          {headers.map((header) => (
            <th
              key={header}
              className={cn("px-4 py-2 font-medium", header === "#" && "w-12")}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  mono,
  align,
}: {
  children: React.ReactNode;
  mono?: boolean;
  align?: "right";
}) {
  return (
    <td
      className={cn(
        "px-4 py-1.5 align-top",
        mono && "font-mono",
        align === "right" && "text-right tabular-nums"
      )}
    >
      <span className="break-words">{children}</span>
    </td>
  );
}
