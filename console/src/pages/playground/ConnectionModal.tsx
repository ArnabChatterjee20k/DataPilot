import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Database, FileUp, Loader2 } from "lucide-react";

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
import { getConnection, uploadFile, type SourceConfig } from "@/lib/sdk";
import { useCreateConnection, useUpdateConnection } from "./hooks";

const SQLITE_SUFFIXES = [".db", ".sqlite", ".sqlite3", ".db3"];

const SOURCES = [
  { value: "postgres", label: "PostgreSQL", icon: Database },
  { value: "mysql", label: "MySQL", icon: Database },
  { value: "sqlite", label: "SQLite file", icon: FileUp },
] as const satisfies readonly {
  value: SourceConfig;
  label: string;
  icon: typeof Database;
}[];

const URI_PLACEHOLDER: Partial<Record<SourceConfig, string>> = {
  postgres: "postgresql://user:password@host:5432/database",
  mysql: "mysql://user:password@host:3306/database",
};

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

  const [source, setSource] = useState<SourceConfig | null>(null);
  const [name, setName] = useState("");
  const [connectionUri, setConnectionUri] = useState("");
  const [environment, setEnvironment] = useState<Environment>("local");
  const [role, setRole] = useState<Role>("primary");
  const [readOnly, setReadOnly] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSource(null);
    setName("");
    setConnectionUri("");
    setEnvironment("local");
    setRole("primary");
    setReadOnly(true);
    setFile(null);
    setError(null);
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
        setSource(response.data.source);
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
        name.trim() || file?.name || `New ${source} connection`;

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
        onSuccess?.(created?.uid);
      }

      onOpenChange(false);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save the connection"));
    } finally {
      setIsSaving(false);
    }
  };

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
              ? "Update how DataPilot reaches this database."
              : "Point DataPilot at a database. Connections are read-only until you say otherwise."}
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
              <Label className="text-xs">Database</Label>
              <div className="grid grid-cols-3 gap-2">
                {SOURCES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSource(option.value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors",
                      source === option.value
                        ? "border-primary bg-primary/10"
                        : "hover:bg-muted/60"
                    )}
                  >
                    <option.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{option.label}</span>
                    {source === option.value && (
                      <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {source && (
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
                      Connection URI
                    </Label>
                    <Input
                      id="connection-uri"
                      value={connectionUri}
                      onChange={(event) => setConnectionUri(event.target.value)}
                      placeholder={URI_PLACEHOLDER[source] ?? ""}
                      className="h-8 font-mono text-xs"
                    />
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
              </>
            )}
          </div>
        )}

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
