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
import { createConnection, updateConnection, uploadFile, getConnection } from "@/lib/sdk";
import { useDatabaseStore } from "./store/store";
import { Loader2, CheckCircle2, AlertCircle, Database } from "lucide-react";
import type { SourceConfig } from "@/lib/sdk/types.gen";
import { useEffect } from "react";

interface ConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  connectionId?: string | null; // If provided, modal is in edit mode
}

export function ConnectionModal({ open, onOpenChange, onSuccess, connectionId }: ConnectionModalProps) {
  const [connectionType, setConnectionType] = useState<SourceConfig | null>(null);
  const [name, setName] = useState("");
  const [connectionUri, setConnectionUri] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>("");
  const { addConnection, setConnections, updateConnection: updateConnectionInStore } = useDatabaseStore();
  const isEditMode = !!connectionId;

  const handleReset = () => {
    setConnectionType(null);
    setName("");
    setConnectionUri("");
    setFile(null);
    setUploadStatus('idle');
    setErrorMessage("");
    setIsEditing(false);
  };

  // Load connection data when editing
  useEffect(() => {
    if (open && isEditMode && connectionId) {
      const loadConnectionData = async () => {
        try {
          setIsEditing(true);
          const response = await getConnection({
            path: { connection_uid: connectionId },
          });
          
          if (response.data) {
            setConnectionType(response.data.source);
            setName(response.data.name);
            setConnectionUri(response.data.connection_uri);
          }
        } catch (error) {
          console.error("Error loading connection:", error);
          setErrorMessage("Failed to load connection data");
        } finally {
          setIsEditing(false);
        }
      };
      
      loadConnectionData();
    } else if (!open) {
      handleReset();
    }
  }, [open, isEditMode, connectionId]);

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

  const handleSaveConnection = async () => {
    if (!connectionType) return;

    setIsCreating(true);
    setErrorMessage("");
    setUploadStatus('idle');

    try {
      let finalConnectionUri = connectionUri;

      // If SQLite and a new file is uploaded, upload file first
      let bucketUid: string | undefined;
      if (connectionType === 'sqlite' && file && !isEditMode) {
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
      } else if (connectionType === 'sqlite' && !file && !isEditMode) {
        setErrorMessage('Please upload a SQLite file');
        setUploadStatus('error');
        setIsCreating(false);
        return;
      }

      // Ensure we have a connection URI
      if (!finalConnectionUri && !isEditMode) {
        throw new Error('Connection URI is required');
      }

      // Determine the connection name
      const connectionName = name.trim() || (connectionType === 'sqlite' && file ? file.name : `New ${connectionType} Connection`);

      if (isEditMode && connectionId) {
        // Update existing connection
        const updateData: { name?: string; connection_uri?: string; source?: SourceConfig } = {};
        if (name.trim()) updateData.name = connectionName;
        if (finalConnectionUri || connectionUri) updateData.connection_uri = finalConnectionUri || connectionUri;
        if (connectionType) updateData.source = connectionType;

        const response = await updateConnection({
          path: { connection_uid: connectionId },
          body: updateData,
        });

        if (response.data && typeof response.data === 'object' && 'name' in response.data) {
          // Update connection in store
          updateConnectionInStore(connectionId, {
            name: (response.data as any).name,
            type: (response.data as any).source,
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
          onSuccess?.();
        }
      } else {
        // Create new connection
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
          onSuccess?.();
        }
      }
    } catch (error: any) {
      setUploadStatus('error');
      setErrorMessage(
        error?.response?.data?.detail?.message ||
        error?.response?.data?.detail?.[0]?.msg ||
        error?.message ||
        `Failed to ${isEditMode ? 'update' : 'create'} connection. Please try again.`
      );
    } finally {
      setIsCreating(false);
    }
  };

  const canCreate = connectionType && 
    (connectionType === 'sqlite' 
      ? (isEditMode ? true : file !== null) // In edit mode, file is optional
      : connectionUri.trim() !== '');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Connection" : "Create New Connection"}</DialogTitle>
          <DialogDescription>
            {isEditMode 
              ? "Update your connection details"
              : "Choose a database type and configure your connection"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isEditing ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">Loading connection...</span>
            </div>
          ) : !connectionType ? (
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
                {!isEditMode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConnectionType(null)}
                    disabled={isCreating || isEditing}
                  >
                    Change Type
                  </Button>
                )}
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
                      disabled={isCreating || isEditing}
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
                      disabled={isCreating || isEditing}
                    />
                    {isEditMode && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Leave empty to keep current URI
                      </p>
                    )}
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
                      disabled={isCreating || isEditing || uploadStatus === 'uploading' || isEditMode}
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
              onClick={handleSaveConnection}
              disabled={(!canCreate && !isEditMode) || isCreating || isEditing}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {connectionType === 'sqlite' && uploadStatus === 'uploading' 
                    ? 'Uploading...' 
                    : isEditMode 
                    ? 'Updating...' 
                    : 'Creating...'}
                </>
              ) : (
                isEditMode ? 'Update Connection' : 'Create Connection'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

