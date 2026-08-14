'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Camera,
  Video,
  Plus,
  Upload,
  CheckCircle,
  RotateCw,
  Clock,
  MapPin,
  HardDrive,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

// ─── Props ──────────────────────────────────────────────────────────────────

interface EvidenceCaptureProps {
  missionId: string;
  onEvidenceUploaded: (url: string, metadata: object) => void;
}

interface EvidenceItem {
  id: string;
  file: File;
  preview: string;
  type: 'photo' | 'video';
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress: number;
  metadata: {
    timestamp: string;
    fileSize: string;
    fileName: string;
    lat?: number;
    lng?: number;
  };
  url?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EvidenceCapture({ missionId, onEvidenceUploaded }: EvidenceCaptureProps) {
  const { isOnline } = useAppStore();
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [showVideoOption, setShowVideoOption] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getCurrentPosition = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
      );
    });
  };

  const handleFileCapture = useCallback(
    async (files: FileList | null, type: 'photo' | 'video') => {
      if (!files || files.length === 0) return;

      const position = await getCurrentPosition();

      const newItems: EvidenceItem[] = Array.from(files).map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        preview: URL.createObjectURL(file),
        type,
        status: 'pending' as const,
        progress: 0,
        metadata: {
          timestamp: new Date().toISOString(),
          fileSize: formatFileSize(file.size),
          fileName: file.name,
          lat: position?.lat,
          lng: position?.lng,
        },
      }));

      setEvidence((prev) => [...prev, ...newItems]);

      for (const item of newItems) {
        await simulateUpload(item);
      }
    },
    [missionId, onEvidenceUploaded]
  );

  const simulateUpload = async (item: EvidenceItem) => {
    setEvidence((prev) =>
      prev.map((e) => (e.id === item.id ? { ...e, status: 'uploading' as const, progress: 0 } : e))
    );

    const totalSteps = 10;
    for (let step = 1; step <= totalSteps; step++) {
      await new Promise((r) => setTimeout(r, 200));
      setEvidence((prev) =>
        prev.map((e) =>
          e.id === item.id ? { ...e, progress: Math.round((step / totalSteps) * 100) } : e
        )
      );
    }

    setEvidence((prev) =>
      prev.map((e) =>
        e.id === item.id
          ? { ...e, status: 'uploaded' as const, progress: 100, url: e.preview }
          : e
      )
    );

    onEvidenceUploaded(item.preview, {
      missionId,
      fileName: item.metadata.fileName,
      fileSize: item.metadata.fileSize,
      timestamp: item.metadata.timestamp,
      lat: item.metadata.lat,
      lng: item.metadata.lng,
      type: item.type,
    });
  };

  const removeEvidence = (id: string) => {
    setEvidence((prev) => {
      const item = prev.find((e) => e.id === id);
      if (item) {
        URL.revokeObjectURL(item.preview);
      }
      return prev.filter((e) => e.id !== id);
    });
  };

  const getStatusIcon = (status: EvidenceItem['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-3 h-3 text-muted-foreground" />;
      case 'uploading':
        return <RotateCw className="w-3 h-3 text-sky-500" />;
      case 'uploaded':
        return <CheckCircle className="w-3 h-3 text-green-500" />;
      case 'failed':
        return <X className="w-3 h-3 text-red-500" />;
    }
  };

  const uploadedCount = evidence.filter((e) => e.status === 'uploaded').length;
  const uploadingCount = evidence.filter((e) => e.status === 'uploading').length;

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold">
              Evidence Capture
            </CardTitle>
            {evidence.length > 0 && (
              <Badge
                variant={uploadedCount === evidence.length ? 'default' : 'secondary'}
                className="text-xs"
              >
                {uploadedCount}/{evidence.length} uploaded
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Capture Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              className="h-14 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm"
              onClick={() => photoInputRef.current?.click()}
            >
              <Camera className="w-5 h-5 mr-2" />
              Take Photo
            </Button>

            {!showVideoOption ? (
              <Button
                variant="outline"
                className="h-14 rounded-xl border-2 font-bold text-sm"
                onClick={() => setShowVideoOption(true)}
              >
                <Video className="w-5 h-5 mr-2" />
                Record Video
              </Button>
            ) : (
              <Button
                className="h-14 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm"
                onClick={() => videoInputRef.current?.click()}
              >
                <Video className="w-5 h-5 mr-2" />
                Record Video
              </Button>
            )}
          </div>

          {/* Offline warning */}
          {!isOnline && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-amber-700 font-medium">
                You&apos;re offline — evidence will be queued for upload
              </span>
            </div>
          )}

          {/* Hidden file inputs */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFileCapture(e.target.files, 'photo')}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFileCapture(e.target.files, 'video')}
          />

          {/* Upload Progress (when uploading) */}
          <AnimatePresence>
            {uploadingCount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                {evidence
                  .filter((e) => e.status === 'uploading')
                  .map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[70%]">
                          {item.metadata.fileName}
                        </span>
                        <span className="font-semibold text-sky-600">{item.progress}%</span>
                      </div>
                      <Progress value={item.progress} className="h-2" />
                    </div>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Evidence Grid */}
          {evidence.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Captured Evidence ({evidence.length})
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {evidence.map((item) => (
                  <div
                    key={item.id}
                    className="relative aspect-square rounded-lg overflow-hidden border-2 border-border bg-muted"
                  >
                    {item.type === 'photo' ? (
                      <img
                        src={item.preview}
                        alt={item.metadata.fileName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <video
                        src={item.preview}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                      />
                    )}

                    <div
                      className={cn(
                        'absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center',
                        item.status === 'uploaded' && 'bg-green-500',
                        item.status === 'uploading' && 'bg-sky-500',
                        item.status === 'pending' && 'bg-gray-400',
                        item.status === 'failed' && 'bg-red-500'
                      )}
                    >
                      {getStatusIcon(item.status)}
                    </div>

                    <Badge
                      variant="secondary"
                      className="absolute top-1 right-1 text-[9px] px-1 py-0"
                    >
                      {item.type === 'photo' ? '📷' : '🎬'}
                    </Badge>

                    {item.status === 'uploading' && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                        <motion.div
                          className="h-full bg-sky-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}

                    <button
                      onClick={() => removeEvidence(item.id)}
                      className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
                      aria-label="Remove evidence"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Metadata for latest evidence item */}
              <AnimatePresence>
                {evidence.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="bg-muted/50 rounded-lg p-3 space-y-1"
                  >
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Latest Capture Details
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>
                          {new Date(
                            evidence[evidence.length - 1].metadata.timestamp
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        <span>{evidence[evidence.length - 1].metadata.fileSize}</span>
                      </div>
                      {evidence[evidence.length - 1].metadata.lat && (
                        <div className="flex items-center gap-1 col-span-2">
                          <MapPin className="w-3 h-3" />
                          <span className="font-mono">
                            {evidence[evidence.length - 1].metadata.lat!.toFixed(5)}°N,{' '}
                            {evidence[evidence.length - 1].metadata.lng!.toFixed(5)}°E
                          </span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                variant="outline"
                className="w-full h-12 rounded-xl border-dashed border-2 font-bold text-sm"
                onClick={() => photoInputRef.current?.click()}
              >
                <Plus className="w-5 h-5 mr-2" />
                Add More Evidence
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
