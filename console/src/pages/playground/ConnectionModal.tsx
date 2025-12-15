import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@/components/ui/shadcn-io/dropzone';
import { createConnection, uploadFile } from "@/lib/sdk";
import { useDatabaseStore } from "./store/store";
import { Loader2, CheckCircle2, AlertCircle, Database } from "lucide-react";
import type { SourceConfig } from "@/lib/sdk/types.gen";

interface ConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ConnectionModal({ open, onOpenChange, onSuccess }: ConnectionModalProps) {
  const [connectionType, setConnectionType] = useState<SourceConfig | null>(null);
  const [name, setName] = useState("");
  const [connectionUri, setConnectionUri] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>("");
  const { addConnection, setConnections } = useDatabaseStore();

  const handleReset = () => {
    setConnectionType(null);
    setName("");
    setConnectionUri("");
    setFile(null);
    setUploadStatus('idle');
    setErrorMessage("");
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      handleReset();
    }
    onOpenChange(open);
  };

  const handleFileDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      if (selectedFile.name.endsWith('.db') || selectedFile.name.endsWith('.sqlite') || selectedFile.name.endsWith('.sqlite3')) {
        setFile(selectedFile);
        setUploadStatus('idle');
        setErrorMessage("");
      } else {
        setErrorMessage('Please upload a SQLite file (.db, .sqlite, or .sqlite3)');
        setUploadStatus('error');
      }
    }
  };

  const handleCreateConnection = async () => {
    if (!connectionType) return;

    setIsCreating(true);
    setErrorMessage("");
    setUploadStatus('idle');

    try {
      let finalConnectionUri = connectionUri;

      // If SQLite, upload file first
      let bucketUid: string | undefined;
      if (connectionType === 'sqlite') {
        if (!file) {
          setErrorMessage('Please upload a SQLite file');
          setUploadStatus('error');
          setIsCreating(false);
          return;
        }

        setUploadStatus('uploading');
        const uploadResponse = await uploadFile({
          body: {
            file: file,
          },
        });

        if (!uploadResponse.data) {
          throw new Error('Failed to upload file');
        }

        // Get the bucket UID from the upload response
        bucketUid = uploadResponse.data.uid;
        
        if (!bucketUid) {
          throw new Error('Bucket UID not returned from upload response');
        }
        
        // Use the bucket UID as the connection URI
        finalConnectionUri = bucketUid;
        setUploadStatus('success');
      }

      // Ensure we have a connection URI before creating the connection
      if (!finalConnectionUri) {
        throw new Error('Connection URI is required');
      }

      // Determine the connection name - use provided name, or default to filename for SQLite, or generic name for PostgreSQL
      const connectionName = name.trim() || (connectionType === 'sqlite' ? file!.name : `New ${connectionType} Connection`);

      // Create connection using the bucket UID (for SQLite) or provided URI (for PostgreSQL)
      // For SQLite, the bucket UID from the upload response is used as the connection_uri
      const response = await createConnection({
        body: {
          name: connectionName,
          connection_uri: finalConnectionUri,
          source: connectionType,
        },
      });

      if (response.data) {
        // Add the new connection to the store
        addConnection({
          id: response.data.uid,
          name: response.data.name,
          type: response.data.source,
        });
        
        // Reload all connections to ensure the view is up to date
        const { listConnections } = await import("@/lib/sdk");
        const connectionsResponse = await listConnections();
        setConnections(
          connectionsResponse.data?.connections.map((conn) => ({
            id: conn.uid,
            name: conn.name,
            type: conn.source,
          })) || []
        );

        handleReset();
        onOpenChange(false);
        
        // Trigger success callback to reload the view in the parent component
        onSuccess?.();
      }
    } catch (error: any) {
      setUploadStatus('error');
      setErrorMessage(
        error?.response?.data?.detail?.message ||
        error?.response?.data?.detail?.[0]?.msg ||
        error?.message ||
        'Failed to create connection. Please try again.'
      );
    } finally {
      setIsCreating(false);
    }
  };

  const canCreate = connectionType && 
    (connectionType === 'sqlite' ? file !== null : connectionUri.trim() !== '');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Connection</DialogTitle>
          <DialogDescription>
            Choose a database type and configure your connection
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!connectionType ? (
            <div className="grid grid-cols-2 gap-4">
              <Card
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={() => setConnectionType('postgres')}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    PostgreSQL
                  </CardTitle>
                  <CardDescription>
                    Connect to a PostgreSQL database
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={() => setConnectionType('sqlite')}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    SQLite
                  </CardTitle>
                  <CardDescription>
                    Upload a SQLite database file
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">
                    {connectionType === 'postgres' ? 'PostgreSQL' : 'SQLite'} Connection
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {connectionType === 'postgres' 
                      ? 'Enter your PostgreSQL connection details'
                      : 'Upload your SQLite database file'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConnectionType(null)}
                  disabled={isCreating}
                >
                  Change Type
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Connection Name <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={connectionType === 'sqlite' ? file?.name || 'My SQLite Database' : 'My PostgreSQL Connection'}
                    className="w-full px-3 py-2 border rounded-md"
                    disabled={isCreating}
                  />
                  {connectionType === 'sqlite' && file && !name && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Default: {file.name}
                    </p>
                  )}
                </div>

                {connectionType === 'postgres' ? (
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Connection URI
                    </label>
                    <input
                      type="text"
                      value={connectionUri}
                      onChange={(e) => setConnectionUri(e.target.value)}
                      placeholder="postgresql://user:password@host:port/database"
                      className="w-full px-3 py-2 border rounded-md font-mono text-sm"
                      disabled={isCreating}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      SQLite Database File
                    </label>
                    <Dropzone
                      accept={{
                        'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'],
                        'application/vnd.sqlite3': ['.db', '.sqlite', '.sqlite3'],
                      }}
                      maxFiles={1}
                      maxSize={100 * 1024 * 1024}
                      onDrop={handleFileDrop}
                      src={file ? [file] : undefined}
                      disabled={isCreating || uploadStatus === 'uploading'}
                    >
                      <DropzoneEmptyState />
                      <DropzoneContent />
                    </Dropzone>

                    {file && (
                      <div className="flex items-center justify-between p-3 bg-muted rounded-md mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{file.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({(file.size / 1024 / 1024).toFixed(2)} MB)
                          </span>
                        </div>
                        {!isCreating && uploadStatus !== 'uploading' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFile(null);
                              setUploadStatus('idle');
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {uploadStatus === 'success' && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-400 rounded-md">
                  <CheckCircle2 size={16} />
                  <span className="text-sm">File uploaded successfully!</span>
                </div>
              )}

              {uploadStatus === 'error' && errorMessage && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-400 rounded-md">
                  <AlertCircle size={16} />
                  <span className="text-sm">{errorMessage}</span>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          {connectionType && (
            <Button
              onClick={handleCreateConnection}
              disabled={!canCreate || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {connectionType === 'sqlite' && uploadStatus === 'uploading' 
                    ? 'Uploading...' 
                    : 'Creating...'}
                </>
              ) : (
                'Create Connection'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

