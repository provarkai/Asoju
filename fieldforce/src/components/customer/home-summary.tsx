'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Briefcase,
  FileText,
  Wallet,
  CheckCircle2,
  Plus,
  ArrowRight,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { useCustomerContext, getStatusBadge, formatDate, formatRelativeTime } from './customer-shell';
import { formatNaira, formatNairaShort } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';

interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  statusLabel: string;
  serviceCode: string;
  priority: string;
  priorityLabel: string;
  paymentStatus: string;
  paymentStatusLabel: string;
  missionState: string;
  createdAt: string;
}

export default function HomeSummary() {
  const { profile, setActiveView, openCaseDetail } = useCustomerContext();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [billingSummary, setBillingSummary] = useState<{ totalPaid: number; totalPending: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const firstName = profile?.member?.displayName?.split(' ')[0] || 'there';

  useEffect(() => {
    async function load() {
      try {
        const [casesRes, billingRes] = await Promise.all([
          authFetch('/api/customer/cases?limit=5'),
          authFetch('/api/customer/billing'),
        ]);
        if (casesRes.ok) {
          const casesData = await casesRes.json();
          setCases(casesData.data || []);
        }
        if (billingRes.ok) {
          const billingData = await billingRes.json();
          setBillingSummary({
            totalPaid: billingData.summary?.totalPaid || 0,
            totalPending: billingData.summary?.totalPending || 0,
          });
        }
      } catch (err) {
        console.error('Failed to load home data:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const activeCases = cases.filter((c) => ['IN_PROGRESS', 'UNDER_REVIEW', 'ACCEPTED', 'PAYMENT_PENDING', 'QUOTED'].includes(c.status)).length;
  const completedCases = cases.filter((c) => c.status === 'COMPLETED').length;

  const kpiCards = [
    {
      title: 'Active Cases',
      value: activeCases,
      icon: Briefcase,
      iconBg: 'bg-sky-100 text-sky-700',
      subtitle: 'Currently in progress',
    },
    {
      title: 'Service Requests',
      value: profile?.stats?.totalRequests || 0,
      icon: FileText,
      iconBg: 'bg-amber-100 text-amber-700',
      subtitle: 'Total submitted',
    },
    {
      title: 'Total Spent',
      value: formatNairaShort(billingSummary?.totalPaid || 0),
      icon: Wallet,
      iconBg: 'bg-emerald-100 text-emerald-700',
      subtitle: `Paid ${formatNaira(billingSummary?.totalPaid || 0)}`,
    },
    {
      title: 'Completed',
      value: completedCases,
      icon: CheckCircle2,
      iconBg: 'bg-green-100 text-green-700',
      subtitle: 'Successfully delivered',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 p-4 sm:p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">
              Welcome back, {firstName}!
            </h2>
            <p className="text-emerald-100 mt-1 text-sm sm:text-base">
              Here&apos;s a quick overview of your field service activities.
            </p>
          </div>
          <Button
            onClick={() => setActiveView('new-request')}
            className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold shadow-sm self-start sm:self-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Request
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="py-4">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-3" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {kpiCards.map((kpi) => (
            <Card key={kpi.title} className="py-4 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">{kpi.title}</span>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${kpi.iconBg}`}>
                    <kpi.icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-2xl font-bold tracking-tight">{kpi.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{kpi.subtitle}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recent Cases */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Recent Cases</h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-emerald-700 hover:text-emerald-800"
            onClick={() => setActiveView('cases')}
          >
            View all
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="py-4">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : cases.length === 0 ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center gap-3 p-6">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                <Briefcase className="h-6 w-6 text-gray-400" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-700">No cases yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create a service request to get started.
                </p>
              </div>
              <Button
                onClick={() => setActiveView('new-request')}
                className="mt-2 bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Request
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {cases.slice(0, 5).map((c) => {
              const statusBadge = getStatusBadge(c.status);
              return (
                <Card
                  key={c.id}
                  className="py-4 cursor-pointer hover:shadow-md hover:border-emerald-200 transition-all"
                  onClick={() => openCaseDetail(c.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                        <Briefcase className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate text-sm sm:text-base">{c.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {c.caseNumber} &middot; {SERVICE_TYPE_LABELS[c.serviceCode] || c.serviceCode}
                            </p>
                          </div>
                          <Badge variant="outline" className={`shrink-0 text-[10px] sm:text-xs ${statusBadge.className}`}>
                            {statusBadge.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          {c.missionState && c.status === 'IN_PROGRESS' && (
                            <span className="flex items-center gap-1 text-xs text-sky-700">
                              <Clock className="h-3 w-3" />
                              {c.missionState}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(c.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
