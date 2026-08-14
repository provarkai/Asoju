'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Briefcase,
  MapPin,
  Clock,
  Wallet,
  CheckCircle2,
  Loader2,
  Send,
  ArrowLeft,
  AlertCircle,
  Eye,
  Star,
  FileCheck,
  CreditCard,
  MessageSquare,
  History,
  Info,
  Phone,
  UserCheck,
  User,
  Building2,
  Camera,
  ClipboardCheck,
  ShieldCheck,
  PackageCheck,
  Zap,
} from 'lucide-react';
import { useCustomerContext, getStatusBadge, formatDate, formatDateTime, formatRelativeTime } from './customer-shell';
import { formatNaira } from '@/lib/constants';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import { authFetch } from '@/lib/auth-fetch';

// ─── Types ──────────────────────────────────────────────────────────────

interface CaseDetail {
  id: string;
  caseNumber: string;
  title: string;
  description: string | null;
  serviceCode: string;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  paymentStatus: string;
  paymentStatusLabel: string;
  missionState: string;
  assignedAgentName: string | null;
  address: string | null;
  lga: string | null;
  state: string | null;
  beneficiaryName: string | null;
  beneficiaryPhone: string | null;
  slaDeadline: string | null;
  completedAt: string | null;
  createdAt: string;
  approvedQuote: {
    id: string;
    amount: number;
    breakdown: unknown;
    acceptedAt: string | null;
  } | null;
  pendingQuote: {
    id: string;
    amount: number;
    asojuFee: number | null;
    breakdown: unknown;
    validityDays: number | null;
    expiresAt: string | null;
    createdAt: string;
  } | null;
  paymentSummary: {
    totalPaid: number;
    approvedAmount: number | null;
    paymentStatus: string;
    paymentStatusLabel: string;
  };
  payments: PaymentItem[];
  timeline: TimelineEvent[];
}

interface TimelineEvent {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  actorType: string | null;
  actorName: string | null;
  createdAt: string;
}

interface PaymentItem {
  id: string;
  amount: number;
  method: string | null;
  status: string;
  statusLabel: string;
  paidAt: string | null;
  createdAt: string;
}

interface MessageItem {
  id: string;
  senderType: string;
  senderName: string;
  message: string;
  attachmentUrl: string | null;
  read: boolean;
  createdAt: string;
}

// ─── Timeline Icon Helper ────────────────────────────────────────────────

function getTimelineIcon(eventType: string): { icon: React.ElementType; color: string } {
  const map: Record<string, { icon: React.ElementType; color: string }> = {
    CASE_CREATED: { icon: Briefcase, color: 'bg-emerald-100 text-emerald-700' },
    QUOTE_SENT: { icon: FileCheck, color: 'bg-amber-100 text-amber-700' },
    QUOTE_ACCEPTED: { icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-700' },
    PAYMENT_RECEIVED: { icon: CreditCard, color: 'bg-emerald-100 text-emerald-700' },
    AGENT_ASSIGNED: { icon: UserCheck, color: 'bg-sky-100 text-sky-700' },
    EN_ROUTE: { icon: MapPin, color: 'bg-amber-100 text-amber-700' },
    ON_SITE: { icon: Building2, color: 'bg-emerald-100 text-emerald-700' },
    EXECUTING: { icon: Star, color: 'bg-sky-100 text-sky-700' },
    REPORT_SUBMITTED: { icon: Camera, color: 'bg-slate-100 text-slate-700' },
    QC_STARTED: { icon: ClipboardCheck, color: 'bg-orange-100 text-orange-700' },
    QC_APPROVED: { icon: ShieldCheck, color: 'bg-emerald-100 text-emerald-700' },
    QC_REJECTED: { icon: AlertCircle, color: 'bg-red-100 text-red-700' },
    CASE_COMPLETED: { icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
    STATUS_CHANGED: { icon: Zap, color: 'bg-violet-100 text-violet-700' },
    NOTE_ADDED: { icon: Info, color: 'bg-slate-100 text-slate-600' },
    PAYMENT_INITIATED: { icon: Wallet, color: 'bg-amber-100 text-amber-700' },
    MESSAGE_SENT: { icon: MessageSquare, color: 'bg-slate-100 text-slate-600' },
  };
  return map[eventType] || { icon: Info, color: 'bg-gray-100 text-gray-600' };
}

// ─── Status Guidance ────────────────────────────────────────────────────

function getStatusGuidance(status: string): { message: string; className: string } {
  const map: Record<string, { message: string; className: string }> = {
    QUOTED: {
      message: 'Review the quote below and accept to proceed.',
      className: 'bg-amber-50 border-amber-200 text-amber-800',
    },
    PAYMENT_PENDING: {
      message: 'Complete payment to activate execution.',
      className: 'bg-orange-50 border-orange-200 text-orange-800',
    },
    IN_PROGRESS: {
      message: 'Your agent is working on this. Track progress below.',
      className: 'bg-sky-50 border-sky-200 text-sky-800',
    },
    UNDER_REVIEW: {
      message: 'Work has been submitted and is under quality review.',
      className: 'bg-orange-50 border-orange-200 text-orange-700',
    },
    COMPLETED: {
      message: 'This case has been completed successfully!',
      className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    },
    CANCELLED: {
      message: 'This case has been cancelled.',
      className: 'bg-red-50 border-red-200 text-red-700',
    },
  };
  return (
    map[status] || {
      message: 'Your case is being processed.',
      className: 'bg-slate-50 border-slate-200 text-slate-700',
    }
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export default function CaseDetail() {
  const { selectedCaseId, setActiveView } = useCustomerContext();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [activeTab, setActiveTab] = useState('timeline');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch case detail
  useEffect(() => {
    if (!selectedCaseId) return;
    async function load() {
      setLoading(true);
      try {
        const [caseRes, msgRes] = await Promise.all([
          authFetch(`/api/customer/cases/${selectedCaseId}`),
          authFetch(`/api/customer/cases/${selectedCaseId}/messages`),
        ]);
        if (caseRes.ok) {
          const data = await caseRes.json();
          setCaseData(data);
          // Auto-switch to quote tab if there's a pending quote
          if (data.pendingQuote) setActiveTab('quote');
        }
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          setMessages(msgData.data || []);
        }
      } catch (err) {
        console.error('Failed to load case:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedCaseId]);

  // Scroll messages to bottom
  useEffect(() => {
    if (activeTab === 'messages' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const acceptQuote = async () => {
    if (!caseData?.pendingQuote || !selectedCaseId) return;
    setAccepting(true);
    try {
      const res = await authFetch(`/api/customer/cases/${selectedCaseId}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: caseData.pendingQuote.id, action: 'accept' }),
      });
      if (res.ok) {
        // Reload case data
        const caseRes = await authFetch(`/api/customer/cases/${selectedCaseId}`);
        if (caseRes.ok) {
          const data = await caseRes.json();
          setCaseData(data);
        }
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to accept quote');
      }
    } catch (err) {
      console.error('Failed to accept quote:', err);
    } finally {
      setAccepting(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedCaseId) return;
    setSendingMessage(true);
    try {
      const res = await authFetch(`/api/customer/cases/${selectedCaseId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.data]);
        setNewMessage('');
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSendingMessage(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="text-center py-16">
        <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Case not found</p>
        <Button variant="outline" className="mt-3" onClick={() => setActiveView('cases')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Cases
        </Button>
      </div>
    );
  }

  const statusBadge = getStatusBadge(caseData.status);
  const guidance = getStatusGuidance(caseData.status);
  const hasBreakdown = caseData.pendingQuote?.breakdown && typeof caseData.pendingQuote.breakdown === 'object';
  const quoteBreakdown = hasBreakdown ? caseData.pendingQuote.breakdown as Record<string, string | number> : null;

  return (
    <div className="space-y-4">
      {/* Back button */}
      <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setActiveView('cases')}>
        <ArrowLeft className="h-4 w-4" />
        Back to Cases
      </Button>

      {/* Case Header */}
      <Card className="py-4">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">{caseData.title}</h2>
                <Badge variant="outline" className={`text-xs ${statusBadge.className}`}>
                  {statusBadge.label}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                <span className="font-medium">{caseData.caseNumber}</span>
                <span>&middot;</span>
                <span>{SERVICE_TYPE_LABELS[caseData.serviceCode] || caseData.serviceCode}</span>
                <span>&middot;</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDate(caseData.createdAt)}
                </span>
              </div>
            </div>
            {/* Location info */}
            {caseData.address && (
              <div className="text-sm text-muted-foreground flex items-start gap-1.5 shrink-0">
                <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{[caseData.address, caseData.lga, caseData.state].filter(Boolean).join(', ')}</span>
              </div>
            )}
          </div>

          {/* Status Guidance Banner */}
          {guidance.message && (
            <div className={`mt-4 p-3 rounded-lg border text-sm flex items-start gap-2 ${guidance.className}`}>
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="font-medium">{guidance.message}</span>
            </div>
          )}

          {/* Quick Info Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t">
            {caseData.assignedAgentName && (
              <div>
                <p className="text-xs text-muted-foreground">Assigned Agent</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{caseData.assignedAgentName}</p>
              </div>
            )}
            {caseData.missionState && caseData.missionState !== 'Not Started' && (
              <div>
                <p className="text-xs text-muted-foreground">Current Progress</p>
                <p className="text-sm font-medium text-sky-700 mt-0.5">{caseData.missionState}</p>
              </div>
            )}
            {caseData.beneficiaryName && (
              <div>
                <p className="text-xs text-muted-foreground">Contact Person</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{caseData.beneficiaryName}</p>
              </div>
            )}
            {caseData.beneficiaryPhone && (
              <div>
                <p className="text-xs text-muted-foreground">Contact Phone</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{caseData.beneficiaryPhone}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="timeline" className="gap-1.5 flex-1 sm:flex-none">
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Timeline</span>
            <span className="sm:hidden">Updates</span>
          </TabsTrigger>
          <TabsTrigger value="quote" className="gap-1.5 flex-1 sm:flex-none">
            <FileCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quote &amp; Payment</span>
            <span className="sm:hidden">Quote</span>
          </TabsTrigger>
          <TabsTrigger value="messages" className="gap-1.5 flex-1 sm:flex-none">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Messages</span>
            <span className="sm:hidden">Chat</span>
          </TabsTrigger>
        </TabsList>

        {/* ─── Timeline Tab ─────────────────────────────────────────── */}
        <TabsContent value="timeline">
          <Card className="py-5">
            <CardHeader className="pb-0 px-4 sm:px-6">
              <CardTitle className="text-base">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-4">
              {caseData.timeline.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No activity yet. We&apos;ll update you as things progress.
                </div>
              ) : (
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[17px] top-2 bottom-2 w-0.5 bg-gray-200" />

                  <div className="space-y-6">
                    {caseData.timeline.map((event, idx) => {
                      const { icon: EventIcon, color } = getTimelineIcon(event.eventType);
                      const isLast = idx === caseData.timeline.length - 1;
                      return (
                        <div key={event.id} className="flex gap-4 relative">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 z-10 ring-2 ring-white ${color}`}>
                            <EventIcon className="h-4 w-4" />
                          </div>
                          <div className={`flex-1 pb-2 ${isLast ? '' : ''}`}>
                            <p className="text-sm font-medium text-gray-900">{event.title}</p>
                            {event.description && (
                              <p className="text-sm text-muted-foreground mt-0.5">{event.description}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDateTime(event.createdAt)}
                              {event.actorName && (
                                <span className="ml-2">&middot; by {event.actorName}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Quote & Payment Tab ──────────────────────────────────── */}
        <TabsContent value="quote">
          <div className="space-y-4">
            {/* Pending Quote */}
            {caseData.pendingQuote && (
              <Card className="py-5 border-amber-200 bg-amber-50/30">
                <CardHeader className="pb-0 px-4 sm:px-6">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-amber-600" />
                    Quote Awaiting Your Review
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 sm:p-6 pt-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {formatNaira(caseData.pendingQuote.amount)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={acceptQuote}
                        disabled={accepting}
                        className="bg-emerald-600 hover:bg-emerald-700 font-semibold"
                      >
                        {accepting ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                        )}
                        Accept Quote
                      </Button>
                    </div>
                  </div>

                  {quoteBreakdown && (
                    <div className="mt-3 pt-3 border-t border-amber-200">
                      <p className="text-sm font-medium text-gray-700 mb-2">Breakdown</p>
                      <div className="space-y-1.5">
                        {Object.entries(quoteBreakdown).map(([key, val]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                            <span className="font-medium">
                              {typeof val === 'number' ? formatNaira(val) : String(val)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Created: {formatDateTime(caseData.pendingQuote.createdAt)}</span>
                    {caseData.pendingQuote.expiresAt && (
                      <span>Expires: {formatDateTime(caseData.pendingQuote.expiresAt)}</span>
                    )}
                    {caseData.pendingQuote.validityDays && (
                      <span>Valid for {caseData.pendingQuote.validityDays} days</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Accepted Quote */}
            {caseData.approvedQuote && (
              <Card className="py-5">
                <CardHeader className="pb-0 px-4 sm:px-6">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Accepted Quote
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 sm:p-6 pt-4">
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNaira(caseData.approvedQuote.amount)}
                  </p>
                  {caseData.approvedQuote.acceptedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Accepted on {formatDateTime(caseData.approvedQuote.acceptedAt)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Payment Summary */}
            <Card className="py-5">
              <CardHeader className="pb-0 px-4 sm:px-6">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Payment Status
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 pt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Approved Amount</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {formatNaira(caseData.paymentSummary.approvedAmount || 0)}
                    </p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Total Paid</p>
                    <p className="text-lg font-bold text-emerald-700 mt-0.5">
                      {formatNaira(caseData.paymentSummary.totalPaid)}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 col-span-2 sm:col-span-1">
                    <p className="text-xs text-muted-foreground">Payment Status</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1">
                      {caseData.paymentSummary.paymentStatusLabel}
                    </p>
                  </div>
                </div>

                {/* Payment History */}
                {caseData.payments.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm font-medium text-gray-700 mb-2">Payment History</p>
                    <div className="space-y-2">
                      {caseData.payments.map((p) => {
                        const pBadge = getStatusBadge(p.status);
                        return (
                          <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50">
                            <div>
                              <p className="text-sm font-medium">{formatNaira(p.amount)}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.method || 'N/A'} &middot; {p.paidAt ? formatDate(p.paidAt) : 'Pending'}
                              </p>
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${pBadge.className}`}>
                              {pBadge.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Messages Tab ─────────────────────────────────────────── */}
        <TabsContent value="messages">
          <Card className="py-0 overflow-hidden">
            {/* Messages area */}
            <div className="h-[400px] sm:h-[500px] flex flex-col">
              <div className="px-4 sm:px-6 py-3 border-b bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Case Messages
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Chat with our support team about this case
                </p>
              </div>

              <ScrollArea className="flex-1 px-4 sm:px-6 py-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-8">
                    <MessageSquare className="h-8 w-8 text-gray-300" />
                    <p className="text-sm text-muted-foreground">No messages yet</p>
                    <p className="text-xs text-muted-foreground">Send a message to start the conversation</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => {
                      const isCustomer = msg.senderType === 'CUSTOMER';
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[80%] sm:max-w-[70%] ${isCustomer ? 'order-1' : ''}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                {isCustomer ? 'You' : msg.senderName}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatRelativeTime(msg.createdAt)}
                              </span>
                            </div>
                            <div
                              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                isCustomer
                                  ? 'bg-emerald-600 text-white rounded-br-md'
                                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
                              }`}
                            >
                              {msg.message}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Message Input */}
              <div className="border-t p-3 sm:p-4 bg-gray-50/50">
                <div className="flex gap-2">
                  <Textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                    rows={1}
                    className="flex-1 min-h-[40px] resize-none text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!newMessage.trim() || sendingMessage}
                    size="icon"
                    className="h-10 w-10 shrink-0 bg-emerald-600 hover:bg-emerald-700"
                  >
                    {sendingMessage ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
