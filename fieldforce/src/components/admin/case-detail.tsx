'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  MapPin,
  User,
  DollarSign,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Info,
  FileText,
  Camera,
  Loader2,
  ShieldCheck,
  RotateCcw,
  XCircle,
  Send,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatNaira } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import {
  CASE_STATUS_STYLES,
  PRIORITY_STYLES,
  PAYMENT_STATUS_STYLES,
  MISSION_STATE_STYLES,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  getStatusLabel,
} from './admin-types';

// ─── Types ──────────────────────────────────────────────────────────────

interface CaseDetailData {
  id: string;
  caseNumber: string;
  title: string;
  description: string | null;
  serviceCode: string;
  status: string;
  priority: string;
  paymentStatus: string;
  paymentMethod: string | null;
  missionState: string | null;
  assignedAgentName: string | null;
  assignedAgentId: string | null;
  quoteAmount: number | null;
  agentPayout: number | null;
  asojuFee: number | null;
  slaDeadline: string | null;
  slaStartedAt: string | null;
  slaCompletedAt: string | null;
  assignedAt: string | null;
  executingSince: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  state: string | null;
  lga: string | null;
  address: string | null;
  beneficiaryName: string | null;
  beneficiaryPhone: string | null;
  qcStatus: string | null;
  cancelReason: string | null;
  specialInstructions: string | null;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    type: string;
  };
  serviceRequest: {
    id: string;
    description: string;
    urgency: string;
    specialInstructions: string;
    attachments: string | null;
    member: { displayName: string; email: string } | null;
  } | null;
  timeline: TimelineEvent[];
  quotes: QuoteItem[];
  payments: PaymentItem[];
  messages: MessageItem[];
}

interface TimelineEvent {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  actorType: string;
  actorName: string | null;
  isCustomerVisible: boolean;
  createdAt: string;
}

interface QuoteItem {
  id: string;
  amount: number;
  agentPayout: number | null;
  asojuFee: number | null;
  breakdown: string | null;
  status: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

interface PaymentItem {
  id: string;
  amount: number;
  method: string;
  status: string;
  reference: string | null;
  paidAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface MessageItem {
  id: string;
  senderType: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// ─── Timeline Event Icon ─────────────────────────────────────────────────

function getTimelineIcon(eventType: string) {
  const t = eventType.toLowerCase();
  if (t.includes('created') || t.includes('submitted')) return { icon: FileText, color: 'text-sky-600', bg: 'bg-sky-100' };
  if (t.includes('quote')) return { icon: DollarSign, color: 'text-amber-600', bg: 'bg-amber-100' };
  if (t.includes('payment')) return { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' };
  if (t.includes('assign') || t.includes('accepted')) return { icon: User, color: 'text-violet-600', bg: 'bg-violet-100' };
  if (t.includes('completed')) return { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-100' };
  if (t.includes('escalat') || t.includes('risk')) return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100' };
  if (t.includes('cancel') || t.includes('failed')) return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100' };
  if (t.includes('review') || t.includes('qc')) return { icon: Info, color: 'text-orange-600', bg: 'bg-orange-100' };
  if (t.includes('evidence') || t.includes('photo')) return { icon: Camera, color: 'text-rose-600', bg: 'bg-rose-100' };
  if (t.includes('en_route') || t.includes('route') || t.includes('on_site')) return { icon: MapPin, color: 'text-emerald-600', bg: 'bg-emerald-100' };
  return { icon: Info, color: 'text-slate-600', bg: 'bg-slate-100' };
}

// ─── Overview Tab ────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: CaseDetailData }) {
  return (
    <div className="space-y-6">
      {/* Details Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <DetailItem label="Service" value={SERVICE_TYPE_LABELS[data.serviceCode] || data.serviceCode} />
        <DetailItem label="Location" value={[data.state, data.lga, data.address].filter(Boolean).join(', ') || '—'} />
        <DetailItem label="SLA Deadline" value={data.slaDeadline ? formatDateTime(data.slaDeadline) : '—'} />
        <DetailItem label="Beneficiary" value={data.beneficiaryName || '—'} />
        <DetailItem label="Beneficiary Phone" value={data.beneficiaryPhone || '—'} />
        <DetailItem label="Payment Method" value={data.paymentMethod || '—'} />
        <DetailItem label="QC Status" value={data.qcStatus || '—'} />
        <DetailItem label="Created" value={formatDateTime(data.createdAt)} />
        <DetailItem label="Last Updated" value={formatDateTime(data.updatedAt)} />
      </div>

      {/* Special Instructions */}
      {data.specialInstructions && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Special Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{data.specialInstructions}</p>
          </CardContent>
        </Card>
      )}

      {/* Service Request Info */}
      {data.serviceRequest && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" /> Original Service Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{data.serviceRequest.description || 'No description'}</p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Urgency: {data.serviceRequest.urgency || 'N/A'}</span>
              {data.serviceRequest.member && (
                <span>Requested by: {data.serviceRequest.member.displayName}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel Reason */}
      {data.cancelReason && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Cancel Reason
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{data.cancelReason}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

// ─── Timeline Tab ───────────────────────────────────────────────────────

function TimelineTab({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="py-12 text-center">
        <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No timeline events</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[600px]">
      <div className="relative pl-8">
        {/* Vertical line */}
        <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-4">
          {events.map((event, idx) => {
            const { icon: Icon, color, bg } = getTimelineIcon(event.eventType);
            return (
              <div key={event.id || idx} className="relative flex items-start gap-3 pb-2">
                {/* Dot */}
                <div
                  className={`absolute left-[-23px] w-6 h-6 rounded-full ${bg} flex items-center justify-center`}
                >
                  <Icon className={`w-3 h-3 ${color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{event.title}</p>
                    {!event.isCustomerVisible && (
                      <Badge variant="outline" className="text-[9px]">Internal</Badge>
                    )}
                  </div>
                  {event.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                    <span>{event.actorType}{event.actorName ? ` · ${event.actorName}` : ''}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(event.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}

// ─── Commercial Tab ──────────────────────────────────────────────────────

function CommercialTab({ quotes, payments }: { quotes: QuoteItem[]; payments: PaymentItem[] }) {
  const totalPaid = payments
    .filter((p) => p.status === 'VERIFIED')
    .reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      {/* Quote Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Quote Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quotes generated</p>
          ) : (
            <div className="space-y-4">
              {quotes.map((q) => (
                <div key={q.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className={`text-xs ${q.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : q.status === 'REJECTED' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                    >
                      {q.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(q.createdAt)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <DetailItem label="Quote Amount" value={formatNaira(q.amount)} />
                    <DetailItem label="Agent Payout" value={q.agentPayout ? formatNaira(q.agentPayout) : '—'} />
                    <DetailItem label="ASOJU Fee" value={q.asojuFee ? formatNaira(q.asojuFee) : '—'} />
                  </div>
                  {q.breakdown && (
                    <div className="pt-2 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Breakdown</p>
                      <p className="text-sm whitespace-pre-wrap">{q.breakdown}</p>
                    </div>
                  )}
                  {q.expiresAt && (
                    <p className="text-xs text-muted-foreground">Expires: {formatDateTime(q.expiresAt)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Payment History
            <Badge variant="secondary" className="ml-auto text-xs">
              {formatNaira(totalPaid)} verified
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No payments recorded</div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Method</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">{formatDate(p.paidAt || p.createdAt)}</TableCell>
                      <TableCell className="text-xs">{p.method || '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{formatNaira(p.amount)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${PAYMENT_STATUS_STYLES[p.status] || ''}`}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {p.reference || '—'}
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

// ─── Execution Tab ───────────────────────────────────────────────────────

function ExecutionTab({ data }: { data: CaseDetailData }) {
  return (
    <div className="space-y-6">
      {/* Field Execution Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Field Execution Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailItem
              label="Assigned Agent"
              value={data.assignedAgentName || 'Not assigned'}
            />
            <DetailItem
              label="Mission State"
              value={
                data.missionState ? (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${MISSION_STATE_STYLES[data.missionState] || ''}`}
                  >
                    {getStatusLabel(data.missionState)}
                  </Badge>
                ) as unknown as string : 'Not started'
              }
            />
            <DetailItem
              label="Check-in Status"
              value={data.executingSince ? `On site since ${formatRelativeTime(data.executingSince)}` : 'Not checked in'}
            />
            <DetailItem
              label="Assigned At"
              value={data.assignedAt ? formatDateTime(data.assignedAt) : '—'}
            />
            <DetailItem
              label="Executing Since"
              value={data.executingSince ? formatDateTime(data.executingSince) : '—'}
            />
            <DetailItem
              label="Submitted At"
              value={data.submittedAt ? formatDateTime(data.submittedAt) : '—'}
            />
          </div>
        </CardContent>
      </Card>

      {/* GPS / Location */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Location & GPS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <DetailItem label="State" value={data.state || '—'} />
            <DetailItem label="LGA" value={data.lga || '—'} />
            <DetailItem label="Address" value={data.address || '—'} className="col-span-2" />
          </div>
        </CardContent>
      </Card>

      {/* Evidence Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="w-4 h-4" /> Evidence Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {data.status === 'COMPLETED'
              ? 'Evidence has been captured and submitted for this case.'
              : 'No evidence submitted yet.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Messages Tab ────────────────────────────────────────────────────────

function MessagesTab({ messages }: { messages: MessageItem[] }) {
  if (messages.length === 0) {
    return (
      <div className="py-12 text-center">
        <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No messages for this case</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[500px]">
      <div className="space-y-4 px-1">
        {messages.map((msg, idx) => {
          const isCustomer = msg.senderType === 'CUSTOMER' || msg.senderType === 'MEMBER';
          return (
            <div
              key={msg.id || idx}
              className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-4 py-2.5 ${
                  isCustomer
                    ? 'bg-muted'
                    : 'bg-primary text-primary-foreground'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-medium ${isCustomer ? 'text-muted-foreground' : 'text-primary-foreground/70'}`}>
                    {isCustomer ? 'Customer' : 'Support'}
                  </span>
                  <span className={`text-[10px] ${isCustomer ? 'text-muted-foreground/60' : 'text-primary-foreground/50'}`}>
                    {formatRelativeTime(msg.createdAt)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{msg.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ─── QC Review Tab (P0.7) ───────────────────────────────────────────────

interface QcReviewData {
  id: string;
  cycleNumber: number;
  reviewerName: string | null;
  state: string;
  rejectionReason: string | null;
  reworkInstructions: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface CompletionGate {
  qcApproved: boolean;
  evidenceValid: boolean;
  gpsCheckinValid: boolean;
  requiredFieldsComplete: boolean;
  financialReady: boolean;
}

interface QcData {
  reviews: QcReviewData[];
  currentReview: QcReviewData | null;
  completionGate: CompletionGate;
  gateResult: { passed: boolean; failedGates: string[] };
  validActions: string[];
}

const REJECTION_REASONS = [
  { id: 'missing_evidence', label: 'Missing Evidence' },
  { id: 'insufficient_evidence', label: 'Insufficient Evidence' },
  { id: 'gps_anomaly', label: 'GPS Check-in Anomaly' },
  { id: 'incorrect_data', label: 'Incorrect Data Fields' },
  { id: 'incomplete_checklist', label: 'Incomplete Checklist' },
  { id: 'photo_quality', label: 'Poor Photo Quality' },
  { id: 'wrong_location', label: 'Wrong Location' },
  { id: 'safety_concern', label: 'Safety Concern' },
];

const QC_STATE_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_REVIEW: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
};

function QcReviewTab({ caseId }: { caseId: string }) {
  const [qcData, setQcData] = useState<QcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState('');
  const [reworkInstructions, setReworkInstructions] = useState('');

  const fetchQcData = useCallback(async () => {
    try {
      const res = await authFetch(`/api/admin/cases/${caseId}/qc`);
      if (!res.ok) throw new Error('Failed to fetch QC data');
      const json = await res.json();
      setQcData(json);
    } catch {
      // Silently fail — QC might not be available yet
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchQcData();
  }, [fetchQcData]);

  const handleQcAction = async (action: string, reason?: string, instructions?: string) => {
    setActionLoading(true);
    try {
      const res = await authFetch(`/api/admin/cases/${caseId}/qc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason,
          reworkInstructions: instructions,
          rejectionReasonId: selectedReason || undefined,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.message || `QC action failed: ${json.error}`);
        return;
      }

      toast.success(json.message || `QC ${action} completed`);
      setDialogOpen(false);
      setSelectedReason('');
      setReworkInstructions('');
      fetchQcData();
    } catch {
      toast.error('Failed to perform QC action');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!qcData || !qcData.currentReview) {
    return (
      <div className="py-12 text-center">
        <ShieldCheck className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          No QC review initiated. Case must be submitted by the agent first.
        </p>
      </div>
    );
  }

  const { currentReview, reviews, completionGate, gateResult, validActions } = qcData;

  return (
    <div className="space-y-6">
      {/* QC Status Header */}
      <Card className={currentReview.state === 'APPROVED' ? 'border-green-200' : currentReview.state === 'REJECTED' ? 'border-red-200' : 'border-orange-200'}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                currentReview.state === 'APPROVED' ? 'bg-green-100' :
                currentReview.state === 'REJECTED' ? 'bg-red-100' : 'bg-orange-100'
              }`}>
                {currentReview.state === 'APPROVED' ? <CheckCircle2 className="w-5 h-5 text-green-600" /> :
                 currentReview.state === 'REJECTED' ? <XCircle className="w-5 h-5 text-red-600" /> :
                 <ShieldCheck className="w-5 h-5 text-orange-600" />}
              </div>
              <div>
                <p className="text-sm font-semibold">
                  QC Review — Cycle #{currentReview.cycleNumber}
                </p>
                <p className="text-xs text-muted-foreground">
                  {currentReview.state === 'PENDING' ? 'Awaiting review' :
                   currentReview.state === 'IN_REVIEW' ? 'Under review' :
                   currentReview.state === 'APPROVED' ? 'Approved — ready for completion' :
                   'Rejected — action required'}
                </p>
              </div>
            </div>
            <Badge variant="outline" className={`text-xs ${QC_STATE_STYLES[currentReview.state] || ''}`}>
              {currentReview.state.replace('_', ' ')}
            </Badge>
          </div>

          {/* QC Actions */}
          {validActions.length > 0 && (
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              {validActions.includes('START_REVIEW') && (
                <Button size="sm" onClick={() => handleQcAction('START_REVIEW')}>
                  <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Start Review
                </Button>
              )}
              {validActions.includes('APPROVE') && (
                <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700"
                  onClick={() => { if (confirm('Approve this submission? This will mark the mission as completed.')) handleQcAction('APPROVE'); }}>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve
                </Button>
              )}
              {validActions.includes('REQUEST_REWORK') && (
                <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => { setDialogAction('REQUEST_REWORK'); setDialogOpen(true); }}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Request Rework
                </Button>
              )}
              {validActions.includes('REJECT') && (
                <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => { setDialogAction('REJECT'); setDialogOpen(true); }}>
                  <XCircle className="w-3.5 h-3.5 mr-1.5" /> Hard Reject
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completion Gate Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Completion Gate Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { key: 'qcApproved', label: 'QC Approved', passed: completionGate.qcApproved },
              { key: 'evidenceValid', label: 'Evidence Valid', passed: completionGate.evidenceValid },
              { key: 'gpsCheckinValid', label: 'GPS Check-in Valid', passed: completionGate.gpsCheckinValid },
              { key: 'requiredFieldsComplete', label: 'Checklist Complete', passed: completionGate.requiredFieldsComplete },
              { key: 'financialReady', label: 'Financial Ready', passed: completionGate.financialReady },
            ].map((gate) => (
              <div key={gate.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                gate.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}>
                {gate.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span className={`text-xs font-medium ${gate.passed ? 'text-green-700' : 'text-red-700'}`}>
                  {gate.label}
                </span>
              </div>
            ))}
          </div>
          {gateResult.failedGates.length > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              Failed gates: {gateResult.failedGates.join(', ')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* QC Review History */}
      {reviews.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">QC Review History ({reviews.length} cycle{reviews.length > 1 ? 's' : ''})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Cycle</TableHead>
                    <TableHead className="text-xs">State</TableHead>
                    <TableHead className="text-xs">Reviewer</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs">Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-medium">#{r.cycleNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${QC_STATE_STYLES[r.state] || ''}`}>
                          {r.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.reviewerName || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {r.rejectionReason || r.reworkInstructions || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.completedAt ? formatRelativeTime(r.completedAt) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Rework / Reject Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogAction === 'REQUEST_REWORK' ? (
                <><RotateCcw className="w-5 h-5 text-amber-600" /> Request Rework</>
              ) : (
                <><XCircle className="w-5 h-5 text-red-600" /> Reject Submission</>
              )}
            </DialogTitle>
            <DialogDescription>
              {dialogAction === 'REQUEST_REWORK'
                ? 'Send the mission back to the agent with actionable rework instructions. The agent will be able to resubmit.'
                : 'Permanently reject this submission. The mission will be marked as failed.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {dialogAction === 'REQUEST_REWORK' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Rejection Reason Category</Label>
                <Select value={selectedReason} onValueChange={setSelectedReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a reason..." />
                  </SelectTrigger>
                  <SelectContent>
                    {REJECTION_REASONS.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {dialogAction === 'REQUEST_REWORK' ? 'Rework Instructions (for agent)' : 'Rejection Reason'}
              </Label>
              <Textarea
                value={reworkInstructions}
                onChange={(e) => setReworkInstructions(e.target.value)}
                placeholder={
                  dialogAction === 'REQUEST_REWORK'
                    ? 'Describe what the agent needs to fix...'
                    : 'Explain why this submission is being rejected...'
                }
                className="min-h-[100px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              variant={dialogAction === 'REQUEST_REWORK' ? 'default' : 'destructive'}
              className={dialogAction === 'REQUEST_REWORK' ? 'bg-amber-600 hover:bg-amber-700' : ''}
              onClick={() => handleQcAction(dialogAction, reworkInstructions, reworkInstructions)}
              disabled={actionLoading || !reworkInstructions.trim()}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              {dialogAction === 'REQUEST_REWORK' ? 'Send Rework Request' : 'Reject Submission'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Case Detail Component ────────────────────────────────────────────────

export function CaseDetail({ caseId }: { caseId: string }) {
  const [data, setData] = useState<CaseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      try {
        const res = await authFetch(`/api/admin/cases/${caseId}`);
        if (!res.ok) throw new Error('Failed to fetch case');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchDetail();
  }, [caseId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <p className="text-muted-foreground">{error || 'Case not found'}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Case Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-semibold">{data.title}</h2>
          <Badge
            variant="outline"
            className={`text-xs ${CASE_STATUS_STYLES[data.status] || ''}`}
          >
            {getStatusLabel(data.status)}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs ${PRIORITY_STYLES[data.priority] || ''}`}
          >
            {data.priority}
          </Badge>
        </div>
        <div className="flex items-center gap-4 mt-2 flex-wrap text-sm text-muted-foreground">
          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{data.caseNumber}</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" /> {data.customer.name}
          </span>
          <span className="flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> {data.quoteAmount ? formatNaira(data.quoteAmount) : 'Not quoted'}
          </span>
          {data.slaDeadline && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> SLA: {formatDate(data.slaDeadline)}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start h-10">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
          <TabsTrigger value="commercial" className="text-xs">Commercial</TabsTrigger>
          <TabsTrigger value="execution" className="text-xs">Execution</TabsTrigger>
          <TabsTrigger value="qc" className="text-xs">QC Review</TabsTrigger>
          <TabsTrigger value="messages" className="text-xs">Messages</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelineTab events={data.timeline} />
        </TabsContent>

        <TabsContent value="commercial" className="mt-4">
          <CommercialTab quotes={data.quotes} payments={data.payments} />
        </TabsContent>

        <TabsContent value="execution" className="mt-4">
          <ExecutionTab data={data} />
        </TabsContent>

        <TabsContent value="qc" className="mt-4">
          <QcReviewTab caseId={caseId} />
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <MessagesTab messages={data.messages} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CaseDetail;
