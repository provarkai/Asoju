'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Phase 2 "ASOJU Arrival" — structured pre-arrival detail (flight,
// accommodation, pickup) that the Job Card checklist checks against.
// See backend/src/arrival.

interface ArrivalProfile {
  arrivalDate: string | null;
  flightNumber: string | null;
  departureAirport: string | null;
  arrivalAirport: string | null;
  accommodationAddress: string | null;
  accommodationType: string | null;
  numberOfTravelers: number | null;
  pickupRequired: boolean;
  groceriesRequired: boolean;
  specialRequests: string | null;
}

const ACCOMMODATION_TYPES = [
  { value: '', label: 'Not sure yet' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'short_let', label: 'Short-let' },
  { value: 'family_home', label: 'Family home' },
  { value: 'other', label: 'Other' },
];

export function ArrivalProfileForm({ caseId }: { caseId: string }) {
  const [profile, setProfile] = useState<ArrivalProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [arrivalDate, setArrivalDate] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [departureAirport, setDepartureAirport] = useState('');
  const [arrivalAirport, setArrivalAirport] = useState('');
  const [accommodationAddress, setAccommodationAddress] = useState('');
  const [accommodationType, setAccommodationType] = useState('');
  const [numberOfTravelers, setNumberOfTravelers] = useState('');
  const [pickupRequired, setPickupRequired] = useState(false);
  const [groceriesRequired, setGroceriesRequired] = useState(false);
  const [specialRequests, setSpecialRequests] = useState('');

  useEffect(() => {
    apiFetch<ArrivalProfile | null>(`/cases/${caseId}/arrival-profile`)
      .then((p) => {
        if (!p) return;
        setProfile(p);
        setArrivalDate(p.arrivalDate ? p.arrivalDate.slice(0, 10) : '');
        setFlightNumber(p.flightNumber ?? '');
        setDepartureAirport(p.departureAirport ?? '');
        setArrivalAirport(p.arrivalAirport ?? '');
        setAccommodationAddress(p.accommodationAddress ?? '');
        setAccommodationType(p.accommodationType ?? '');
        setNumberOfTravelers(p.numberOfTravelers ? String(p.numberOfTravelers) : '');
        setPickupRequired(p.pickupRequired);
        setGroceriesRequired(p.groceriesRequired);
        setSpecialRequests(p.specialRequests ?? '');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/cases/${caseId}/arrival-profile`, {
        method: 'POST',
        body: JSON.stringify({
          arrivalDate: arrivalDate || undefined,
          flightNumber: flightNumber || undefined,
          departureAirport: departureAirport || undefined,
          arrivalAirport: arrivalAirport || undefined,
          accommodationAddress: accommodationAddress || undefined,
          accommodationType: accommodationType || undefined,
          numberOfTravelers: numberOfTravelers ? Number(numberOfTravelers) : undefined,
          pickupRequired,
          groceriesRequired,
          specialRequests: specialRequests || undefined,
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save arrival details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Arrival details</h2>
      <p className="muted">
        Tell us your travel plans so we can have everything ready before you land.
        {profile ? '' : ' Nothing on file yet.'}
      </p>
      {error && <p className="error-text">{error}</p>}
      {saved && <p className="muted">Saved.</p>}
      <form onSubmit={save}>
        <label>
          Arrival date
          <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
        </label>
        <label>
          Flight number
          <input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} placeholder="e.g. BA075" />
        </label>
        <label>
          Departure airport
          <input value={departureAirport} onChange={(e) => setDepartureAirport(e.target.value)} />
        </label>
        <label>
          Arrival airport
          <input value={arrivalAirport} onChange={(e) => setArrivalAirport(e.target.value)} placeholder="e.g. Lagos (LOS)" />
        </label>
        <label>
          Accommodation address
          <input value={accommodationAddress} onChange={(e) => setAccommodationAddress(e.target.value)} />
        </label>
        <label>
          Accommodation type
          <select value={accommodationType} onChange={(e) => setAccommodationType(e.target.value)}>
            {ACCOMMODATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Number of travelers
          <input
            type="number"
            min={1}
            value={numberOfTravelers}
            onChange={(e) => setNumberOfTravelers(e.target.value)}
          />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={pickupRequired}
            onChange={(e) => setPickupRequired(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Airport pickup needed
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={groceriesRequired}
            onChange={(e) => setGroceriesRequired(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Groceries stocked before arrival
        </label>
        <label>
          Special requests
          <textarea value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} rows={2} />
        </label>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save arrival details'}
        </button>
      </form>
    </div>
  );
}
