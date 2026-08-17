'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  HeartPulse,
  Database,
  Server,
  Shield,
  Send,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  Cpu,
  HardDrive,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { authFetch } from '@/lib/auth-fetch';

// ─── Types ──────────────────────────────────────────────────────────────

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  details?: string;
  checkedAt: string;
}

interface SchemaReadiness {
  status: 'ready' | 'not_ready';
  missingTables: string[];
  checkedAt: string;
}

interface SystemInfo {
  environment: string;
  databaseProvider: string;
  nodeVersion: string;
  uptimeSeconds: number;
  memoryUsage: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
}

interface OutboxHealth {
  pending: number;
  deadLetter: number;
}

interface CircuitBreakerInfo {
  state: string;
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  halfOpenAttempts: number;
}

interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  database: HealthStatus;
  schema: SchemaReadiness;
  system: SystemInfo;
  outbox: OutboxHealth;
  circuitBreakers: Record<string, CircuitBreakerInfo>;
  checkedAt: string;
}

interface DependenciesResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  dependencies: {
    database: HealthStatus;
    schema: SchemaReadiness;
    system: SystemInfo;
  };
  outbox: OutboxHealth;
  externalProviders: Record<string, {
    status: string;
    state: string;
    failures: number;
    lastFailureAt: string | null;
  }>;
  circuitBreakers: Record<string, CircuitBreakerInfo>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  healthy: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-300',
    icon: <CheckCircle className="size-5 text-emerald-600" />,
  },
  degraded: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-300',
    icon: <AlertTriangle className="size-5 text-amber-600" />,
  },
  unhealthy: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-300',
    icon: <XCircle className="size-5 text-red-600" />,
  },
};

const CIRCUIT_STATE_STYLES: Record<string, string> = {
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  HALF_OPEN: 'bg-amber-100 text-amber-800 border-amber-200',
  OPEN: 'bg-red-100 text-red-800 border-red-200',
};

const CIRCUIT_STATE_ICONS: Record<string, React.ReactNode> = {
  CLOSED: <CheckCircle className="size-3" />,
  HALF_OPEN: <AlertTriangle className="size-3" />,
  OPEN: <XCircle className="size-3" />,
};

// ─── Sub-components ─────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'healthy' || status === 'ready' || status === 'CLOSED'
      ? 'bg-emerald-500'
      : status === 'degraded' || status === 'HALF_OPEN'
        ? 'bg-amber-500'
        : 'bg-red-500';

  return <span className={`inline-block size-2.5 rounded-full ${color}`} />;
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function SystemHealthPanel() {
  const [depsData, setDepsData] = useState<DependenciesResponse | null>(null);
  const [readyData, setReadyData] = useState<ReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setError(null);
    try {
      const [depsRes, readyRes] = await Promise.all([
        authFetch('/api/health/dependencies'),
        authFetch('/api/health/ready').catch(() => null), // 503 is expected when not ready
      ]);

      if (!depsRes.ok) throw new Error('Failed to load dependency health');
      const depsJson: DependenciesResponse = await depsRes.json();
      setDepsData(depsJson);

      if (readyRes && readyRes.ok) {
        const readyJson: ReadinessResponse = await readyRes.json();
        setReadyData(readyJson);
      } else if (readyRes) {
        // Parse 503 body
        try {
          const readyJson: ReadinessResponse = await readyRes.json();
          setReadyData(readyJson);
        } catch {
          setReadyData(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const overallStatus = depsData?.status ?? 'unhealthy';
  const theme = STATUS_COLORS[overallStatus] ?? STATUS_COLORS.unhealthy;
  const readinessStatus = readyData?.status ?? 'not_ready';

  // ─── Loading State ────────────────────────────────────────────────────

  if (loading && !depsData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <HeartPulse className="size-5" />
          <h2 className="text-lg font-semibold">System Health</h2>
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HeartPulse className="size-5" />
          <h2 className="text-lg font-semibold">System Health</h2>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <XCircle className="size-4 shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-red-700 hover:bg-red-100"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Overall Status Banner */}
      <div
        className={`flex items-center gap-3 rounded-xl border-2 p-4 ${theme.bg} ${theme.border}`}
      >
        {theme.icon}
        <div>
          <p className={`text-base font-semibold ${theme.text}`}>
            System is {overallStatus.charAt(0).toUpperCase() + overallStatus.slice(1)}
          </p>
          <p className="text-sm text-muted-foreground">
            Readiness: {readinessStatus === 'ready' ? 'Ready' : 'Not Ready'}
            {depsData?.timestamp && (
              <span className="ml-2">
                · Last checked {new Date(depsData.timestamp).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        {readinessStatus === 'ready' ? (
          <Badge className="ml-auto bg-emerald-100 text-emerald-800 border-emerald-200" variant="outline">
            <CheckCircle className="size-3" />
            Ready
          </Badge>
        ) : (
          <Badge className="ml-auto bg-red-100 text-red-800 border-red-200" variant="outline">
            <XCircle className="size-3" />
            Not Ready
          </Badge>
        )}
      </div>

      {/* Health Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* System Info Card */}
        {depsData?.dependencies.system && (
          <SectionCard icon={<Server className="size-4 text-muted-foreground" />} title="System Info">
            <div className="space-y-3">
              <InfoRow
                label="Environment"
                value={
                  <Badge variant="secondary" className="text-xs">
                    {depsData.dependencies.system.environment}
                  </Badge>
                }
              />
              <Separator />
              <InfoRow
                label="Node Version"
                value={
                  <span className="font-mono text-xs">
                    {depsData.dependencies.system.nodeVersion}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Uptime"
                value={
                  <span className="flex items-center gap-1.5 text-sm">
                    <Clock className="size-3.5 text-muted-foreground" />
                    {formatUptime(depsData.dependencies.system.uptimeSeconds)}
                  </span>
                }
              />
              <Separator />
              <div>
                <p className="mb-2 text-sm font-medium">Memory Usage</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <Cpu className="mx-auto mb-1 size-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">RSS</p>
                    <p className="text-sm font-semibold">
                      {depsData.dependencies.system.memoryUsage.rssMb} MB
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <HardDrive className="mx-auto mb-1 size-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Heap Total</p>
                    <p className="text-sm font-semibold">
                      {depsData.dependencies.system.memoryUsage.heapTotalMb} MB
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <Cpu className="mx-auto mb-1 size-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Heap Used</p>
                    <p className="text-sm font-semibold">
                      {depsData.dependencies.system.memoryUsage.heapUsedMb} MB
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Database Card */}
        {depsData?.dependencies.database && (
          <SectionCard icon={<Database className="size-4 text-muted-foreground" />} title="Database">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusDot status={depsData.dependencies.database.status} />
                <Badge
                  variant="outline"
                  className={
                    STATUS_COLORS[depsData.dependencies.database.status]?.bg +
                    ' ' +
                    STATUS_COLORS[depsData.dependencies.database.status]?.text +
                    ' ' +
                    STATUS_COLORS[depsData.dependencies.database.status]?.border
                  }
                >
                  {depsData.dependencies.database.status.toUpperCase()}
                </Badge>
              </div>
              <Separator />
              <InfoRow
                label="Latency"
                value={
                  <span
                    className={`text-sm font-medium ${
                      depsData.dependencies.database.latencyMs > 1000
                        ? 'text-red-600'
                        : depsData.dependencies.database.latencyMs > 200
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                    }`}
                  >
                    {depsData.dependencies.database.latencyMs}ms
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Details"
                value={
                  <span className="text-sm text-muted-foreground">
                    {depsData.dependencies.database.details ?? '—'}
                  </span>
                }
              />
            </div>
          </SectionCard>
        )}

        {/* Schema Card */}
        {depsData?.dependencies.schema && (
          <SectionCard icon={<Shield className="size-4 text-muted-foreground" />} title="Schema">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusDot status={depsData.dependencies.schema.status} />
                <Badge
                  variant="outline"
                  className={
                    depsData.dependencies.schema.status === 'ready'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : 'bg-red-100 text-red-800 border-red-200'
                  }
                >
                  {depsData.dependencies.schema.status === 'ready' ? 'Ready' : 'Not Ready'}
                </Badge>
              </div>
              {depsData.dependencies.schema.missingTables.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-red-600">Missing Tables</p>
                    <div className="flex flex-wrap gap-1.5">
                      {depsData.dependencies.schema.missingTables.map((t) => (
                        <Badge
                          key={t}
                          variant="outline"
                          className="border-red-200 bg-red-50 text-xs text-red-700"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {depsData.dependencies.schema.missingTables.length === 0 && (
                <p className="text-sm text-emerald-600">All required tables are present.</p>
              )}
            </div>
          </SectionCard>
        )}

        {/* Outbox Queue Card */}
        {depsData?.outbox && (
          <SectionCard icon={<Send className="size-4 text-muted-foreground" />} title="Outbox Queue">
            <div className="space-y-3">
              <InfoRow
                label="Pending"
                value={
                  <span
                    className={`text-sm font-semibold ${
                      depsData.outbox.pending > 0 ? 'text-amber-600' : 'text-muted-foreground'
                    }`}
                  >
                    {depsData.outbox.pending}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Dead Letter"
                value={
                  <span
                    className={`text-sm font-semibold ${
                      depsData.outbox.deadLetter > 0 ? 'text-red-600' : 'text-muted-foreground'
                    }`}
                  >
                    {depsData.outbox.deadLetter}
                  </span>
                }
              />
              {depsData.outbox.deadLetter > 0 && (
                <p className="text-xs text-red-500">
                  <AlertTriangle className="mr-1 inline size-3" />
                  Dead-lettered messages require manual replay.
                </p>
              )}
              {depsData.outbox.pending === 0 && depsData.outbox.deadLetter === 0 && (
                <p className="text-sm text-emerald-600">Queue is empty and healthy.</p>
              )}
            </div>
          </SectionCard>
        )}

        {/* Circuit Breakers Card */}
        {depsData?.circuitBreakers && (
          <SectionCard
            icon={<Shield className="size-4 text-muted-foreground" />}
            title="Circuit Breakers"
          >
            {Object.keys(depsData.circuitBreakers).length === 0 ? (
              <p className="text-sm text-muted-foreground">No circuit breakers registered.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {Object.entries(depsData.circuitBreakers).map(([name, cb]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot status={cb.state} />
                      <span className="text-sm font-medium truncate">{name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={CIRCUIT_STATE_STYLES[cb.state] ?? ''}
                      >
                        {CIRCUIT_STATE_ICONS[cb.state]}
                        {cb.state}
                      </Badge>
                      {cb.failures > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {cb.failures} failure{cb.failures !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
