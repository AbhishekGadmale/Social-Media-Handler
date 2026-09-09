import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api/client';
import { UploadCloud, FileVideo, ImageIcon, AlertCircle, X, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from './ui/button';

interface MediaUploaderProps {
  workspaceId: string;
  onUploadsChange: (mediaAssetIds: string[]) => void;
  onUploadingStateChange?: (isUploading: boolean) => void;
}

type UploadStatus = 'idle' | 'preparing' | 'uploading' | 'verifying' | 'ready' | 'error';

interface MediaItem {
  id: string; // stable UI ID
  file: File;
  previewUrl?: string;
  status: UploadStatus;
  progress: number;
  mediaAssetId?: string;
  errorMsg?: string;
  xhr?: XMLHttpRequest;
}

export function MediaUploader({ workspaceId, onUploadsChange, onUploadingStateChange }: MediaUploaderProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  
  const uploadQueue = useRef<MediaItem[]>([]);
  const isProcessingQueue = useRef(false);
  const activeXhr = useRef<XMLHttpRequest | null>(null);

  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  const MAX_IMAGES = 20;

  useEffect(() => {
    return () => {
      items.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      if (activeXhr.current) {
        activeXhr.current.abort();
      }
    };
  }, []); // revokes all on unmount

  useEffect(() => {
    const ids = items.filter(i => i.status === 'ready' && i.mediaAssetId).map(i => i.mediaAssetId!);
    onUploadsChange(ids);
    const isUploading = items.some(i => ['preparing', 'uploading', 'verifying'].includes(i.status));
    if (onUploadingStateChange) {
      onUploadingStateChange(isUploading || isProcessingQueue.current);
    }
  }, [items, onUploadsChange, onUploadingStateChange]);

  const processQueue = async () => {
    if (isProcessingQueue.current || uploadQueue.current.length === 0) return;
    
    isProcessingQueue.current = true;
    
    while (uploadQueue.current.length > 0) {
      const itemToUpload = uploadQueue.current.shift()!;
      
      // Check if it was removed before it started
      let isRemoved = false;
      setItems(prev => {
        if (!prev.find(i => i.id === itemToUpload.id)) isRemoved = true;
        return prev;
      });
      if (isRemoved) continue;

      if (itemToUpload.file.size > MAX_FILE_SIZE) {
        updateItem(itemToUpload.id, { status: 'error', errorMsg: 'File exceeds the 500MB limit.' });
        continue;
      }

      updateItem(itemToUpload.id, { status: 'preparing' });

      try {
        const initiateRes = await api.post<{ mediaAssetId: string; uploadUrl: string }>(
          `workspaces/${workspaceId}/media/uploads`,
          {
            filename: itemToUpload.file.name,
            mimeType: itemToUpload.file.type,
            byteSize: itemToUpload.file.size,
          }
        );

        const { mediaAssetId, uploadUrl } = initiateRes;
        
        const xhr = new XMLHttpRequest();
        activeXhr.current = xhr;
        updateItem(itemToUpload.id, { status: 'uploading', xhr, mediaAssetId });
        
        await new Promise<void>((resolve, reject) => {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percentComplete = Math.round((event.loaded / event.total) * 100);
              updateItem(itemToUpload.id, { progress: percentComplete });
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Storage rejected upload with status ${xhr.status}`));
          };

          xhr.onerror = () => reject(new Error('Network error during upload'));
          xhr.onabort = () => reject(new Error('Upload cancelled'));

          xhr.open('PUT', uploadUrl, true);
          xhr.setRequestHeader('Content-Type', itemToUpload.file.type);
          xhr.send(itemToUpload.file);
        });

        updateItem(itemToUpload.id, { status: 'verifying' });
        await api.post(`workspaces/${workspaceId}/media/${mediaAssetId}/complete`);
        updateItem(itemToUpload.id, { status: 'ready' });

      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        if (err.message === 'Upload cancelled') {
          // Handled in remove
          continue;
        }
        updateItem(itemToUpload.id, { status: 'error', errorMsg: err.message || 'Upload failed.' });
      } finally {
        activeXhr.current = null;
      }
    }
    
    isProcessingQueue.current = false;
    // trigger state update to let parent know uploading is done
    setItems(prev => [...prev]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    // clear value so same file can be selected again if removed
    e.target.value = '';
    
    setGlobalError(null);

    // Analyze current state
    const currentImages = items.filter(i => i.file.type.startsWith('image/'));
    const currentVideos = items.filter(i => i.file.type.startsWith('video/'));
    
    const newImages = files.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type));
    const newVideos = files.filter(f => f.type === 'video/mp4' || f.type === 'video/webm' || f.type.startsWith('video/'));

    // Validation
    if (newVideos.length > 0 && currentImages.length > 0) {
      setGlobalError('Images and video cannot be mixed in one post.');
      return;
    }
    if (newImages.length > 0 && currentVideos.length > 0) {
      setGlobalError('Images and video cannot be mixed in one post.');
      return;
    }
    if (currentVideos.length + newVideos.length > 1) {
      setGlobalError('Video posts support one video only.');
      return;
    }
    if (currentImages.length + newImages.length > MAX_IMAGES) {
      setGlobalError(`Maximum ${MAX_IMAGES} images allowed.`);
      return;
    }

    const validFiles = [...newImages, ...newVideos];
    if (validFiles.length < files.length) {
      setGlobalError('Some files were ignored due to unsupported format.');
    }

    if (validFiles.length === 0) return;

    const newItems: MediaItem[] = validFiles.map(file => {
      let previewUrl;
      if (file.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(file);
      }
      return {
        id: Math.random().toString(36).substring(7),
        file,
        previewUrl,
        status: 'idle',
        progress: 0
      };
    });

    setItems(prev => [...prev, ...newItems]);
    
    uploadQueue.current.push(...newItems);
    processQueue();
  };

  const updateItem = (id: string, updates: Partial<MediaItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        if (item.xhr) item.xhr.abort();
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter(i => i.id !== id);
    });
    // Remove from queue if it hasn't started
    uploadQueue.current = uploadQueue.current.filter(i => i.id !== id);
  };

  return (
    <div className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Media Attachments</h3>
      </div>
      
      {globalError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md flex items-start">
          <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
          <span>{globalError}</span>
        </div>
      )}

      <div className="space-y-4">
        {items.length > 0 && (
          <div className="space-y-3">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-center space-x-3 truncate flex-1">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt={item.file.name} className="h-10 w-10 object-cover rounded flex-shrink-0 border bg-white" />
                  ) : (
                    <FileVideo className="h-10 w-10 text-blue-500 flex-shrink-0" />
                  )}
                  <div className="truncate flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.file.name}</p>
                    <div className="flex flex-col mt-1">
                      <div className="flex items-center text-xs font-medium text-gray-700 mb-1">
                        {item.status === 'preparing' && <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Preparing...</>}
                        {item.status === 'uploading' && <span>Uploading {item.progress}%</span>}
                        {item.status === 'verifying' && <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Verifying...</>}
                        {item.status === 'ready' && <span className="text-green-600 flex items-center"><CheckCircle2 className="w-3 h-3 mr-1"/> Ready</span>}
                        {item.status === 'error' && <span className="text-red-600 flex items-center"><AlertCircle className="w-3 h-3 mr-1"/> {item.errorMsg}</span>}
                      </div>
                      {item.status === 'uploading' && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1 max-w-xs">
                          <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${item.progress}%` }}></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <button aria-label={`Remove ${item.file.name}`} onClick={() => removeItem(item.id)} className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200 focus:outline-none ml-4 flex-shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-gray-50 transition-colors">
          <UploadCloud className="mx-auto h-8 w-8 text-gray-400" />
          <div className="mt-2 flex text-sm text-gray-600 justify-center">
            <label className="relative cursor-pointer bg-transparent rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
              <span>Select files</span>
              <input type="file" multiple className="sr-only" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={handleFileSelect} />
            </label>
            <p className="pl-1">or drag and drop</p>
          </div>
          <p className="text-xs text-gray-500 mt-1">JPEG, PNG, WEBP, MP4 (Max 20 images or 1 video, 500MB/file)</p>
        </div>
      </div>
    </div>
  );
}
