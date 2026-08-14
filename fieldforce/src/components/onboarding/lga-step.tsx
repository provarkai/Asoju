'use client';

import { useState, useMemo } from 'react';
import { Loader2, X, MapPin } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NIGERIAN_STATES } from '@/lib/constants';
import { updateAgentLGAs } from '@/lib/asoju-api';

// ─── Types ──────────────────────────────────────────────────────────────────

type SelectedLGA = { state: string; lga: string };

interface LGAStepProps {
  onNext: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LGAStep({ onNext }: LGAStepProps) {
  const [selectedState, setSelectedState] = useState('');
  const [selectedLGAs, setSelectedLGAs] = useState<SelectedLGA[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const stateNames = useMemo(() => Object.keys(NIGERIAN_STATES).sort(), []);
  const lgas = useMemo(
    () => (selectedState ? NIGERIAN_STATES[selectedState] ?? [] : []),
    [selectedState],
  );

  // ─── LGA Toggle ──────────────────────────────────────────────────────

  function toggleLGA(lga: string) {
    setSelectedLGAs((prev) => {
      const exists = prev.some((item) => item.state === selectedState && item.lga === lga);
      if (exists) {
        return prev.filter((item) => !(item.state === selectedState && item.lga === lga));
      }
      return [...prev, { state: selectedState, lga }];
    });
    setError('');
  }

  function removeLGA(index: number) {
    setSelectedLGAs((prev) => prev.filter((_, i) => i !== index));
  }

  function isLGASelected(lga: string) {
    return selectedLGAs.some((item) => item.state === selectedState && item.lga === lga);
  }

  // ─── Submit ──────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (selectedLGAs.length === 0) {
      setError('Select at least 1 LGA to continue');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await updateAgentLGAs(selectedLGAs);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save LGAs');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full border-2 border-emerald-200">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl text-emerald-900">Your Coverage Area</CardTitle>
        <CardDescription className="text-sm">
          Select the state and LGAs you can cover
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* State Selector */}
        <div>
          <label className="text-sm font-semibold mb-2 block">State *</label>
          <Select value={selectedState} onValueChange={setSelectedState}>
            <SelectTrigger className="h-12 w-full text-base">
              <SelectValue placeholder="Select your state" />
            </SelectTrigger>
            <SelectContent>
              {stateNames.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* LGA Grid */}
        {selectedState && (
          <div>
            <label className="text-sm font-semibold mb-2 block">
              Select LGAs in {selectedState} *
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
              {lgas.map((lga) => {
                const selected = isLGASelected(lga);
                return (
                  <button
                    key={lga}
                    type="button"
                    onClick={() => toggleLGA(lga)}
                    className={[
                      'min-h-[44px] px-3 py-2 rounded-lg border-2 text-sm font-medium text-left transition-all',
                      selected
                        ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50',
                    ].join(' ')}
                  >
                    {lga}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected LGAs as Chips */}
        {selectedLGAs.length > 0 && (
          <div>
            <label className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <MapPin className="size-4 text-emerald-600" />
              Selected ({selectedLGAs.length})
            </label>
            <div className="flex flex-wrap gap-2">
              {selectedLGAs.map((item, idx) => (
                <Badge
                  key={`${item.state}-${item.lga}`}
                  variant="secondary"
                  className="pl-3 pr-1 py-1.5 h-auto text-sm gap-1.5 bg-emerald-100 text-emerald-800 border border-emerald-200"
                >
                  <span>{item.lga}</span>
                  <button
                    type="button"
                    onClick={() => removeLGA(idx)}
                    className="ml-1 w-6 h-6 rounded-full bg-emerald-200 hover:bg-emerald-300 text-emerald-800 flex items-center justify-center transition-colors"
                    aria-label={`Remove ${item.lga}`}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

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
          {loading ? 'Saving...' : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  );
}
