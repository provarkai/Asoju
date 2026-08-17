'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Heart,
  CalendarCheck,
  CalendarX,
  Clock,
  PlayCircle,
  PauseCircle,
  XCircle,
  Plus,
  Calendar,
  User,
  RefreshCw,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { authFetch } from '@/lib/auth-fetch';
import { formatDate } from './admin-types';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────

type CarePlanStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

interface CarePlan {
  id: string;
  customerId: string;
  customerName: string;
  beneficiary: string;
  serviceType: string;
  frequency: string;
  preferredDay: string;
  preferredTime: string;
  totalVisits: number;
  completedVisits: number;
  nextVisitDate: string | null;
  status: CarePlanStatus;
  costPerVisit: number;
  specialInstructions: string;
  createdAt: string;
}

interface CarePlansDashboardData {
  plans: CarePlan[];
  activePlans: number;
  visitsToday: number;
  missedThisWeek: number;
  upcomingThisWeek: number;
}

// ─── Status Badge ───────────────────────────────────────────────────────

const STATUS_STYLES: Record<CarePlanStatus, { label: string; color: string; bgColor: string; borderColor: string; icon: React.ElementType }> = {
  ACTIVE: { label: 'Active', color: 'text-emerald-700', bgColor: 'bg-emerald-100', borderColor: 'border-emerald-200', icon: PlayCircle },
  PAUSED: { label: 'Paused', color: 'text-amber-700', bgColor: 'bg-amber-100', borderColor: 'border-amber-200', icon: PauseCircle },
  CANCELLED: { label: 'Cancelled', color: 'text-red-700', bgColor: 'bg-red-100', borderColor: 'border-red-200', icon: XCircle },
};

function StatusBadge({ status }: { status: CarePlanStatus }) {
  const config = STATUS_STYLES[status];
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

// ─── Create Care Plan Dialog ─────────────────────────────────────────────

interface CreatePlanForm {
  customerId: string;
  beneficiary: string;
  serviceType: string;
  frequency: string;
  preferredDay: string;
  preferredTime: string;
  costPerVisit: string;
  specialInstructions: string;
}

function CreateCarePlanDialog({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: CreatePlanForm) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<CreatePlanForm>({
    customerId: '',
    beneficiary: '',
    serviceType: '',
    frequency: 'WEEKLY',
    preferredDay: '',
    preferredTime: '',
    costPerVisit: '',
    specialInstructions: '',
  });

  const update = (key: keyof CreatePlanForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    if (!form.customerId.trim() || !form.beneficiary.trim() || !form.serviceType.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    onSubmit(form);
    setForm({
      customerId: '',
      beneficiary: '',
      serviceType: '',
      frequency: 'WEEKLY',
      preferredDay: '',
      preferredTime: '',
      costPerVisit: '',
      specialInstructions: '',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5" /> Create Care Plan
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer ID *</Label>
                <Input
                  placeholder="Customer ID"
                  value={form.customerId}
                  onChange={(e) => update('customerId', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Beneficiary *</Label>
                <Input
                  placeholder="Beneficiary name"
                  value={form.beneficiary}
                  onChange={(e) => update('beneficiary', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Service Type *</Label>
              <Input
                placeholder="e.g., Home Nursing, Physiotherapy"
                value={form.serviceType}
                onChange={(e) => update('serviceType', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => update('frequency', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="BI_WEEKLY">Bi-Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cost per Visit (₦)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={form.costPerVisit}
                  onChange={(e) => update('costPerVisit', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preferred Day</Label>
                <Select value={form.preferredDay} onValueChange={(v) => update('preferredDay', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONDAY">Monday</SelectItem>
                    <SelectItem value="TUESDAY">Tuesday</SelectItem>
                    <SelectItem value="WEDNESDAY">Wednesday</SelectItem>
                    <SelectItem value="THURSDAY">Thursday</SelectItem>
                    <SelectItem value="FRIDAY">Friday</SelectItem>
                    <SelectItem value="SATURDAY">Saturday</SelectItem>
                    <SelectItem value="SUNDAY">Sunday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Preferred Time</Label>
                <Input
                  type="time"
                  value={form.preferredTime}
                  onChange={(e) => update('preferredTime', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Special Instructions</Label>
              <Textarea
                placeholder="Any special instructions or notes..."
                value={form.specialInstructions}
                onChange={(e) => update('specialInstructions', e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            <Plus className="w-4 h-4 mr-2" />
            {submitting ? 'Creating...' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export function CarePlansPanel() {
  const [data, setData] = useState<CarePlansDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await authFetch('/api/admin/care-plans');
      if (!res.ok) throw new Error('Failed to fetch care plans');
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

  const filteredPlans = useMemo(() => {
    if (!data) return [];
    if (statusFilter === 'all') return data.plans;
    return data.plans.filter((p) => p.status === statusFilter);
  }, [data, statusFilter]);

  const handlePause = async (planId: string) => {
    setActionLoading(planId);
    try {
      const res = await authFetch(`/api/admin/care-plans/${planId}/pause`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to pause plan');
      toast.success('Care plan paused');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (planId: string) => {
    setActionLoading(planId);
    try {
      const res = await authFetch(`/api/admin/care-plans/${planId}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to cancel plan');
      toast.success('Care plan cancelled');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreate = async (form: CreatePlanForm) => {
    setCreating(true);
    try {
      const res = await authFetch('/api/admin/care-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to create care plan');
      toast.success('Care plan created successfully');
      setCreateDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateVisits = async (planId: string) => {
    setActionLoading(planId);
    try {
      const res = await authFetch(`/api/admin/care-plans/${planId}/generate-visits`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate visits');
      toast.success('Visits generated successfully');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setActionLoading(null);
    }
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
          <Heart className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{error || 'No care plan data available'}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const getProgressPercent = (completed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Active Plans" value={data.activePlans} icon={Heart} color="text-rose-600" bg="bg-rose-100" />
        <MetricCard title="Total Visits Today" value={data.visitsToday} icon={CalendarCheck} color="text-emerald-600" bg="bg-emerald-100" />
        <MetricCard title="Missed This Week" value={data.missedThisWeek} icon={CalendarX} color="text-red-600" bg="bg-red-100" />
        <MetricCard title="Upcoming This Week" value={data.upcomingThisWeek} icon={Calendar} color="text-sky-600" bg="bg-sky-100" />
      </div>

      {/* Plans Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="w-4 h-4" /> Care Plans
            </CardTitle>
            <div className="flex items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="PAUSED">Paused</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Create Plan
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredPlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Heart className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No care plans found</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Beneficiary</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>Next Visit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPlans.map((plan) => {
                        const progressPct = getProgressPercent(plan.completedVisits, plan.totalVisits);
                        return (
                          <TableRow key={plan.id}>
                            <TableCell className="font-medium text-sm">{plan.customerName}</TableCell>
                            <TableCell className="text-sm">{plan.beneficiary}</TableCell>
                            <TableCell className="text-sm">{plan.serviceType}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[11px]">
                                {plan.frequency}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 min-w-[120px]">
                                <Progress value={progressPct} className="h-2 flex-1" />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {plan.completedVisits}/{plan.totalVisits}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(plan.nextVisitDate)}
                            </TableCell>
                            <TableCell><StatusBadge status={plan.status} /></TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {plan.status === 'ACTIVE' && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs px-2"
                                      onClick={() => handlePause(plan.id)}
                                      disabled={actionLoading === plan.id}
                                    >
                                      <PauseCircle className="w-3 h-3 mr-1" />
                                      {actionLoading === plan.id ? '...' : 'Pause'}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs px-2"
                                      onClick={() => handleGenerateVisits(plan.id)}
                                      disabled={actionLoading === plan.id}
                                    >
                                      <Calendar className="w-3 h-3 mr-1" />
                                      Visits
                                    </Button>
                                  </>
                                )}
                                {plan.status === 'PAUSED' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs px-2"
                                    onClick={() => handleCancel(plan.id)}
                                    disabled={actionLoading === plan.id}
                                  >
                                    <XCircle className="w-3 h-3 mr-1" />
                                    {actionLoading === plan.id ? '...' : 'Cancel'}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden p-4 space-y-3">
                {filteredPlans.map((plan) => {
                  const progressPct = getProgressPercent(plan.completedVisits, plan.totalVisits);
                  return (
                    <div key={plan.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{plan.customerName}</p>
                          <p className="text-xs text-muted-foreground">Beneficiary: {plan.beneficiary}</p>
                        </div>
                        <StatusBadge status={plan.status} />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px]">{plan.serviceType}</Badge>
                        <span>•</span>
                        <span>{plan.frequency}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={progressPct} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground">{plan.completedVisits}/{plan.totalVisits}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Next: {formatDate(plan.nextVisitDate)}
                        </span>
                        <div className="flex gap-1">
                          {plan.status === 'ACTIVE' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs px-2"
                                onClick={() => handlePause(plan.id)}
                                disabled={actionLoading === plan.id}
                              >
                                <PauseCircle className="w-3 h-3 mr-1" /> Pause
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs px-2"
                                onClick={() => handleGenerateVisits(plan.id)}
                                disabled={actionLoading === plan.id}
                              >
                                <Calendar className="w-3 h-3 mr-1" /> Visits
                              </Button>
                            </>
                          )}
                          {plan.status === 'PAUSED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2 text-red-600"
                              onClick={() => handleCancel(plan.id)}
                              disabled={actionLoading === plan.id}
                            >
                              <XCircle className="w-3 h-3 mr-1" /> Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreateCarePlanDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreate}
        submitting={creating}
      />
    </div>
  );
}

export default CarePlansPanel;
