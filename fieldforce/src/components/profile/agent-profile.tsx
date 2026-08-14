 'use client';

import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Phone,
  Mail,
  MapPin,
  Shield,
  Star,
  LogOut,
  Edit,
  ChevronRight,
  Clock,
  Smartphone,
  CheckCircle2,
  XCircle,
  Building2,
  Award,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAppStore } from '@/lib/store';
import { BANKS, AGENT_TIERS, VERIFICATION_LEVELS } from '@/lib/constants';
import type { AgentStatus, AgentTier } from '@/lib/types';

// ─── Status Config ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, { label: string; className: string }> = {
  ACTIVE: {
    label: 'Active',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  IDENTITY_VERIFIED: {
    label: 'Identity Verified',
    className: 'bg-sky-100 text-sky-800 border-sky-200',
  },
  FIELD_VERIFIED: {
    label: 'Field Verified',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  APPLIED: {
    label: 'Applied',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  RESTRICTED: {
    label: 'Restricted',
    className: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  SUSPENDED: {
    label: 'Suspended',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  TERMINATED: {
    label: 'Terminated',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function maskAccountNumber(accountNumber: string | null): string {
  if (!accountNumber) return 'Not set';
  if (accountNumber.length <= 4) return '****';
  return `**** ${accountNumber.slice(-4)}`;
}

function getBankName(bankCode: string | null): string {
  if (!bankCode) return '';
  const bank = BANKS.find((b) => b.code === bankCode);
  return bank ? bank.name : '';
}

function getInitials(firstName: string, lastName: string): string {
  return `${(firstName?.[0] ?? '').toUpperCase()}${(lastName?.[0] ?? '').toUpperCase()}`;
}

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString()}`;
}

function getDeviceModel(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) {
    const match = ua.match(/Android\s([\d.]+);\s*([^;)]+)/);
    return match ? match[2].trim() : 'Android Device';
  }
  return 'Desktop';
}

function getTierConfig(tierName: string | null) {
  if (!tierName) return AGENT_TIERS[0];
  return AGENT_TIERS.find((t) => t.name === tierName) ?? AGENT_TIERS[0];
}

function getVerificationConfig(level: string) {
  return VERIFICATION_LEVELS.find((v) => v.level === level) ?? VERIFICATION_LEVELS[0];
}

// ─── Profile Section Row ──────────────────────────────────────────────────

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ─── Main Agent Profile Component ────────────────────────────────────────

export default function AgentProfile() {
  const { agent, walletSummary, setIsOnboarded, setAgent } = useAppStore();

  // Group LGAs by state
  const lgaByState = (() => {
    if (!agent?.lgas) return [];
    const map = new Map<string, string[]>();
    agent.lgas.forEach((lga) => {
      const existing = map.get(lga.state) || [];
      existing.push(lga.lga);
      map.set(lga.state, existing);
    });
    return Array.from(map.entries()).map(([state, lgas]) => ({
      state,
      lgas: lgas.sort(),
    }));
  })();

  const handleSignOut = () => {
    setAgent(null);
    setIsOnboarded(false);
  };

  if (!agent) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">No profile data found.</p>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.APPLIED;
  const bankName = getBankName(agent.bankCode);
  const tierConfig = getTierConfig(agent.tierName);
  const verificationConfig = getVerificationConfig(agent.verificationLevel);

  return (
    <div className="space-y-4 px-4 pb-8 pt-2">
      {/* ── Avatar & Name Card ──────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-green-600 to-green-700 px-6 pb-14 pt-6" />
        <CardContent className="relative -mt-12 space-y-4 pb-5">
          {/* Avatar */}
          <div className="flex items-end justify-between">
            <Avatar className="h-20 w-20 border-4 border-white shadow-lg">
              <AvatarFallback className="bg-green-600 text-2xl font-bold text-white">
                {getInitials(agent.firstName, agent.lastName)}
              </AvatarFallback>
            </Avatar>
            <Badge
              variant="outline"
              className={`${statusCfg.className} text-[11px] font-semibold`}
            >
              {statusCfg.label}
            </Badge>
          </div>

          {/* Name & contact */}
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {agent.firstName} {agent.lastName}
            </h1>
            {agent.displayName && agent.displayName !== `${agent.firstName} ${agent.lastName}` && (
              <p className="text-sm text-muted-foreground">@{agent.displayName}</p>
            )}
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                <span>{agent.phone}</span>
              </div>
              {agent.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  <span>{agent.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tier & Verification Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${tierConfig.color} text-[11px] font-bold px-2.5 py-1`}>
              <Award className="w-3 h-3 mr-1" />
              {tierConfig.name} Agent
            </Badge>
            <Badge variant="outline" className="text-[11px] font-semibold px-2.5 py-1">
              <Shield className="w-3 h-3 mr-1" />
              {verificationConfig.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ── Stats Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="text-center">
          <CardContent className="px-3 py-4">
            <p className="text-2xl font-bold text-foreground">
              {agent.totalMissionsCompleted}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Missions</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="px-3 py-4">
            <div className="flex items-center justify-center gap-1">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <p className="text-2xl font-bold text-foreground">
                {agent.ratingCount > 0 ? agent.rating.toFixed(1) : '—'}
              </p>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Rating</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="px-3 py-4">
            <p className="text-lg font-bold text-foreground">
              {formatNaira(walletSummary?.totalEarnings ?? agent.totalEarnings)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Earnings</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Performance Metrics ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-amber-500" />
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Reliability Score */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Reliability Score</span>
              <span className="text-xs font-bold text-foreground">
                {(agent.reliabilityScore * 100).toFixed(0)}%
              </span>
            </div>
            <Progress value={agent.reliabilityScore * 100} className="h-2 rounded-full" />
          </div>

          {/* Completion Rate */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Completion Rate</span>
              <span className="text-xs font-bold text-foreground">
                {(agent.completionRate * 100).toFixed(0)}%
              </span>
            </div>
            <Progress
              value={agent.completionRate * 100}
              className="h-2 rounded-full"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Coverage Areas ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-green-600" />
            Coverage Areas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lgaByState.length === 0 ? (
            <p className="text-xs text-muted-foreground">No coverage areas set.</p>
          ) : (
            lgaByState.map(({ state, lgas }) => (
              <div key={state}>
                <p className="mb-1 text-xs font-semibold text-foreground">{state}</p>
                <div className="flex flex-wrap gap-1.5">
                  {lgas.map((lga) => (
                    <Badge
                      key={lga}
                      variant="secondary"
                      className="text-[11px] font-normal"
                    >
                      {lga}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── KYC Status & Bank Account ──────────────────────────── */}
      <Card>
        <CardContent className="space-y-0 p-0">
          {/* KYC / Verification Status */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Verification Level</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                {agent.verificationLevel === 'SPECIALIST_VERIFIED' ||
                agent.verificationLevel === 'FIELD_VERIFIED' ||
                agent.verificationLevel === 'IDENTITY_VERIFIED' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    <span className="text-sm font-medium text-green-700">
                      {verificationConfig.label}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-sm font-medium text-red-600">
                      {verificationConfig.label}
                    </span>
                  </>
                )}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>

          <Separator />

          {/* Bank Account */}
          <ProfileRow
            icon={Building2}
            label="Bank Account"
            value={
              <div>
                {bankName && (
                  <p className="text-xs text-muted-foreground">{bankName}</p>
                )}
                <p className="font-mono text-sm tracking-wider">
                  {agent.accountName || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {maskAccountNumber(agent.accountNumber)}
                </p>
              </div>
            }
          />
        </CardContent>
      </Card>

      {/* ── Capabilities & Certifications ──────────────────────── */}
      {(agent.capabilities.length > 0 || agent.certifications.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Award className="h-4 w-4 text-violet-500" />
              Capabilities & Certifications
            </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {agent.capabilities.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Capabilities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {agent.capabilities.map((cap) => (
                  <Badge
                    key={cap}
                    variant="secondary"
                    className="text-[11px] bg-violet-50 text-violet-700 border-violet-200"
                  >
                    {cap}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {agent.certifications.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Certifications
              </p>
              <div className="flex flex-wrap gap-1.5">
                {agent.certifications.map((cert) => (
                  <Badge
                    key={cert}
                    variant="secondary"
                    className="text-[11px] bg-amber-50 text-amber-700 border-amber-200"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {cert}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── Device Info ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            Device Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          <ProfileRow
            icon={Clock}
            label="Last Active"
            value={
              agent.lastActiveAt
                ? formatDistanceToNow(new Date(agent.lastActiveAt), {
                    addSuffix: true,
                  })
                : 'Unknown'
            }
          />
          <Separator className="mx-4" />
          <div className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Device</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {getDeviceModel()}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Actions ──────────────────────────────────────────── */}
      <div className="space-y-3 pt-1">
        <Button
          variant="outline"
          className="w-full justify-between gap-2 font-medium"
          onClick={() => {
            /* Navigate to edit profile */
          }}
        >
          <span className="flex items-center gap-2">
            <Edit className="h-4 w-4" />
            Edit Profile
          </span>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button
          variant="destructive"
          className="w-full gap-2 font-medium"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>

      {/* ── App Version ──────────────────────────────────────── */}
      <p className="pb-4 text-center text-[11px] text-muted-foreground">
        ASOJU FieldForce v4.0.0
      </p>
    </div>
  );
}
