'use client';

import { useState, useCallback } from 'react';
import { Camera, MapPin, HardDrive, Check, X, Loader2, Shield } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';

// ─── Permission Types ───────────────────────────────────────────────────────

type PermissionKey = 'camera' | 'gps' | 'storage';

interface PermissionState {
  camera: 'idle' | 'checking' | 'granted' | 'denied';
  gps: 'idle' | 'checking' | 'granted' | 'denied';
  storage: 'idle' | 'checking' | 'granted' | 'denied';
}

interface PermConfig {
  key: PermissionKey;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const PERMISSIONS: PermConfig[] = [
  {
    key: 'camera',
    label: 'Camera',
    desc: 'For taking photos and selfies during missions',
    icon: <Camera className="size-6" />,
  },
  {
    key: 'gps',
    label: 'Location / GPS',
    desc: 'For GPS check-in at mission locations',
    icon: <MapPin className="size-6" />,
  },
  {
    key: 'storage',
    label: 'Storage',
    desc: 'To save evidence photos and work offline',
    icon: <HardDrive className="size-6" />,
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function DeviceStep() {
  const [perms, setPerms] = useState<PermissionState>({
    camera: 'idle',
    gps: 'idle',
    storage: 'idle',
  });
  const [completing, setCompleting] = useState(false);
  const setIsOnboarded = useAppStore((s) => s.setIsOnboarded);

  const requestCamera = useCallback(async (): Promise<boolean> => {
    try {
      setPerms((p) => ({ ...p, camera: 'checking' }));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      stream.getTracks().forEach((t) => t.stop());
      setPerms((p) => ({ ...p, camera: 'granted' }));
      return true;
    } catch {
      setPerms((p) => ({ ...p, camera: 'denied' }));
      return false;
    }
  }, []);

  const requestGPS = useCallback(async (): Promise<boolean> => {
    try {
      setPerms((p) => ({ ...p, gps: 'checking' }));
      const result = await navigator.permissions.query({ name: 'geolocation' });
      if (result.state === 'granted') {
        setPerms((p) => ({ ...p, gps: 'granted' }));
        return true;
      }
      if (result.state === 'denied') {
        setPerms((p) => ({ ...p, gps: 'denied' }));
        return false;
      }
      await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });
      setPerms((p) => ({ ...p, gps: 'granted' }));
      return true;
    } catch {
      setPerms((p) => ({ ...p, gps: 'denied' }));
      return false;
    }
  }, []);

  const requestStorage = useCallback(async (): Promise<boolean> => {
    try {
      setPerms((p) => ({ ...p, storage: 'checking' }));
      if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        setPerms((p) => ({ ...p, storage: granted ? 'granted' : 'denied' }));
        return granted;
      }
      if (navigator.storage?.estimate != null) {
        setPerms((p) => ({ ...p, storage: 'granted' }));
        return true;
      }
      setPerms((p) => ({ ...p, storage: 'granted' }));
      return true;
    } catch {
      setPerms((p) => ({ ...p, storage: 'denied' }));
      return false;
    }
  }, []);

  const requesters: Record<PermissionKey, () => Promise<boolean>> = {
    camera: requestCamera,
    gps: requestGPS,
    storage: requestStorage,
  };

  async function requestPermission(key: PermissionKey) {
    await requesters[key]();
  }

  async function handleComplete() {
    setCompleting(true);
    await new Promise((r) => setTimeout(r, 600));
    setIsOnboarded(true);
  }

  const allChecked = perms.camera === 'granted' && perms.gps === 'granted' && perms.storage === 'granted';

  return (
    <Card className="w-full border-2 border-emerald-200">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl text-emerald-900">Device Permissions</CardTitle>
        <CardDescription className="text-sm">
          Grant permissions to use the app effectively
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {PERMISSIONS.map((perm) => {
            const status = perms[perm.key];
            return (
              <button
                key={perm.key}
                type="button"
                onClick={() => requestPermission(perm.key)}
                disabled={status === 'checking'}
                className="flex items-center gap-4 rounded-xl border-2 border-gray-200 bg-white p-4 min-h-[64px] transition-all hover:border-emerald-300 disabled:opacity-60 w-full text-left"
              >
                <div
                  className={[
                    'flex items-center justify-center w-12 h-12 rounded-xl shrink-0',
                    status === 'granted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : status === 'denied'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {perm.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{perm.label}</p>
                  <p className="text-xs text-gray-500 truncate">{perm.desc}</p>
                </div>

                <div className="shrink-0">
                  {status === 'checking' && (
                    <Loader2 className="size-6 text-amber-500 animate-spin" />
                  )}
                  {status === 'granted' && (
                    <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Check className="size-5 text-white" strokeWidth={3} />
                    </div>
                  )}
                  {status === 'denied' && (
                    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                      <X className="size-5 text-white" strokeWidth={3} />
                    </div>
                  )}
                  {status === 'idle' && (
                    <div className="w-8 h-8 rounded-full border-2 border-gray-300" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <Shield className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            You can enable these later in your device settings if you skip now.
            However, camera and location are required for field work.
          </p>
        </div>

        <Button
          onClick={handleComplete}
          className="h-14 w-full text-base font-bold bg-emerald-600 hover:bg-emerald-700"
          disabled={completing}
        >
          {completing && <Loader2 className="animate-spin" />}
          {completing ? 'Setting up...' : 'Complete Setup'}
        </Button>
      </CardContent>
    </Card>
  );
}
