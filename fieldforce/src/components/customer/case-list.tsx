'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Briefcase,
  Clock,
  MapPin,
  Wallet,
  ChevronRight,
  Inbox,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import { useCustomerContext, getStatusBadge, formatDate, formatRelativeTime } from './customer-shell';
import { formatNaira } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';

interface CaseItem {
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
  assignedAgentName: string | null;
  approvedQuoteAmount: number | null;
  slaDeadline: string | null;
  createdAt: string;
  completedAt: string | null;
}

const CASE_TABS = [
  { value: 'all', label: 'All' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'COMPLETED', label: 'Completed' },
];

export default function CaseList() {
  const { openCaseDetail } = useCustomerContext();
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchCases = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.set('status', status);
      const res = await authFetch(`/api/customer/cases?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCases(data.data || []);
        setTotal(data.pagination?.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch cases:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCases(activeTab === 'all' ? undefined : activeTab);
  }, [activeTab, fetchCases]);

  const getMissionIcon = (status: string) => {
    if (status === 'Not Started') return null;
    if (status.includes('En Route') || status.includes('On Site')) return Clock;
    if (status.includes('Progress') || status.includes('Work')) return UserCheck;
    if (status.includes('Review') || status.includes('Submitted')) return AlertTriangle;
    return Clock;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Cases</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total} case{total !== 1 ? 's' : ''} tracked
        </p>
      </div>

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          {CASE_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs sm:text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Case Cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="py-4">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-52" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : cases.length === 0 ? (
        <Card className="py-16">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-6">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <Inbox className="h-7 w-7 text-gray-400" />
            </div>
            <div className="text-center">
              <p className="font-medium text-gray-700">No cases found</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {activeTab === 'all'
                  ? "No cases have been created yet. Submit a service request to get started."
                  : `No ${activeTab.replace('_', ' ').toLowerCase()} cases to show.`}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const statusBadge = getStatusBadge(c.status);
            const paymentBadge = getStatusBadge(c.paymentStatus);
            const MissionIcon = getMissionIcon(c.missionState);

            return (
              <Card
                key={c.id}
                className="py-4 cursor-pointer hover:shadow-md hover:border-emerald-200 transition-all"
                onClick={() => openCaseDetail(c.id)}
              >
                <CardContent className="p-4">
                  {/* Top row */}
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
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mt-3 ml-13">
                    <Badge variant="outline" className={`text-[10px] sm:text-xs ${statusBadge.className}`}>
                      {statusBadge.label}
                    </Badge>
                    {c.priority === 'URGENT' && (
                      <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                        Urgent
                      </Badge>
                    )}
                    <Badge variant="outline" className={`text-[10px] ${paymentBadge.className}`}>
                      <Wallet className="h-3 w-3 mr-0.5" />
                      {paymentBadge.label}
                    </Badge>
                  </div>

                  {/* Mission State + Details */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3 ml-13">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {/* Execution progress */}
                      {c.status === 'IN_PROGRESS' && c.missionState && c.missionState !== 'Not Started' && (
                        <span className="flex items-center gap-1 text-sky-700 font-medium">
                          {MissionIcon && <MissionIcon className="h-3.5 w-3.5" />}
                          {c.missionState}
                        </span>
                      )}
                      {c.assignedAgentName && c.status === 'IN_PROGRESS' && (
                        <span className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3" />
                          {c.assignedAgentName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(c.createdAt)}
                      </span>
                    </div>
                    {/* Quote amount */}
                    {c.approvedQuoteAmount != null && c.approvedQuoteAmount > 0 && (
                      <span className="text-sm font-semibold text-gray-800">
                        {formatNaira(c.approvedQuoteAmount)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
