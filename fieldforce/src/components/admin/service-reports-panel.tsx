'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  FileCheck,
  CheckCircle2,
  Clock,
  XCircle,
  Send,
  ChevronDown,
  ChevronUp,
  MapPin,
  ImageIcon,
  RefreshCw,
  FileText,
  Download,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { authFetch } from '@/lib/auth-fetch';
import { formatDateTime } from './admin-types';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────

type DeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';
type MissionOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REJECTED';

interface ServiceReport {
  id: string;
  missionId: string;
  caseId: string;
  caseNumber: string;
  agentName: string;
  outcome: MissionOutcome;
  duration: number;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
  deliveredAt: string | null;
  reportContent: string;
  gpsCoordinates: { lat: number; lng: number } | null;
  photos: string[];
  timeline: TimelineEvent[];
}

interface TimelineEvent {
  time: string;
  label: string;
}

interface ReportsDashboardData {
  reports: ServiceReport[];
  totalReports: number;
  deliveredCount: number;
  pendingCount: number;
  failedCount: number;
}

// ─── Outcome Badge ──────────────────────────────────────────────────────

const OUTCOME_STYLES: Record<MissionOutcome, { label: string; color: string; bgColor: string; borderColor: string }> = {
  SUCCESS: { label: 'Success', color: 'text-emerald-700', bgColor: 'bg-emerald-100', borderColor: 'border-emerald-200' },
  PARTIAL: { label: 'Partial', color: 'text-amber-700', bgColor: 'bg-amber-100', borderColor: 'border-amber-200' },
  FAILED: { label: 'Failed', color: 'text-red-700', bgColor: 'bg-red-100', borderColor: 'border-red-200' },
  REJECTED: { label: 'Rejected', color: 'text-rose-700', bgColor: 'bg-rose-100', borderColor: 'border-rose-200' },
};

function OutcomeBadge({ outcome }: { outcome: MissionOutcome }) {
  const config = OUTCOME_STYLES[outcome];
  return (
    <Badge variant="outline" className={`${config.bgColor} ${config.color} ${config.borderColor} text-[11px] font-semibold px-2 py-0.5`}>
      {config.label}
    </Badge>
  );
}

const DELIVERY_STYLES: Record<DeliveryStatus, { label: string; color: string; bgColor: string; borderColor: string }> = {
  DELIVERED: { label: 'Delivered', color: 'text-emerald-700', bgColor: 'bg-emerald-100', borderColor: 'border-emerald-200' },
  PENDING: { label: 'Pending', color: 'text-amber-700', bgColor: 'bg-amber-100', borderColor: 'border-amber-200' },
  FAILED: { label: 'Failed', color: 'text-red-700', bgColor: 'bg-red-100', borderColor: 'border-red-200' },
};

function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const config = DELIVERY_STYLES[status];
  return (
    <Badge variant="outline" className={`${config.bgColor} ${config.color} ${config.borderColor} text-[11px] font-semibold px-2 py-0.5`}>
      {config.label}
    </Badge>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  icon: Icon,
  color = 'text-primary',
  bg = 'bg-muted',
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
  bg?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Generate Report Dialog ─────────────────────────────────────────────

function GenerateReportDialog({
  open,
  onClose,
  onGenerate,
  generating,
}: {
  open: boolean;
  onClose: () => void;
  onGenerate: (missionId: string) => void;
  generating: boolean;
}) {
  const [missionId, setMissionId] = useState('');

  const handleSubmit = () => {
    if (!missionId.trim()) return;
    onGenerate(missionId.trim());
    setMissionId('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> Generate Service Report
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Mission ID</label>
            <Input
              placeholder="Enter mission ID"
              value={missionId}
              onChange={(e) => setMissionId(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={generating || !missionId.trim()}>
              <FileText className="w-4 h-4 mr-2" />
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export function ServiceReportsPanel() {
  const [data, setData] = useState<ReportsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await authFetch('/api/admin/service-reports');
      if (!res.ok) throw new Error('Failed to fetch service reports');
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

  const filteredReports = useMemo(() => {
    if (!data) return [];
    if (statusFilter === 'all') return data.reports;
    return data.reports.filter((r) => r.deliveryStatus === statusFilter);
  }, [data, statusFilter]);

  const handleMarkDelivered = async (reportId: string) => {
    setActionLoading(reportId);
    try {
      const res = await authFetch(`/api/admin/service-reports/${reportId}/deliver`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to mark delivered');
      toast.success('Report marked as delivered');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async (reportId: string) => {
    setActionLoading(reportId);
    try {
      const res = await authFetch(`/api/admin/service-reports/${reportId}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error('Retry failed');
      toast.success('Delivery retry initiated');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerate = async (missionId: string) => {
    setGenerating(true);
    try {
      const res = await authFetch('/api/admin/service-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      });
      if (!res.ok) throw new Error('Generation failed');
      toast.success('Service report generated');
      setGenDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const toggleExpand = (reportId: string) => {
    setExpandedRow(expandedRow === reportId ? null : reportId);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
          <FileCheck className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{error || 'No service report data available'}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Reports" value={data.totalReports} icon={FileCheck} color="text-sky-600" bg="bg-sky-100" />
        <MetricCard title="Delivered" value={data.deliveredCount} icon={CheckCircle2} color="text-emerald-600" bg="bg-emerald-100" />
        <MetricCard title="Pending" value={data.pendingCount} icon={Clock} color="text-amber-600" bg="bg-amber-100" />
        <MetricCard title="Failed" value={data.failedCount} icon={XCircle} color="text-red-600" bg="bg-red-100" />
      </div>

      {/* Reports Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck className="w-4 h-4" /> Service Reports
            </CardTitle>
            <div className="flex items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px] h-9 text-xs">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="DELIVERED">Delivered</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setGenDialogOpen(true)}>
                <FileText className="w-4 h-4 mr-1.5" /> Generate Report
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileCheck className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No reports found</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]" />
                    <TableHead>Date</TableHead>
                    <TableHead>Case</TableHead>
                    <TableHead className="hidden sm:table-cell">Agent</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="hidden md:table-cell">Duration</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => {
                    const isExpanded = expandedRow === report.id;
                    return (
                      <>
                        <TableRow key={report.id}>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7"
                              onClick={() => toggleExpand(report.id)}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </Button>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(report.createdAt)}
                          </TableCell>
                          <TableCell className="font-medium text-sm">{report.caseNumber}</TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">{report.agentName}</TableCell>
                          <TableCell><OutcomeBadge outcome={report.outcome} /></TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {formatDuration(report.duration)}
                          </TableCell>
                          <TableCell><DeliveryBadge status={report.deliveryStatus} /></TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {report.deliveryStatus === 'PENDING' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2"
                                  onClick={() => handleMarkDelivered(report.id)}
                                  disabled={actionLoading === report.id}
                                >
                                  <Send className="w-3 h-3 mr-1" />
                                  {actionLoading === report.id ? '...' : 'Deliver'}
                                </Button>
                              )}
                              {report.deliveryStatus === 'FAILED' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2"
                                  onClick={() => handleRetry(report.id)}
                                  disabled={actionLoading === report.id}
                                >
                                  <RefreshCw className={`w-3 h-3 mr-1 ${actionLoading === report.id ? 'animate-spin' : ''}`} />
                                  Retry
                                </Button>
                              )}
                              {report.deliveryStatus === 'DELIVERED' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2"
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  View
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {/* Expanded Detail Row */}
                        {isExpanded && (
                          <TableRow key={`${report.id}-detail`}>
                            <TableCell colSpan={8} className="bg-muted/30 px-6 py-4">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Report Content */}
                                <div className="lg:col-span-2 space-y-3">
                                  <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <FileText className="w-4 h-4" /> Report Content
                                  </h4>
                                  <p className="text-sm text-muted-foreground leading-relaxed">
                                    {report.reportContent || 'No report content available.'}
                                  </p>

                                  {/* Timeline */}
                                  {report.timeline && report.timeline.length > 0 && (
                                    <div className="mt-4">
                                      <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Timeline</h5>
                                      <div className="space-y-2">
                                        {report.timeline.map((event, idx) => (
                                          <div key={idx} className="flex items-center gap-3 text-sm">
                                            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                            <span className="text-muted-foreground text-xs whitespace-nowrap">{formatDateTime(event.time)}</span>
                                            <span>{event.label}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Sidebar */}
                                <div className="space-y-4">
                                  {/* GPS */}
                                  {report.gpsCoordinates && (
                                    <div className="bg-background border rounded-lg p-3">
                                      <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> GPS Location
                                      </h5>
                                      <p className="text-sm font-mono">
                                        {report.gpsCoordinates.lat.toFixed(6)}, {report.gpsCoordinates.lng.toFixed(6)}
                                      </p>
                                    </div>
                                  )}

                                  {/* Photos */}
                                  <div className="bg-background border rounded-lg p-3">
                                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                                      <ImageIcon className="w-3 h-3" /> Photo Evidence
                                    </h5>
                                    {report.photos && report.photos.length > 0 ? (
                                      <div className="grid grid-cols-3 gap-2">
                                        {report.photos.map((photo, idx) => (
                                          <div key={idx} className="aspect-square bg-muted rounded-md flex items-center justify-center">
                                            <ImageIcon className="w-5 h-5 text-muted-foreground" />
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">No photos attached</p>
                                    )}
                                  </div>

                                  {/* Delivery Actions */}
                                  <div className="border rounded-lg p-3 space-y-2">
                                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Delivery Actions</h5>
                                    {report.deliveryStatus === 'PENDING' && (
                                      <Button
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleMarkDelivered(report.id)}
                                        disabled={actionLoading === report.id}
                                      >
                                        <Send className="w-4 h-4 mr-2" />
                                        Mark as Delivered
                                      </Button>
                                    )}
                                    {report.deliveryStatus === 'FAILED' && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => handleRetry(report.id)}
                                        disabled={actionLoading === report.id}
                                      >
                                        <RefreshCw className={`w-4 h-4 mr-2 ${actionLoading === report.id ? 'animate-spin' : ''}`} />
                                        Retry Delivery
                                      </Button>
                                    )}
                                    {report.deliveryStatus === 'DELIVERED' && (
                                      <p className="text-xs text-emerald-600 font-medium">
                                        ✓ Delivered on {formatDateTime(report.deliveredAt || '')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Generate Dialog */}
      <GenerateReportDialog
        open={genDialogOpen}
        onClose={() => setGenDialogOpen(false)}
        onGenerate={handleGenerate}
        generating={generating}
      />
    </div>
  );
}

export default ServiceReportsPanel;
