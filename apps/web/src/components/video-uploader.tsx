 

'use client';

import React, { useState, useRef } from 'react';
import { Button } from './ui/button';
import { api } from '../lib/api/client';
import { UploadCloud, FileVideo, Image as ImageIcon, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';

interface VideoUploaderProps {
  workspaceId: string;
  onUploadComplete: (mediaAssetId: string) => void;
}

type UploadStatus = 'idle' | 'preparing' | 'uploading' | 'verifying' | 'ready' | 'error';

export function VideoUploader({ workspaceId, onUploadComplete }: VideoUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MiB

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/') && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Please select a valid image or video file.');
      setStatus('error');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMsg('File exceeds the 500MB maximum size limit.');
      setStatus('error');
      return;
    }

    setSelectedFile(file);
    setErrorMsg(null);
    setStatus('idle');
    setProgress(0);
  };

  const startUpload = async () => {
    if (!selectedFile) return;

    try {
      setStatus('preparing');
      
      const initiateRes = await api.post<{ mediaAssetId: string; uploadUrl: string }>(
        `workspaces/${workspaceId}/media/uploads`,
        {
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          byteSize: selectedFile.size,
        }
      );

      const { mediaAssetId, uploadUrl } = initiateRes;

      setStatus('uploading');
      
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            setProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Storage rejected upload with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));

        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', selectedFile.type);
        xhr.send(selectedFile);
      });

      setStatus('verifying');
      await api.post(`workspaces/${workspaceId}/media/${mediaAssetId}/complete`);
      
      setStatus('ready');
      onUploadComplete(mediaAssetId);

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      if (err.message === 'Upload cancelled') {
        setStatus('idle');
        setSelectedFile(null);
        setProgress(0);
        return;
      }
      console.error('Upload failed:', err);
      setErrorMsg(err.message || 'An unexpected error occurred during upload.');
      setStatus('error');
    } finally {
      xhrRef.current = null;
    }
  };

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Media Upload</h3>
        {status === 'ready' && <span className="flex items-center text-sm font-medium text-green-600"><CheckCircle2 className="w-4 h-4 mr-1" /> Ready</span>}
      </div>

      {status === 'idle' || status === 'error' ? (
        <div className="space-y-4">
          {!selectedFile ? (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:bg-gray-50 transition-colors">
              <UploadCloud className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4 flex text-sm text-gray-600 justify-center">
                <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
                  <span>Upload a file</span>
                  <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,video/*" onChange={handleFileSelect} />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500 mt-2">JPEG, PNG, WEBP, MP4, WebM up to 500MB</p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
              <div className="flex items-center space-x-3 truncate">
                {selectedFile?.type.startsWith('image/') ? (
                  <ImageIcon className="h-8 w-8 text-blue-500 flex-shrink-0" />
                ) : (
                  <FileVideo className="h-8 w-8 text-blue-500 flex-shrink-0" />
                )}
                <div className="truncate">
                  <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                <Button variant="secondary" onClick={() => setSelectedFile(null)}>Change</Button>
                <Button onClick={startUpload}>Start Upload</Button>
              </div>
            </div>
          )}

          {status === 'error' && errorMsg && (
            <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-md flex items-start">
              <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center space-x-3 truncate">
              {selectedFile?.type.startsWith('image/') ? (
                <ImageIcon className="h-8 w-8 text-blue-500 flex-shrink-0" />
              ) : (
                <FileVideo className="h-8 w-8 text-blue-500 flex-shrink-0" />
              )}
              <div className="truncate">
                <p className="text-sm font-medium text-gray-900 truncate">{selectedFile?.name}</p>
                <div className="flex flex-col mt-1">
                  <div className="flex items-center text-xs font-medium text-gray-700 mb-1">
                    {status === 'preparing' && <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Preparing upload...</>}
                    {status === 'uploading' && <span>Uploading {progress}%</span>}
                    {status === 'verifying' && <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Verifying upload...</>}
                    {status === 'ready' && <span className="text-green-600">Upload Complete</span>}
                  </div>
                  {status === 'uploading' && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                      <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {status === 'uploading' && (
              <button onClick={cancelUpload} className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200 focus:outline-none ml-4 flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
