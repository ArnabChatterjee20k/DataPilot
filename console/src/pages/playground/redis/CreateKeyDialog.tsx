import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import type { RedisKeyCreateModel, RedisKeyValueModel } from "@/lib/sdk";
import { KeyValueEditor } from "../components/KeyValueEditor";
import { emptyRow, type KeyValueRow } from "../store/store";

type KeyType = RedisKeyCreateModel["type"];

const TYPES: { value: KeyType; label: string; hint: string }[] = [
  { value: "string", label: "String", hint: "one value, often JSON" },
  { value: "hash", label: "Hash", hint: "named fields, like a small record" },
  { value: "list", label: "List", hint: "an ordered queue, duplicates allowed" },
  { value: "set", label: "Set", hint: "unique members, no order" },
  { value: "zset", label: "Sorted set", hint: "unique members, each with a score" },
  { value: "stream", label: "Stream", hint: "an append-only log of entries" },
];

/**
 * Writing a new key of any type.
 *
 * Each type is filled in the shape it actually has, so a hash is typed as
 * fields rather than as a JSON blob the server then has to guess at.
 */
export function CreateKeyDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (body: RedisKeyCreateModel) => Promise<RedisKeyValueModel>;
}) {
  const [key, setKey] = useState("");
  const [type, setType] = useState<KeyType>("string");
  const [value, setValue] = useState("");
  const [lines, setLines] = useState("");
  const [rows, setRows] = useState<KeyValueRow[]>([emptyRow()]);
  const [ttl, setTtl] = useState("");
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const filled = rows.filter((row) => row.enabled && row.key.trim());
  const members = lines
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const body = (): RedisKeyCreateModel => {
    const base = {
      key: key.trim(),
      type,
      ttl: ttl.trim() ? Number(ttl) : null,
      replace,
    };
    if (type === "string") return { ...base, value };
    if (type === "list" || type === "set") return { ...base, members };
    if (type === "hash") {
      return { ...base, entries: filled.map((row) => ({ field: row.key, value: row.value })) };
    }
    if (type === "zset") {
      return {
        ...base,
        entries: filled.map((row) => ({ member: row.key, score: Number(row.value) })),
      };
    }
    return {
      ...base,
      entries: [
        { fields: Object.fromEntries(filled.map((row) => [row.key, row.value])) },
      ],
    };
  };

  const reset = () => {
    setKey("");
    setValue("");
    setLines("");
    setRows([emptyRow()]);
    setTtl("");
    setReplace(false);
    setProblem(null);
  };

  const submit = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await onCreate(body());
      reset();
      onOpenChange(false);
    } catch (error) {
      // the server's wording already says which part was wrong
      setProblem(errorMessage(error, "Could not create the key"));
    } finally {
      setSaving(false);
    }
  };

  const hint = TYPES.find((option) => option.value === type)?.hint;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-4">
        <DialogHeader className="shrink-0">
          <DialogTitle>New key</DialogTitle>
          <DialogDescription>
            Written in one transaction, so it is all there or none of it is.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-1 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="flex gap-2">
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-label="Key name"
              placeholder="user:42"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <Select value={type} onValueChange={(next) => setType(next as KeyType)}>
              <SelectTrigger className="h-9 w-32 text-xs" aria-label="Key type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">{hint}</p>

          {type === "string" && (
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label="Key value"
              spellCheck={false}
              placeholder='{"hello": "world"}'
              className="h-32 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          )}

          {(type === "list" || type === "set") && (
            <>
              <textarea
                value={lines}
                onChange={(event) => setLines(event.target.value)}
                aria-label="Members"
                spellCheck={false}
                placeholder={"first\nsecond\nthird"}
                className="h-32 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                One member per line
                {type === "set" && ", and repeats collapse into one"}.
              </p>
            </>
          )}

          {(type === "hash" || type === "zset" || type === "stream") && (
            <KeyValueEditor
              rows={rows}
              onChange={setRows}
              label={type === "zset" ? "Members and scores" : "Fields"}
              keyPlaceholder={type === "zset" ? "member" : "field"}
              valuePlaceholder={type === "zset" ? "score" : "value"}
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Expires in
              <input
                value={ttl}
                onChange={(event) => setTtl(event.target.value.replace(/[^0-9]/g, ""))}
                aria-label="Expires in seconds"
                inputMode="numeric"
                placeholder="never"
                className="h-7 w-20 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              seconds
            </label>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={replace}
                onCheckedChange={(checked) => setReplace(checked === true)}
              />
              Replace it if it already exists
            </label>
          </div>

          {problem && (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {problem}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !key.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
