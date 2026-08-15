// ─── ASOJU Main Platform API Client v4.0 ────────────────────────────────
// JWT-authenticated API client. The middleware validates the ff_token cookie.
// For demo/development, use demoLogin() to auto-authenticate.

const API_BASE = '/api';

// ─── Auth Endpoints ───────────────────────────────────────────────────────

/** Authenticate as the demo agent. Sets httpOnly JWT cookie. */
export async function demoLogin(): Promise<{ agent: any }> {
  const res = await fetch(`${API_BASE}/auth/demo`, { method: 'POST' });
  if (!res.ok) throw new Error('Demo login failed');
  return res.json();
}

/** Login with phone + password. Sets httpOnly JWT cookie. */
export async function login(data: { phone: string; password: string }) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json();
}

// ─── Agent Endpoints ───────────────────────────────────────────────────────

export async function createAgentProfile(data: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}) {
  const res = await fetch(`${API_BASE}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create agent profile');
  return res.json();
}

export async function submitKYC(data: FormData) {
  const res = await fetch(`${API_BASE}/agent/onboarding`, {
    method: 'POST',
    body: data,
  });
  if (!res.ok) throw new Error('Failed to submit KYC');
  return res.json();
}

export async function updateAgentLGAs(lgas: { state: string; lga: string }[]) {
  const res = await fetch(`${API_BASE}/agent`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lgas }),
  });
  if (!res.ok) throw new Error('Failed to update LGAs');
  return res.json();
}

export async function getAgentProfile() {
  const res = await fetch(`${API_BASE}/agent`);
  if (!res.ok) throw new Error('Failed to fetch agent profile');
  return res.json();
}

// ─── Gig Board Endpoints ───────────────────────────────────────────────────

export async function fetchAvailableGigs() {
  const res = await fetch(`${API_BASE}/gigs`);
  if (!res.ok) throw new Error('Failed to fetch gigs');
  return res.json();
}

export async function acceptGig(caseId: string) {
  const res = await fetch(`${API_BASE}/gigs/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId }),
  });
  if (!res.ok) throw new Error('Failed to accept gig');
  return res.json();
}

export async function declineGig(caseId: string) {
  const res = await fetch(`${API_BASE}/gigs`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId }),
  });
  if (!res.ok) throw new Error('Failed to decline gig');
  return res.json();
}

// ─── Mission Execution Endpoints ───────────────────────────────────────────

export async function fetchMyMissions() {
  const res = await fetch(`${API_BASE}/missions`);
  if (!res.ok) throw new Error('Failed to fetch missions');
  return res.json();
}

export async function gpsCheckIn(data: {
  caseId: string;
  lat: number;
  lng: number;
  accuracy: number;
}) {
  const res = await fetch(`${API_BASE}/missions/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed GPS check-in');
  return res.json();
}

export async function updateChecklist(data: {
 caseId: string;
  checklistId: string;
  completed: boolean;
  value?: string;
  photoUrl?: string;
  idempotencyKey: string;
}) {
  const res = await fetch(`${API_BASE}/missions`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update checklist');
  return res.json();
}

export async function uploadEvidence(data: FormData) {
  const res = await fetch(`${API_BASE}/missions/evidence`, {
    method: 'POST',
    body: data,
  });
  if (!res.ok) throw new Error('Failed to upload evidence');
  return res.json();
}

export async function escalateMission(data: {
  caseId: string;
  reason: string;
  escalationType?: string;
  severity?: string;
}) {
  const res = await fetch(`${API_BASE}/missions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'escalate', ...data }),
  });
  if (!res.ok) throw new Error('Failed to escalate mission');
  return res.json();
}

export async function submitMission(caseId: string) {
  const res = await fetch(`${API_BASE}/missions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit', caseId }),
  });
  if (!res.ok) throw new Error('Failed to submit mission');
  return res.json();
}

// ─── Wallet & Earnings Endpoints ─────────────────────────────────────────

export async function fetchWalletSummary() {
  const res = await fetch(`${API_BASE}/wallet`);
  if (!res.ok) throw new Error('Failed to fetch wallet summary');
  return res.json();
}

export async function fetchWalletEntries() {
  const res = await fetch(`${API_BASE}/wallet/entries`);
  if (!res.ok) throw new Error('Failed to fetch wallet entries');
  return res.json();
}

export async function fetchEarnings() {
  const res = await fetch(`${API_BASE}/earnings`);
  if (!res.ok) throw new Error('Failed to fetch earnings');
  return res.json();
}

export async function requestPayout(data: { amount: number }) {
  const res = await fetch(`${API_BASE}/earnings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to request payout');
  return res.json();
}

// ─── Support Endpoints ────────────────────────────────────────────────────

export async function fetchSupportMessages(missionId?: string) {
  const params = missionId ? `?missionId=${missionId}` : '';
  const res = await fetch(`${API_BASE}/support${params}`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function sendSupportMessage(data: {
  message: string;
  missionId?: string;
  attachment?: File;
}) {
  const formData = new FormData();
  formData.append('message', data.message);
  if (data.missionId) formData.append('missionId', data.missionId);
  if (data.attachment) formData.append('attachment', data.attachment);

  const res = await fetch(`${API_BASE}/support`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}
