'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, CheckCircle, XCircle, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface GpsCheckInProps {
  onCheckIn: (lat: number, lng: number, accuracy: number) => void;
  isCheckedIn: boolean;
  distance?: number;
}

type GpsStatus = 'idle' | 'acquiring' | 'success' | 'error';

export function GpsCheckIn({ onCheckIn, isCheckedIn, distance }: GpsCheckInProps) {
  const [status, setStatus] = useState<GpsStatus>(isCheckedIn ? 'success' : 'idle');
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Cleanup geolocation watch on unmount
  useEffect(() => {
    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [watchId]);

  // Sync isCheckedIn prop with local state
  useEffect(() => {
    if (isCheckedIn && status !== 'success') {
      setStatus('success');
    }
  }, [isCheckedIn, status]);

  const acquireGps = useCallback(() => {
    if (status === 'acquiring' || status === 'success') return;

    setStatus('acquiring');
    setErrorMsg(null);

    if (!navigator.geolocation) {
      setStatus('error');
      setErrorMsg('Geolocation is not supported by this device');
      return;
    }

    // Use watchPosition for real-time updates while acquiring
    const id = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setCoords({ lat: latitude, lng: longitude, accuracy });

        // Once we have a reasonable accuracy (under 50m), consider it good enough
        if (accuracy <= 50) {
          navigator.geolocation.clearWatch(id);
          setStatus('success');
          onCheckIn(latitude, longitude, accuracy);
        }
      },
      (error) => {
        setStatus('error');
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setErrorMsg('Location permission denied. Please enable GPS in your device settings.');
            break;
          case error.POSITION_UNAVAILABLE:
            setErrorMsg('Location information is unavailable. Please check your GPS signal.');
            break;
          case error.TIMEOUT:
            setErrorMsg('Location request timed out. Please try again.');
            break;
          default:
            setErrorMsg('An unknown error occurred while getting your location.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );

    setWatchId(id);

    // Fallback timeout - if we don't get good accuracy in 10s, use whatever we have
    setTimeout(() => {
      if (coords) {
        navigator.geolocation.clearWatch(id);
        setStatus('success');
        onCheckIn(coords.lat, coords.lng, coords.accuracy);
      }
    }, 10000);
  }, [status, coords, onCheckIn, watchId]);

  const formatCoords = (lat: number, lng: number) => {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(5)}°${latDir}, ${Math.abs(lng).toFixed(5)}°${lngDir}`;
  };

  return (
    <Card className="border-2 border-primary/20">
      <CardContent className="p-4 space-y-4">
        {/* GPS Status Display */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <AnimatePresence mode="wait">
              {status === 'acquiring' && (
                <motion.div
                  key="pulse"
                  className="relative flex items-center justify-center"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  {/* Animated pulse rings */}
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-sky-400"
                    animate={{
                      scale: [1, 1.5, 2],
                      opacity: [0.6, 0.3, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeOut',
                    }}
                  />
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-sky-400"
                    animate={{
                      scale: [1, 1.5, 2],
                      opacity: [0.6, 0.3, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeOut',
                      delay: 0.5,
                    }}
                  />
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-sky-400"
                    animate={{
                      scale: [1, 1.5, 2],
                      opacity: [0.6, 0.3, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeOut',
                      delay: 1,
                    }}
                  />
                  {/* Center dot */}
                  <div className="relative w-6 h-6 rounded-full bg-sky-500 flex items-center justify-center">
                    <Navigation className="w-3.5 h-3.5 text-white" />
                  </div>
                </motion.div>
              )}
              {status === 'success' && (
                <motion.div
                  key="success"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center"
                >
                  <CheckCircle className="w-6 h-6 text-white" />
                </motion.div>
              )}
              {status === 'error' && (
                <motion.div
                  key="error"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center"
                >
                  <XCircle className="w-6 h-6 text-white" />
                </motion.div>
              )}
              {status === 'idle' && (
                <motion.div
                  key="idle"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"
                >
                  <Radio className="w-5 h-5 text-muted-foreground" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {status === 'idle' && 'GPS Ready'}
              {status === 'acquiring' && 'Acquiring GPS Signal...'}
              {status === 'success' && 'Location Acquired'}
              {status === 'error' && 'GPS Error'}
            </p>
            {coords && (
              <p className="text-xs text-muted-foreground font-mono truncate">
                {formatCoords(coords.lat, coords.lng)}
                {coords.accuracy && (
                  <span className="ml-2">
                    ±{Math.round(coords.accuracy)}m
                  </span>
                )}
              </p>
            )}
            {distance !== undefined && (
              <p
                className={cn(
                  'text-xs font-semibold mt-0.5',
                  distance <= 100 ? 'text-green-600' : 'text-amber-600'
                )}
              >
                <MapPin className="inline w-3 h-3 mr-1" />
                {distance.toFixed(0)}m from target location
              </p>
            )}
          </div>
        </div>

        {/* Error Message */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3"
            >
              <p className="text-sm text-red-700 font-medium">{errorMsg}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Check In Button */}
        <Button
          ref={buttonRef}
          onClick={acquireGps}
          disabled={status === 'acquiring' || status === 'success'}
          className={cn(
            'w-full h-14 text-base font-bold rounded-xl transition-all',
            status === 'idle' && 'bg-green-600 hover:bg-green-700 text-white',
            status === 'acquiring' &&
              'bg-sky-500 hover:bg-sky-600 text-white cursor-wait',
            status === 'success' &&
              'bg-green-600 text-white cursor-default',
            status === 'error' &&
              'bg-red-600 hover:bg-red-700 text-white'
          )}
          size="lg"
        >
          {status === 'idle' && (
            <>
              <Navigation className="w-5 h-5 mr-2" />
              Check In at Location
            </>
          )}
          {status === 'acquiring' && (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Navigation className="w-5 h-5 mr-2" />
              </motion.div>
              Acquiring GPS...
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle className="w-5 h-5 mr-2" />
              Checked In Successfully
            </>
          )}
          {status === 'error' && (
            <>
              <Navigation className="w-5 h-5 mr-2" />
              Retry Check In
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
