'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileText,
  Plus,
  MapPin,
  Calendar,
  Inbox,
  AlertCircle,
} from 'lucide-react';
import { useCustomerContext, getStatusBadge, formatDate, formatRelativeTime } from './customer-shell';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';

interface ServiceRequest {
  id: string;
  serviceCode: string;
  title: string;
  description: string | null;
  locationAddress: string | null;
  locationLga: string | null;
  locationState: string | null;
  priority: string;
  urgency: string;
  status: string;
  createdAt: string;
  case?: {
    id: string;
    caseNumber: string;
    status: string;
  } | null;
}

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'QUOTED', label: 'Quoted' },
  { value: 'ACCEPTED', label: 'Accepted' },
];

export default function RequestList() {
  const { setActiveView, openCaseDetail } = useCustomerContext();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchRequests = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.set('status', status);
      const res = await authFetch(`/api/customer/requests?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.data || []);
        setTotal(data.pagination?.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests(activeTab === 'all' ? undefined : activeTab);
  }, [activeTab, fetchRequests]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Service Requests</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total} total request{total !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          onClick={() => setActiveView('new-request')}
          className="bg-emerald-600 hover:bg-emerald-700 font-semibold self-start"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Service Request
        </Button>
      </div>

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs sm:text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Request Cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="py-4">
              <CardContent className="p-4">
                <Skeleton className="h-5 w-48 mb-3" />
                <div className="flex gap-2 mb-3">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="flex gap-4">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card className="py-16">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-6">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <Inbox className="h-7 w-7 text-gray-400" />
            </div>
            <div className="text-center">
              <p className="font-medium text-gray-700">No requests found</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {activeTab === 'all'
                  ? "You haven't created any service requests yet. Start by submitting a new request."
                  : `No ${activeTab.toLowerCase()} requests to show.`}
              </p>
            </div>
            {activeTab === 'all' && (
              <Button
                onClick={() => setActiveView('new-request')}
                className="mt-2 bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Request
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const statusBadge = getStatusBadge(req.status);
            const urgencyBadge = getStatusBadge(req.urgency || req.priority);
            return (
              <Card
                key={req.id}
                className={`py-4 transition-all ${
                  req.case?.id
                    ? 'cursor-pointer hover:shadow-md hover:border-emerald-200'
                    : ''
                }`}
                onClick={() => {
                  if (req.case?.id) openCaseDetail(req.case.id);
                }}
              >
                <CardContent className="p-4">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm">{req.title}</p>
                        {req.case && (
                          <p className="text-[11px] text-emerald-600 font-medium">
                            Case {req.case.caseNumber}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[10px] sm:text-xs ${statusBadge.className}`}>
                      {statusBadge.label}
                    </Badge>
                  </div>

                  {/* Badges row */}
                  <div className="flex flex-wrap gap-1.5 mb-3 ml-11">
                    <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600">
                      {SERVICE_TYPE_LABELS[req.serviceCode] || req.serviceCode}
                    </Badge>
                    {(req.priority === 'URGENT' || req.urgency === 'URGENT') && (
                      <Badge variant="outline" className={`text-[10px] ${urgencyBadge.className}`}>
                        <AlertCircle className="h-3 w-3 mr-0.5" />
                        Urgent
                      </Badge>
                    )}
                  </div>

                  {/* Details row */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 ml-11 text-xs text-muted-foreground">
                    {req.locationAddress && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {req.locationState ? `${req.locationState}` : req.locationAddress}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatRelativeTime(req.createdAt)}
                    </span>
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
