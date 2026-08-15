'use client';

import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  MapPin,
  Clock,
  ShieldCheck,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authFetch } from '@/lib/auth-fetch';
import {
  MISSION_STATE_STYLES,
  PRIORITY_STYLES,
  formatDateTime,
  formatRelativeTime,
  getStatusLabel,
} from './admin-types';

// ─── Types ──────────────────────────────────────────────────────────────

interface ActiveMission {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  missionState: string;
  assignedAgentName: string | null;
  slaDeadline: string | null;
  address: string | null;
  lga: string | null;
  state: string | null;
  executingSince: string | null;
  customer: { name: string };
}

interface AuditEventItem {
  id: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: string | null;
  createdAt: string;
  adminUser: { displayName: string; email: string } | null;
}

interface OperationsData {
  summary: {
    activeMissionsCount: number;
    slaAtRiskCount: number;
    escalatedCount: number;
    qcPendingCount: number;
  };
  activeMissions: ActiveMission[];
  recentAuditEvents: AuditEventItem[];
}

// ─── Summary KPI Card ────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  icon: Icon,
  variant = 'default',
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  variant?: 'default' | 'warning' | 'danger' | 'info';
}) {
  const variants = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-amber-100 text-amber-600',
    danger: 'bg-red-100 text-red-600',
    info: 'bg-sky-100 text-sky-600',
  };
  const borderVariants = {
    default: '',
    warning: 'border-amber-200',
    danger: 'border-red-200',
    info: 'border-sky-200',
  };

  return (
    <Card className={borderVariants[variant]}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${variants[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Operations Panel ────────────────────────────────────────────────────

export function OperationsPanel() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOperations() {
      try {
        const res = await authFetch('/api/admin/operations');
        if (!res.ok) throw new Error('Failed to fetch operations');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchOperations();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <p className="text-muted-foreground">{error || 'No operations data'}</p>
        </CardContent>
      </Card>
    );
  }

  const { summary, activeMissions, recentAuditEvents } = data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Active Field Missions"
          value={summary.activeMissionsCount}
          icon={MapPin}
          variant="info"
        />
        <SummaryCard
          title="SLA At-Risk"
          value={summary.slaAtRiskCount}
          icon={AlertTriangle}
          variant={summary.slaAtRiskCount > 0 ? 'danger' : 'default'}
        />
        <SummaryCard
          title="Escalations"
          value={summary.escalatedCount}
          icon={TrendingUp}
          variant={summary.escalatedCount > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          title="QC Pending Review"
          value={summary.qcPendingCount}
          icon={ShieldCheck}
          variant={summary.qcPendingCount > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Active Field Missions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Active Field Missions
            <Badge variant="secondary" className="ml-auto text-xs">
              {activeMissions.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activeMissions.length === 0 ? (
            <div className="py-8 text-center">
              <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No active field missions</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Case #</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Agent</TableHead>
                    <TableHead className="text-xs">State</TableHead>
                    <TableHead className="text-xs">Priority</TableHead>
                    <TableHead className="text-xs">Location</TableHead>
                    <TableHead className="text-xs text-right">SLA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeMissions.map((m) => (
                    <TableRow key={m.id} className="hover:bg-accent/50">
                      <TableCell className="font-mono text-xs">{m.caseNumber}</TableCell>
                      <TableCell className="text-sm font-medium max-w-[180px] truncate">
                        {m.title}
                      </TableCell>
                      <TableCell className="text-sm">{m.customer.name}</TableCell>
                      <TableCell className="text-sm">{m.assignedAgentName || '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${MISSION_STATE_STYLES[m.missionState] || ''}`}
                        >
                          {getStatusLabel(m.missionState)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${PRIORITY_STYLES[m.priority] || ''}`}
                        >
                          {m.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[m.lga, m.state].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {m.slaDeadline ? formatRelativeTime(m.slaDeadline) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Recent Escalations / Audit Events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Recent Operations Events
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentAuditEvents.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No recent events
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Time</TableHead>
                    <TableHead className="text-xs">Actor</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Entity</TableHead>
                    <TableHead className="text-xs">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentAuditEvents.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelativeTime(e.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.adminUser?.displayName || e.actorType}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {e.action.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.entityType}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {e.metadata ? (
                          <span className="font-mono text-[10px]">
                            {e.metadata.length > 60 ? e.metadata.slice(0, 60) + '...' : e.metadata}
                          </span>
                        ) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default OperationsPanel;
