import { useState } from "react";
import { useNavigate } from "react-router";
import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@/components/ui/shadcn-io/dropzone';
import { uploadFile } from '@/lib/sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const navigate = useNavigate();

  const handleDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      // Check if file is SQLite
      if (selectedFile.name.endsWith('.db') || selectedFile.name.endsWith('.sqlite') || selectedFile.name.endsWith('.sqlite3')) {
        setFile(selectedFile);
        setUploadStatus('idle');
        setErrorMessage('');
      } else {
        setErrorMessage('Please upload a SQLite file (.db, .sqlite, or .sqlite3)');
        setUploadStatus('error');
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('idle');
    setErrorMessage('');

    try {
      const response = await uploadFile({
        body: {
          file: file,
        },
      });

      if (response.data) {
        setUploadStatus('success');
        // Optionally navigate to playground or dashboard after successful upload
        setTimeout(() => {
          navigate('/');
        }, 2000);
      }
    } catch (error: any) {
      setUploadStatus('error');
      setErrorMessage(
        error?.response?.data?.detail?.message || 
        error?.message || 
        'Failed to upload file. Please try again.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setUploadStatus('idle');
    setErrorMessage('');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-2rem)] p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Upload SQLite Database</CardTitle>
          <CardDescription>
            Upload a SQLite database file to get started. Supported formats: .db, .sqlite, .sqlite3
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dropzone
            accept={{
              'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'],
              'application/vnd.sqlite3': ['.db', '.sqlite', '.sqlite3'],
            }}
            maxFiles={1}
            maxSize={100 * 1024 * 1024} // 100MB
            onDrop={handleDrop}
            src={file ? [file] : undefined}
            disabled={isUploading}
          >
            <DropzoneEmptyState />
            <DropzoneContent />
          </Dropzone>

          {file && (
            <div className="flex items-center justify-between p-3 bg-muted rounded-md">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
              {!isUploading && uploadStatus === 'idle' && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  Remove
                </Button>
              )}
            </div>
          )}

          {uploadStatus === 'success' && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-400 rounded-md">
              <CheckCircle2 size={16} />
              <span className="text-sm">File uploaded successfully!</span>
            </div>
          )}

          {uploadStatus === 'error' && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-400 rounded-md">
              <AlertCircle size={16} />
              <span className="text-sm">{errorMessage || 'Upload failed'}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={!file || isUploading || uploadStatus === 'success'}
              className="flex-1"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Upload File'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/')}
              disabled={isUploading}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}




