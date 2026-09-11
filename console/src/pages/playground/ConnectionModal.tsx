import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileUp,
  Globe,
  Radio,
  Loader2,
  PlugZap,
  Waypoints,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/ui/shadcn-io/dropzone";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import {
  getConnection,
  provisionAppwriteJwt,
  setVariables,
  testConnection,
  uploadFile,
  type ConnectionProbeModel,
  type SourceConfig,
} from "@/lib/sdk";
import { useCreateConnection, useUpdateConnection } from "./hooks";

const SQLITE_SUFFIXES = [".db", ".sqlite", ".sqlite3", ".db3"];

/**
 * Where the Appwrite preset points by default - Cloud, unless a deploy sets
 * VITE_APPWRITE_ENDPOINT (e.g. a region host, or a self-hosted URL). It seeds
 * the endpoint when minting a JWT from an API key.
 */
const DEFAULT_APPWRITE_ENDPOINT =
  (import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined) ??
  "https://cloud.appwrite.io/v1";

/**
 * What you are connecting to, which is not quite the same as the backend's
 * source: an HTTP API and an MQTT broker are both `api` connections, told
 * apart by their URL. Offering them as one choice hid MQTT entirely.
 */
const SOURCES = [
  {
    value: "postgres",
    source: "postgres",
    label: "PostgreSQL",
    icon: Database,
    placeholder: "postgresql://user:password@host:5432/database",
  },
  {
    value: "mysql",
    source: "mysql",
    label: "MySQL",
    icon: Database,
    placeholder: "mysql://user:password@host:3306/database",
  },
  {
    value: "sqlite",
    source: "sqlite",
    label: "SQLite file",
    icon: FileUp,
    placeholder: "",
  },
  {
    value: "redis",
    source: "redis",
    label: "Redis",
    icon: Database,
    placeholder: "redis://host:6379/0   or rediss://…:6380",
    uriLabel: "Server address",
    hint: "The path is the database number, so /0 is the first one. A password goes in as redis://:password@host:6379.",
  },
  {
    value: "api",
    source: "api",
    label: "HTTP / WebSocket",
    icon: Globe,
    placeholder: "https://api.example.com   or wss://stream.example.com",
    uriLabel: "Base URL",
  },
  {
    value: "mqtt",
    source: "api",
    label: "MQTT broker",
    icon: Radio,
    placeholder: "mqtt://broker.example.com:1883   or mqtts://…:8883",
    uriLabel: "Broker address",
    hint: "Username and password go in the connection's variables as mqtt_username and mqtt_password, where they are stored masked.",
  },
  {
    value: "appwrite",
    source: "api",
    label: "Appwrite MQTT",
    icon: Waypoints,
    placeholder: "mqtt://appwrite-mqtt:1883   or mqtts://…:8883",
    uriLabel: "Broker address",
    hint: "Appwrite's push broker authenticates over MQTT 5: a session secret or JWT, plus your project ID. They are stored masked as the connection's variables.",
  },
] as const satisfies readonly SourceOption[];

interface SourceOption {
  value: string;
  source: SourceConfig;
  label: string;
  icon: typeof Database;
  placeholder: string;
  uriLabel?: string;
  hint?: string;
}

type Kind = (typeof SOURCES)[number]["value"];

const optionFor = (kind: Kind | null): SourceOption | undefined =>
  SOURCES.find((option) => option.value === kind);

/** Point out a URL that does not match the kind that was chosen. */
function uriMismatch(kind: Kind | null, connectionUri: string): string | null {
  const uri = connectionUri.trim();
  if (!uri) return null;
  if (kind === "redis" && !/^rediss?:\/\//i.test(uri)) {
    return "A Redis address starts with redis:// or rediss:// for TLS.";
  }
  if ((kind === "mqtt" || kind === "appwrite") && !/^mqtts?:\/\//i.test(uri)) {
    return "A broker address starts with mqtt:// or mqtts://. For an HTTP or websocket service, choose HTTP / WebSocket instead.";
  }
  if (kind === "api" && /^mqtts?:\/\//i.test(uri)) {
    return "That is a broker address - choose MQTT broker instead.";
  }
  return null;
}

/** An existing connection is matched back to the choice that would create it. */
function kindOf(source: string, connectionUri: string): Kind {
  if (source === "api" && /^mqtts?:\/\//i.test(connectionUri)) return "mqtt";
  return source as Kind;
}

const ENVIRONMENTS = [
  { value: "local", label: "Local" },
  { value: "staging", label: "Staging" },
  { value: "production", label: "Production" },
] as const;

const ROLES = [
  { value: "primary", label: "Primary" },
  { value: "replica", label: "Replica" },
] as const;

type Environment = (typeof ENVIRONMENTS)[number]["value"];
type Role = (typeof ROLES)[number]["value"];

interface ConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (connectionId?: string) => void;
  connectionId?: string | null;
}

export function ConnectionModal({
  open,
  onOpenChange,
  onSuccess,
  connectionId,
}: ConnectionModalProps) {
  const isEditMode = !!connectionId;
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();

  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState("");
  const [connectionUri, setConnectionUri] = useState("");
  const [environment, setEnvironment] = useState<Environment>("local");
  const [role, setRole] = useState<Role>("primary");
  const [readOnly, setReadOnly] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  // Appwrite MQTT preset: the credential and project that become the
  // connection's enhanced-auth variables.
  const [appwriteAuth, setAppwriteAuth] = useState<"session" | "jwt">("session");
  const [appwriteCredential, setAppwriteCredential] = useState("");
  const [appwriteProjectId, setAppwriteProjectId] = useState("");
  // Two ways to get that credential: paste one, or have the server mint a
  // throwaway user's JWT from an API key.
  const [appwriteMode, setAppwriteMode] = useState<"paste" | "provision">("paste");
  const [appwriteEndpoint, setAppwriteEndpoint] = useState(DEFAULT_APPWRITE_ENDPOINT);
  const [appwriteApiKey, setAppwriteApiKey] = useState("");
  const [provisionedUser, setProvisionedUser] = useState<string | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [probe, setProbe] = useState<ConnectionProbeModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const option = optionFor(kind);
  const source = option?.source ?? null;

  // an mqtt:// URL under HTTP / WebSocket, or the reverse, is saved happily
  // and then fails at the first click; saying so here is cheaper
  const uriWarning = uriMismatch(kind, connectionUri);

  const reset = () => {
    setKind(null);
    setName("");
    setConnectionUri("");
    setEnvironment("local");
    setRole("primary");
    setReadOnly(true);
    setFile(null);
    setAppwriteAuth("session");
    setAppwriteCredential("");
    setAppwriteProjectId("");
    setAppwriteMode("paste");
    setAppwriteEndpoint(DEFAULT_APPWRITE_ENDPOINT);
    setAppwriteApiKey("");
    setProvisionedUser(null);
    setError(null);
    setProbe(null);
  };

  /**
   * Mint a JWT server-side from an API key. The key is sent for this call only
   * - it is never stored - and the JWT it returns becomes the credential, the
   * same as if it had been pasted.
   */
  const handleProvision = async () => {
    if (!appwriteEndpoint.trim() || !appwriteProjectId.trim() || !appwriteApiKey.trim()) {
      setError("Endpoint, Project ID and API key are all needed to mint a JWT.");
      return;
    }
    setError(null);
    setIsProvisioning(true);
    try {
      const response = await provisionAppwriteJwt({
        body: {
          endpoint: appwriteEndpoint.trim(),
          project: appwriteProjectId.trim(),
          api_key: appwriteApiKey,
        },
        throwOnError: true,
      });
      const minted = response.data;
      if (!minted?.jwt) throw new Error("Appwrite did not return a JWT");
      setAppwriteCredential(minted.jwt);
      setAppwriteAuth("jwt");
      setProvisionedUser(minted.user_id);
    } catch (provisionError) {
      setProvisionedUser(null);
      setAppwriteCredential("");
      setError(errorMessage(provisionError, "Could not mint a JWT from Appwrite"));
    } finally {
      setIsProvisioning(false);
    }
  };

  /**
   * The Appwrite preset is a friendly face over MQTT 5 enhanced authentication:
   * the credential is the AuthenticationData, the scheme is the method, and the
   * project rides along as a user property - the same shape the Appwrite SDK's
   * MQTT client sends on connect.
   */
  const appwriteVariables = (): Record<string, string> => {
    const variables: Record<string, string> = {
      mqtt_protocol: "5",
      mqtt_auth_method: appwriteAuth === "jwt" ? "appwrite-jwt" : "appwrite-session",
    };
    if (appwriteCredential) variables.mqtt_auth_data = appwriteCredential;
    if (appwriteProjectId.trim()) {
      variables.mqtt_user_properties = JSON.stringify([
        { key: "projectId", value: appwriteProjectId.trim(), enabled: true },
      ]);
    }
    return variables;
  };

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (!isEditMode) return;

    let cancelled = false;
    setIsLoading(true);
    getConnection({ path: { connection_uid: connectionId! }, throwOnError: true })
      .then((response) => {
        if (cancelled || !response.data) return;
        setKind(kindOf(response.data.source, response.data.connection_uri ?? ""));
        setName(response.data.name);
        setConnectionUri(response.data.connection_uri);
        setEnvironment((response.data.environment ?? "local") as Environment);
        setRole((response.data.role ?? "primary") as Role);
        setReadOnly(response.data.read_only ?? true);
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError, "Could not load the connection"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, isEditMode, connectionId]);

  useEffect(() => {
    setProbe(null);
  }, [
    kind,
    connectionUri,
    file,
    appwriteAuth,
    appwriteCredential,
    appwriteProjectId,
    appwriteMode,
  ]);

  const handleTest = async () => {
    if (!source) return;
    setError(null);
    setIsTesting(true);
    try {
      let uri = connectionUri;
      if (source === "sqlite" && file) {
        const upload = await uploadFile({ body: { file }, throwOnError: true });
        uri = upload.data?.connection_uri ?? "";
        // keep the upload, so creating afterwards does not send the file twice
        setConnectionUri(uri);
        setFile(null);
      }

      const response = await testConnection({
        body: {
          source,
          connection_uri: uri,
          // exercise the broker's real auth so an Appwrite session is tested
          // the way it will be used, not rejected as an anonymous client
          ...(kind === "appwrite" ? { variables: appwriteVariables() } : {}),
        },
        throwOnError: true,
      });
      setProbe(response.data ?? null);
    } catch (testError) {
      setProbe({
        reachable: false,
        detail: errorMessage(testError, "Could not reach the database"),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDrop = (accepted: File[]) => {
    const candidate = accepted[0];
    if (!candidate) return;
    const isSqlite = SQLITE_SUFFIXES.some((suffix) =>
      candidate.name.toLowerCase().endsWith(suffix)
    );
    if (!isSqlite) {
      setError(`Upload a SQLite file (${SQLITE_SUFFIXES.join(", ")})`);
      return;
    }
    setError(null);
    setFile(candidate);
    if (!name.trim()) setName(candidate.name.replace(/\.[^.]+$/, ""));
  };

  const handleSave = async () => {
    if (!source) return;
    setError(null);
    setIsSaving(true);

    try {
      let uri = connectionUri;

      if (source === "sqlite" && file) {
        const upload = await uploadFile({ body: { file }, throwOnError: true });
        if (!upload.data?.connection_uri) {
          throw new Error("The upload did not return a connection URI");
        }
        uri = upload.data.connection_uri;
      }

      if (!uri) {
        throw new Error(
          source === "sqlite"
            ? "Upload a SQLite file first"
            : "A connection URI is required"
        );
      }

      const label =
        name.trim() || file?.name || `New ${option?.label ?? source} connection`;

      if (isEditMode) {
        await updateConnection.mutateAsync({
          connectionId: connectionId!,
          data: {
            name: label,
            connection_uri: uri,
            source,
            environment,
            role,
            read_only: readOnly,
          },
        });
        onSuccess?.(connectionId!);
      } else {
        const created = await createConnection.mutateAsync({
          name: label,
          connection_uri: uri,
          source,
          environment,
          role,
          read_only: readOnly,
        });
        // the credential could not be saved until the connection existed to
        // hang it on; do it now, before handing the connection back
        if (kind === "appwrite" && created?.uid) {
          await setVariables({
            path: { connection_id: created.uid },
            body: { variables: appwriteVariables() },
            throwOnError: true,
          });
        }
        onSuccess?.(created?.uid);
      }

      onOpenChange(false);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save the connection"));
    } finally {
      setIsSaving(false);
    }
  };

  const canTest =
    !!source &&
    (source === "sqlite" ? !!file || !!connectionUri : !!connectionUri.trim());

  const canSave =
    !!source &&
    !isSaving &&
    (source !== "sqlite" || !!file || !!connectionUri) &&
    (source === "sqlite" || !!connectionUri.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit connection" : "New connection"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update how DataPilot reaches this connection."
              : "Point DataPilot at a database or an API. Database connections are read-only until you say otherwise."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">What are you connecting to?</Label>
              <div className="grid grid-cols-2 gap-2">
                {SOURCES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setKind(option.value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors",
                      kind === option.value
                        ? "border-primary bg-primary/10"
                        : "hover:bg-muted/60"
                    )}
                  >
                    <option.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{option.label}</span>
                    {kind === option.value && (
                      <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {kind && option && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="connection-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="connection-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Production replica"
                    className="h-8 text-xs"
                  />
                </div>

                {source === "sqlite" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">SQLite file</Label>
                    <Dropzone
                      accept={{ "application/octet-stream": SQLITE_SUFFIXES }}
                      maxFiles={1}
                      maxSize={500 * 1024 * 1024}
                      onDrop={handleDrop}
                      src={file ? [file] : undefined}
                      disabled={isSaving}
                    >
                      <DropzoneEmptyState />
                      <DropzoneContent />
                    </Dropzone>
                    {isEditMode && connectionUri && !file && (
                      <p className="text-[11px] text-muted-foreground">
                        Currently using <span className="font-mono">{connectionUri}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="connection-uri" className="text-xs">
                      {option.uriLabel ?? "Connection URI"}
                    </Label>
                    <Input
                      id="connection-uri"
                      value={connectionUri}
                      onChange={(event) => setConnectionUri(event.target.value)}
                      placeholder={option.placeholder}
                      className="h-8 font-mono text-xs"
                    />
                    {option.hint && (
                      <p className="text-[11px] text-muted-foreground">{option.hint}</p>
                    )}
                    {uriWarning && (
                      <p className="text-[11px] text-amber-500">{uriWarning}</p>
                    )}
                  </div>
                )}

                {kind === "appwrite" && (
                  <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-2.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="appwrite-project" className="text-xs">
                        Project ID
                      </Label>
                      <Input
                        id="appwrite-project"
                        value={appwriteProjectId}
                        onChange={(event) => setAppwriteProjectId(event.target.value)}
                        placeholder="my-project"
                        className="h-8 font-mono text-xs"
                      />
                    </div>

                    {/* two ways to the same credential: bring your own, or let
                        the server mint one from an API key */}
                    <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/60 p-0.5">
                      {(
                        [
                          ["paste", "Paste credential"],
                          ["provision", "Mint from API key"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAppwriteMode(value)}
                          className={cn(
                            "rounded px-2 py-1 text-xs transition-colors",
                            appwriteMode === value
                              ? "bg-background font-medium shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {appwriteMode === "paste" ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Select
                            value={appwriteAuth}
                            onValueChange={(value) =>
                              setAppwriteAuth(value as "session" | "jwt")
                            }
                          >
                            <SelectTrigger className="h-8 w-36 shrink-0 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="session">Session secret</SelectItem>
                              <SelectItem value="jwt">JWT</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            id="appwrite-credential"
                            type="password"
                            value={appwriteCredential}
                            onChange={(event) =>
                              setAppwriteCredential(event.target.value)
                            }
                            placeholder={
                              appwriteAuth === "jwt"
                                ? "a current Appwrite JWT"
                                : "a current session secret"
                            }
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Stored masked. Mint a session or JWT for a user in this
                          project; the broker verifies it on connect.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="appwrite-endpoint" className="text-xs">
                            Appwrite endpoint
                          </Label>
                          <Input
                            id="appwrite-endpoint"
                            value={appwriteEndpoint}
                            onChange={(event) =>
                              setAppwriteEndpoint(event.target.value)
                            }
                            placeholder="http://appwrite-traefik/v1"
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="appwrite-key" className="text-xs">
                            API key
                          </Label>
                          <Input
                            id="appwrite-key"
                            type="password"
                            value={appwriteApiKey}
                            onChange={(event) => setAppwriteApiKey(event.target.value)}
                            placeholder="standard_… (users scope)"
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full gap-1.5"
                          onClick={handleProvision}
                          disabled={isProvisioning}
                        >
                          {isProvisioning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PlugZap className="h-3.5 w-3.5" />
                          )}
                          {isProvisioning
                            ? "Minting…"
                            : "Create test user + JWT"}
                        </Button>
                        {provisionedUser && appwriteCredential ? (
                          <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            JWT ready for user{" "}
                            <span className="font-mono">{provisionedUser}</span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            Creates a throwaway user and mints its JWT. The key is
                            used for this call only and never stored.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Environment</Label>
                    <Select
                      value={environment}
                      onValueChange={(value) => setEnvironment(value as Environment)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ENVIRONMENTS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Role</Label>
                    <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {source !== "api" && (
                <label className="flex items-start gap-2 rounded-md border p-2.5">
                  <Checkbox
                    checked={readOnly}
                    onCheckedChange={(checked) => setReadOnly(checked === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <span className="font-medium">Read-only</span>
                    <span className="block text-muted-foreground">
                      Writes are rejected unless a query tab explicitly allows them.
                    </span>
                  </span>
                </label>
                )}
              </>
            )}
          </div>
        )}

        {probe && (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-md border p-2.5 text-xs",
              probe.reachable
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            {probe.reachable ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {probe.reachable ? "Connected" : "Could not connect"}
                {probe.latency_ms !== null && probe.latency_ms !== undefined
                  ? ` · ${probe.latency_ms} ms`
                  : ""}
              </p>
              {(probe.server_version || probe.detail) && (
                <p className="mt-0.5 break-words opacity-90">
                  {probe.server_version ?? probe.detail}
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!canTest || isTesting || isSaving}
            className="gap-1.5"
          >
            {isTesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="h-3.5 w-3.5" />
            )}
            {isTesting ? "Testing…" : "Test connection"}
          </Button>

          <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : isEditMode ? (
              "Save changes"
            ) : (
              "Create connection"
            )}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
