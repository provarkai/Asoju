'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

interface MeResponse {
  id: string;
  role: string;
  agentProfile: { id: string } | null;
}

/**
 * #54 — wallet/trust-score/financial-plan/ledger are all keyed by Agent
 * id, not the User id the session already carries, and there was no way
 * for the frontend to resolve its own one. Fetched fresh from /auth/me
 * (not cached at login) since it's only needed by the handful of pages
 * that actually show earnings/performance data.
 *
 * `agentId` stays null for a PROVIDER account (shares the field portal
 * but has no Agent row) or while still loading — callers distinguish the
 * two with `ready`.
 */
export function useFieldAgentId(): { agentId: string | null; ready: boolean } {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiFetch<MeResponse>('/auth/me')
      .then((me) => setAgentId(me.agentProfile?.id ?? null))
      .finally(() => setReady(true));
  }, []);

  return { agentId, ready };
}
