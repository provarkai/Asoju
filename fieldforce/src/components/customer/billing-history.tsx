'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Wallet,
  CreditCard,
  Clock,
  CheckCircle2,
  Inbox,
  Receipt,
  ArrowUpRight,
} from 'lucide-react';
import { useCustomerContext, getStatusBadge, formatDate, formatDateTime } from './customer-shell';
import { formatNaira } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';

interface BillingSummary {
  totalPaid: number;
  totalPending: number;
  totalTransactions: number;
}

interface PaymentRecord {
  id: string;
  amount: number;
  method: string | null;
  status: string;
  statusLabel: string;
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
  case: {
    id: string;
    caseNumber: string;
    title: string;
    serviceCode: string;
  } | null;
}

export default function BillingHistory() {
  const { openCaseDetail } = useCustomerContext();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await authFetch('/api/customer/billing');
        if (res.ok) {
          const data = await res.json();
          setSummary(data.summary);
          setPayments(data.data || []);
        }
      } catch (err) {
        console.error('Failed to load billing:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const totalSpent = (summary?.totalPaid || 0) + (summary?.totalPending || 0);

  const summaryCards = [
    {
      title: 'Total Spent',
      value: formatNaira(totalSpent),
      icon: Wallet,
      iconBg: 'bg-emerald-100 text-emerald-700',
      subtitle: `${formatNaira(summary?.totalPaid || 0)} paid`,
    },
    {
      title: 'Total Paid',
      value: formatNaira(summary?.totalPaid || 0),
      icon: CheckCircle2,
      iconBg: 'bg-green-100 text-green-700',
      subtitle: `${summary?.totalTransactions || 0} transactions`,
    },
    {
      title: 'Pending Payments',
      value: formatNaira(summary?.totalPending || 0),
      icon: Clock,
      iconBg: 'bg-amber-100 text-amber-700',
      subtitle: summary?.totalPending ? 'Awaiting confirmation' : 'All settled',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Billing &amp; Payments</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track your payment history and outstanding balances.
        </p>
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="py-4">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-8 w-28 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {summaryCards.map((card) => (
            <Card key={card.title} className="py-4 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">{card.title}</span>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${card.iconBg}`}>
                    <card.icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-xl sm:text-2xl font-bold tracking-tight">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Payment History */}
      <Card className="py-5">
        <CardHeader className="pb-0 px-4 sm:px-6">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Payment History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <Inbox className="h-7 w-7 text-gray-400" />
              </div>
              <p className="font-medium text-gray-700">No payments yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your payment history will appear here once you make your first payment.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Desktop Table Header */}
              <div className="hidden sm:grid sm:grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="col-span-3">Date</div>
                <div className="col-span-3">Case</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-2 text-center">Method</div>
                <div className="col-span-2 text-right">Status</div>
              </div>

              {payments.map((p) => {
                const pBadge = getStatusBadge(p.status);
                return (
                  <div
                    key={p.id}
                    className={`flex flex-col sm:grid sm:grid-cols-12 gap-1 sm:gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors ${
                      p.case?.id ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (p.case?.id) openCaseDetail(p.case.id);
                    }}
                  >
                    {/* Date */}
                    <div className="col-span-3 text-xs sm:text-sm text-gray-700">
                      <div className="sm:hidden text-[10px] text-muted-foreground font-medium mb-0.5">Date</div>
                      {formatDate(p.paidAt || p.createdAt)}
                    </div>

                    {/* Case */}
                    <div className="col-span-3 text-xs sm:text-sm text-gray-700">
                      <div className="sm:hidden text-[10px] text-muted-foreground font-medium mb-0.5">Case</div>
                      {p.case ? (
                        <span className="flex items-center gap-1 font-medium">
                          {p.case.caseNumber}
                          <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                        </span>
                      ) : (
                        '—'
                      )}
                    </div>

                    {/* Amount */}
                    <div className="col-span-2 text-sm font-semibold text-gray-900 sm:text-right">
                      <div className="sm:hidden text-[10px] text-muted-foreground font-medium mb-0.5">Amount</div>
                      {formatNaira(p.amount)}
                    </div>

                    {/* Method */}
                    <div className="col-span-2 text-xs sm:text-sm text-muted-foreground sm:text-center">
                      <div className="sm:hidden text-[10px] text-muted-foreground font-medium mb-0.5">Method</div>
                      {p.method || 'N/A'}
                    </div>

                    {/* Status */}
                    <div className="col-span-2 flex justify-start sm:justify-end">
                      <div className="sm:hidden text-[10px] text-muted-foreground font-medium mb-0.5 self-start">Status</div>
                      <Badge variant="outline" className={`text-[10px] sm:text-xs ${pBadge.className}`}>
                        {pBadge.label}
                      </Badge>
                    </div>

                    {/* Reference (mobile only) */}
                    {p.reference && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Ref: {p.reference}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
