'use client';

import { useState, useRef, useCallback } from 'react';
import { Loader2, Camera, Upload, X, CreditCard, BookOpen, Vote } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { submitKYC } from '@/lib/asoju-api';
import type { IDType } from '@/lib/types';

// ─── ID Type Options ────────────────────────────────────────────────────────

const ID_OPTIONS: { value: IDType; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    value: 'NIN',
    label: 'NIN Slip',
    icon: <CreditCard className="size-6" />,
    desc: 'National Identification Number',
  },
  {
    value: 'PASSPORT',
    label: 'Passport',
    icon: <BookOpen className="size-6" />,
    desc: 'International Passport',
  },
  {
    value: 'VOTERS_CARD',
    label: "Voter's Card",
    icon: <Vote className="size-6" />,
    desc: 'Permanent Voter\'s Card',
  },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface KYCStepProps {
  onNext: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function KYCStep({ onNext }: KYCStepProps) {
  const [idType, setIdType] = useState<IDType | ''>('');
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const idInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  // ─── File Handlers ────────────────────────────────────────────────────

  const handleIdFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    setError('');
    setIdFile(file);
    const url = URL.createObjectURL(file);
    setIdPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const handleSelfieFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    setError('');
    setSelfieFile(file);
    const url = URL.createObjectURL(file);
    setSelfiePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const clearIdFile = useCallback(() => {
    if (idPreview) URL.revokeObjectURL(idPreview);
    setIdFile(null);
    setIdPreview(null);
    if (idInputRef.current) idInputRef.current.value = '';
  }, [idPreview]);

  const clearSelfieFile = useCallback(() => {
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    setSelfieFile(null);
    setSelfiePreview(null);
    if (selfieInputRef.current) selfieInputRef.current.value = '';
  }, [selfiePreview]);

  // ─── Submit ──────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!idType) {
      setError('Please select an ID type');
      return;
    }
    if (!idFile) {
      setError('Please upload your ID document');
      return;
    }
    if (!selfieFile) {
      setError('Please take a selfie');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('idType', idType);
      formData.append('idDocument', idFile);
      formData.append('selfie', selfieFile);
      await submitKYC(formData);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full border-2 border-emerald-200">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl text-emerald-900">Verify Your Identity</CardTitle>
        <CardDescription className="text-sm">
          Select your ID type and upload a clear photo
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* ID Type Selector - Radio Cards */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">ID Type *</Label>
          <RadioGroup
            value={idType}
            onValueChange={(v) => {
              setIdType(v as IDType);
              setError('');
            }}
            className="grid grid-cols-1 gap-3"
          >
            {ID_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                htmlFor={`id-${opt.value}`}
                className={[
                  'flex items-center gap-3 rounded-xl border-2 p-4 cursor-pointer transition-all min-h-[56px]',
                  idType === opt.value
                    ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-emerald-300',
                ].join(' ')}
              >
                <RadioGroupItem value={opt.value} id={`id-${opt.value}`} className="sr-only" />
                <div
                  className={[
                    'flex items-center justify-center w-11 h-11 rounded-lg shrink-0',
                    idType === opt.value
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {opt.icon}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-900">{opt.label}</span>
                  <span className="text-xs text-gray-500">{opt.desc}</span>
                </div>
                <div className="ml-auto">
                  <div
                    className={[
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      idType === opt.value
                        ? 'border-emerald-600 bg-emerald-600'
                        : 'border-gray-300',
                    ].join(' ')}
                  >
                    {idType === opt.value && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>

        {/* ID Document Upload */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">Upload ID Document *</Label>
          {idPreview ? (
            <div className="relative rounded-xl overflow-hidden border-2 border-emerald-300">
              <img
                src={idPreview}
                alt="ID document preview"
                className="w-full h-44 object-cover"
              />
              <button
                type="button"
                onClick={clearIdFile}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md"
                aria-label="Remove ID"
              >
                <X className="size-4" />
              </button>
              <p className="text-xs text-center text-gray-500 bg-gray-50 py-1.5 font-medium">
                {idFile?.name}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => idInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-8 min-h-[120px] cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors"
            >
              <Upload className="size-8 text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Tap to upload ID</span>
              <span className="text-xs text-gray-400">JPG, PNG accepted</span>
            </button>
          )}
          <input
            ref={idInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleIdFile}
          />
        </div>

        {/* Selfie Capture */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">Take a Selfie *</Label>
          {selfiePreview ? (
            <div className="relative rounded-xl overflow-hidden border-2 border-emerald-300">
              <img
                src={selfiePreview}
                alt="Selfie preview"
                className="w-full h-44 object-cover"
              />
              <button
                type="button"
                onClick={clearSelfieFile}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md"
                aria-label="Remove selfie"
              >
                <X className="size-4" />
              </button>
              <p className="text-xs text-center text-gray-500 bg-gray-50 py-1.5 font-medium">
                Selfie captured
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => selfieInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-8 min-h-[120px] cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors"
            >
              <Camera className="size-8 text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Tap to take selfie</span>
              <span className="text-xs text-gray-400">Use your front camera</span>
            </button>
          )}
          <input
            ref={selfieInputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={handleSelfieFile}
          />
        </div>

        {/* Error Display */}
        {error && (
          <p className="text-sm text-red-600 font-medium text-center bg-red-50 rounded-lg py-2 px-3">
            {error}
          </p>
        )}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          className="h-12 w-full text-base font-bold bg-emerald-600 hover:bg-emerald-700"
          disabled={loading}
        >
          {loading && <Loader2 className="animate-spin" />}
          {loading ? 'Uploading...' : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  );
}
