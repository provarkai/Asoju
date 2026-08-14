'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  MapPin,
  Clock,
  CheckCircle2,
  ArrowUpCircle,
  Eye,
  EyeOff,
  RefreshCw,
  Bell,
  BellRing,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { authFetch } from '@/lib/auth-fetch';
import { formatDateTime } from './admin-types';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────

type SosStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ESCALATED';
type SosType = 'MEDICAL' | 'SAFETY' | 'VEHICLE' | 'SECURITY' | 'OTHER';
type SosSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface SosAlert {
  id: string;
  agentId: string;
  agentName: string;
  type: SosType;
  severity: SosSeverity;
  status: SosStatus;
  location: string;
  coordinates: { lat: number; lng: number } | null;
  missionTitle: string | null;
  notes: string;
  resolutionNotes: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

interface SosDashboardData {
  alerts: SosAlert[];
  activeCount: number;
  acknowledgedCount: number;
  totalToday: number;
}

// ─── Type Badge ──────────────────────────────────────────────────────────

const SOS_TYPE_STYLES: Record<SosType, { label: string; color: string; bgColor: string; borderColor: string }> = {
  MEDICAL: { label: 'Medical', color: 'text-red-700', bgColor: 'bg-red-100', borderColor: 'border-red-200' },
  SAFETY: { label: 'Safety', color: 'text-orange-700', bgColor: 'bg-orange-100', borderColor: 'border-orange-200' },
  VEHICLE: { label: 'Vehicle', color: 'text-amber-700', bgColor: 'bg-amber-100', borderColor: 'border-amber-200' },
  SECURITY: { label: 'Security', color: 'text-violet-700', bgColor: 'bg-violet-100', borderColor: 'border-violet-200' },
  OTHER: { label: 'Other', color: 'text-slate-700', bgColor: 'bg-slate-100', borderColor: 'border-slate-200' },
};

function SosTypeBadge({ type }: { type: SosType }) {
  const config = SOS_TYPE_STYLES[type];
  return (
    <Badge variant="outline" className={`${config.bgColor} ${config.color} ${config.borderColor} text-[11px] font-semibold px-2 py-0.5`}>
      {config.label}
    </Badge>
  );
}

// ─── Severity Badge ─────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<SosSeverity, { label: string; color: string; bgColor: string }> = {
  LOW: { label: 'Low', color: 'text-slate-700', bgColor: 'bg-slate-100' },
  MEDIUM: { label: 'Medium', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  HIGH: { label: 'High', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  CRITICAL: { label: 'Critical', color: 'text-red-700', bgColor: 'bg-red-100' },
};

function SeverityBadge({ severity }: { severity: SosSeverity }) {
  const config = SEVERITY_STYLES[severity];
  return (
    <Badge className={`${config.bgColor} ${config.color} text-[11px] font-semibold px-2 py-0.5`}>
      {config.label}
    </Badge>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────

const SOS_STATUS_STYLES: Record<SosStatus, { label: string; color: string; bgColor: string; borderColor: string }> = {
  ACTIVE: { label: 'Active', color: 'text-red-700', bgColor: 'bg-red-100', borderColor: 'border-red-200' },
  ACKNOWLEDGED: { label: 'Acknowledged', color: 'text-orange-700', bgColor: 'bg-orange-100', borderColor: 'border-orange-200' },
  RESOLVED: { label: 'Resolved', color: 'text-emerald-700', bgColor: 'bg-emerald-100', borderColor: 'border-emerald-200' },
  ESCALATED: { label: 'Escalated', color: 'text-violet-700', bgColor: 'bg-violet-100', borderColor: 'border-violet-200' },
};

function SosStatusBadge({ status }: { status: SosStatus }) {
  const config = SOS_STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={`${config.bgColor} ${config.color} ${config.borderColor} text-[11px] font-semibold px-2 py-0.5`}>
      {config.label}
    </Badge>
  );
}

// ─── Active Alert Banner ─────────────────────────────────────────────────

function ActiveAlertBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="bg-red-600 text-white px-4 py-3 rounded-lg flex items-center justify-between animate-pulse">
      <div className="flex items-center gap-3">
        <BellRing className="w-5 h-5" />
        <span className="font-semibold text-sm">
          {count} Active Emergency Alert{count !== 1 ? 's' : ''} — Immediate Attention Required
        </span>
      </div>
      <AlertTriangle className="w-5 h-5" />
    </div>
  );
}

// ─── Resolve Dialog ────────────────────────────────────────────────────

function ResolveDialog({
  alert,
  open,
  onClose,
  onResolve,
  resolving,
}: {
  alert: SosAlert | null;
  open: boolean;
  onClose: () => void;
  onResolve: (alertId: string, notes: string, status: SosStatus) => void;
  resolving: boolean;
}) {
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<SosStatus>('RESOLVED');

  if (!alert) return null;

  const handleSubmit = () => {
    if (!notes.trim()) {
      toast.error('Please add resolution notes');
      return;
    }
    onResolve(alert.id, notes.trim(), status);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Resolve SOS Alert
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted rounded-lg p-3 space-y-1">
            <p className="text-sm font-medium">{alert.agentName}</p>
            <p className="text-xs text-muted-foreground">
              {SOS_TYPE_STYLES[alert.type].label} • {SEVERITY_STYLES[alert.severity].label}
            </p>
            <p className="text-xs text-muted-foreground">{alert.location}</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Resolution Status</label>
            <Select value={status} onValueChange={(v) => setStatus(v as SosStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="ESCALATED">Escalated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Resolution Notes *</label>
            <Textarea
              placeholder="Describe how this alert was handled..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={resolving || !notes.trim()}>
              {resolving ? 'Resolving...' : 'Resolve Alert'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export function SosPanel() {
  const [data, setData] = useState<SosDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resolveAlert, setResolveAlert] = useState<SosAlert | null>(null);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolving, setResolving] = useState(false);

  const fetchData = async () => {
    try {
      const res = await authFetch('/api/admin/sos-alerts');
      if (!res.ok) throw new Error('Failed to fetch SOS alerts');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredAlerts = useMemo(() => {
    if (!data) return [];
    // Sort: ACTIVE first, then ACKNOWLEDGED, then others by time desc
    const sorted = [...data.alerts].sort((a, b) => {
      const order: Record<SosStatus, number> = { ACTIVE: 0, ACKNOWLEDGED: 1, ESCALATED: 2, RESOLVED: 3 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (statusFilter === 'all') return sorted;
    return sorted.filter((a) => a.status === statusFilter);
  }, [data, statusFilter]);

  const handleAcknowledge = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      const res = await authFetch(`/api/admin/sos-alerts/${alertId}/acknowledge`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to acknowledge');
      toast.success('Alert acknowledged');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async (alertId: string, notes: string, status: SosStatus) => {
    setResolving(true);
    try {
      const res = await authFetch(`/api/admin/sos-alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, status }),
      });
      if (!res.ok) throw new Error('Failed to resolve');
      toast.success(status === 'ESCALATED' ? 'Alert escalated' : 'Alert resolved');
      setResolveDialogOpen(false);
      setResolveAlert(null);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setResolving(false);
    }
  };

  const handleEscalate = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      const res = await authFetch(`/api/admin/sos-alerts/${alertId}/escalate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to escalate');
      toast.success('Alert escalated');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Escalation failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{error || 'No SOS data available'}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Alert Banner */}
      <ActiveAlertBanner count={data.activeCount} />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className={data.activeCount > 0 ? 'border-red-200 bg-red-50/50' : ''}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${data.activeCount > 0 ? 'bg-red-200' : 'bg-muted'}`}>
              <Bell className={`w-5 h-5 ${data.activeCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.activeCount}</p>
              <p className="text-xs text-muted-foreground">Active Alerts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-orange-100">
              <Eye className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.acknowledgedCount}</p>
              <p className="text-xs text-muted-foreground">Acknowledged</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-muted">
              <AlertCircle className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.totalToday}</p>
              <p className="text-xs text-muted-foreground">Total Today</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Emergency Alerts
            </CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                <SelectItem value="ESCALATED">Escalated</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No alerts found</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="hidden sm:table-cell">Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((alert) => {
                    const isHighlighted = alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED';
                    return (
                      <TableRow
                        key={alert.id}
                        className={isHighlighted ? (alert.status === 'ACTIVE' ? 'bg-red-50/60' : 'bg-orange-50/40') : ''}
                      >
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(alert.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{alert.agentName}</p>
                            {alert.missionTitle && (
                              <p className="text-[11px] text-muted-foreground truncate max-w-[150px]">{alert.missionTitle}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell><SosTypeBadge type={alert.type} /></TableCell>
                        <TableCell><SeverityBadge severity={alert.severity} /></TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground max-w-[180px] truncate">
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {alert.location}
                          </div>
                        </TableCell>
                        <TableCell><SosStatusBadge status={alert.status} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {alert.status === 'ACTIVE' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2"
                                  onClick={() => handleAcknowledge(alert.id)}
                                  disabled={actionLoading === alert.id}
                                >
                                  <Eye className="w-3 h-3 mr-1" />
                                  {actionLoading === alert.id ? '...' : 'Ack'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2 text-orange-600"
                                  onClick={() => {
                                    setResolveAlert(alert);
                                    setResolveDialogOpen(true);
                                  }}
                                  disabled={actionLoading === alert.id}
                                >
                                  <ArrowUpCircle className="w-3 h-3 mr-1" />
                                  Resolve
                                </Button>
                              </>
                            )}
                            {alert.status === 'ACKNOWLEDGED' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2"
                                  onClick={() => {
                                    setResolveAlert(alert);
                                    setResolveDialogOpen(true);
                                  }}
                                  disabled={actionLoading === alert.id}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  {actionLoading === alert.id ? '...' : 'Resolve'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2 text-violet-600"
                                  onClick={() => handleEscalate(alert.id)}
                                  disabled={actionLoading === alert.id}
                                >
                                  <ArrowUpCircle className="w-3 h-3 mr-1" />
                                  Escalate
                                </Button>
                              </>
                            )}
                            {alert.status === 'RESOLVED' && (
                              <span className="text-[11px] text-emerald-600">
                                ✓ {formatDateTime(alert.resolvedAt || '')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Resolve Dialog */}
      <ResolveDialog
        key={resolveAlert?.id || 'closed'}
        alert={resolveAlert}
        open={resolveDialogOpen}
        onClose={() => setResolveDialogOpen(false)}
        onResolve={handleResolve}
        resolving={resolving}
      />
    </div>
  );
}

export default SosPanel;
