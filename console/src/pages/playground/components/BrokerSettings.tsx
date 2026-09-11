import { useEffect, useState } from "react";
import { KeyRound, Loader2, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { useSaveVariables, useVariables } from "../hooks/useVariables";
import { KeyValueEditor } from "./KeyValueEditor";
import { emptyRow, type KeyValueRow } from "../store/store";

/**
 * How this session connects, as opposed to where.
 *
 * These are stored as the connection's variables, so the credentials are
 * masked the way every other secret is - a broker token in a URL would be on
 * display everywhere the connection appears.
 */
const NAMES = {
  protocol: "mqtt_protocol",
  username: "mqtt_username",
  password: "mqtt_password",
  authMethod: "mqtt_auth_method",
  authData: "mqtt_auth_data",
  userProperties: "mqtt_user_properties",
  clientId: "mqtt_client_id",
  insecure: "mqtt_tls_insecure",
} as const;

export function BrokerSettings({
  connectionId,
  disabled,
}: {
  connectionId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useVariables(open ? connectionId : null);
  const save = useSaveVariables(connectionId);

  const [protocol, setProtocol] = useState("5");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMethod, setAuthMethod] = useState("");
  const [authData, setAuthData] = useState("");
  const [clientId, setClientId] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [rows, setRows] = useState<KeyValueRow[]>([emptyRow()]);
  const [secrets, setSecrets] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    const stored = (data.variables ?? {}) as Record<string, string>;
    setProtocol(stored[NAMES.protocol] || "5");
    setUsername(stored[NAMES.username] ?? "");
    setPassword(stored[NAMES.password] ?? "");
    setAuthMethod(stored[NAMES.authMethod] ?? "");
    setAuthData(stored[NAMES.authData] ?? "");
    setClientId(stored[NAMES.clientId] ?? "");
    setInsecure((stored[NAMES.insecure] ?? "").toLowerCase() === "true");
    setRows(readRows(stored[NAMES.userProperties]));
    setSecrets(new Set(data.secret ?? []));
    setError(null);
  }, [open, data]);

  const submit = async () => {
    const stored = { ...((data?.variables ?? {}) as Record<string, string>) };
    const set = (name: string, value: string) => {
      if (value) stored[name] = value;
      else delete stored[name];
    };

    set(NAMES.protocol, protocol);
    set(NAMES.username, username);
    set(NAMES.password, password);
    set(NAMES.authMethod, authMethod);
    set(NAMES.authData, authData);
    set(NAMES.clientId, clientId);
    set(NAMES.insecure, insecure ? "true" : "");
    set(
      NAMES.userProperties,
      rows.some((row) => row.key.trim())
        ? JSON.stringify(rows.filter((row) => row.key.trim()))
        : ""
    );

    try {
      setError(null);
      await save.mutateAsync(stored);
      setOpen(false);
    } catch (problem) {
      setError(errorMessage(problem, "Could not save the broker settings"));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={disabled}
          title="How this session connects"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Broker</span>
        </Button>
      </PopoverTrigger>

      {/* the panel is taller than a short window, so the body scrolls and the
          buttons stay reachable */}
      <PopoverContent
        align="end"
        className="flex max-h-[80vh] w-96 flex-col gap-3 p-3"
      >
        <div>
          <p className="text-xs font-medium">Broker settings</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Stored as this connection's variables, so credentials are masked.
            They take effect on the next connect.
          </p>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </p>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <Field label="Protocol">
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger className="h-8 text-xs" aria-label="Protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">MQTT 5</SelectItem>
                  <SelectItem value="3.1.1">MQTT 3.1.1</SelectItem>
                </SelectContent>
              </Select>
              <Hint>
                User properties and enhanced authentication exist only in 5. A
                broker that refuses 5 is retried on 3.1.1 automatically.
              </Hint>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Username">
                <Input value={username} onChange={setUsername} label="Username" />
              </Field>
              <Field label="Password">
                <Input
                  value={password}
                  onChange={setPassword}
                  label="Password"
                  secret={secrets.has(NAMES.password)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Auth method">
                <Input
                  value={authMethod}
                  onChange={setAuthMethod}
                  label="Auth method"
                  placeholder="appwrite-jwt"
                />
              </Field>
              <Field label="Auth data">
                <Input
                  value={authData}
                  onChange={setAuthData}
                  label="Auth data"
                  placeholder="the JWT or secret"
                  secret={secrets.has(NAMES.authData)}
                />
              </Field>
            </div>
            <Hint>
              Enhanced authentication: the method names the scheme and the data
              carries the credential, which is how a broker takes a JWT instead
              of a password.
            </Hint>

            <Field label="User properties, sent on connect">
              <KeyValueEditor
                label="Connect property"
                rows={rows}
                onChange={setRows}
                keyPlaceholder="projectId"
                valuePlaceholder="value"
              />
            </Field>

            <Field label="Client id">
              <Input
                value={clientId}
                onChange={setClientId}
                label="Client id"
                placeholder="left blank: a new one per connection"
              />
              <Hint>
                A broker evicts the existing session when a second connects with
                the same id, so leave this blank unless the broker requires one.
              </Hint>
            </Field>

            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={insecure}
                onCheckedChange={(checked) => setInsecure(checked === true)}
                aria-label="Skip TLS verification"
              />
              Skip TLS certificate verification
            </label>
            </div>

            {error && <p className="text-[11px] text-destructive">{error}</p>}

            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground/80">{children}</p>;
}

function Input({
  value,
  onChange,
  label,
  placeholder,
  secret,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      {secret && (
        <KeyRound
          className="absolute right-2 top-2 h-3.5 w-3.5 text-amber-400"
          aria-label="Stored secret, shown masked"
        />
      )}
    </div>
  );
}

/** Stored as JSON rows, which is the only shape that allows a repeated name. */
function readRows(stored?: string): KeyValueRow[] {
  if (!stored) return [emptyRow()];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.length) return [...parsed, emptyRow()];
    if (parsed && typeof parsed === "object") {
      return [
        ...Object.entries(parsed).map(([key, value]) => ({
          key,
          value: String(value ?? ""),
          enabled: true,
        })),
        emptyRow(),
      ];
    }
  } catch {
    // a hand-written value that is not JSON is left for the variables editor
  }
  return [emptyRow()];
}
