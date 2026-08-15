'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Filter,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { formatNaira } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import {
  CASE_STATUS_STYLES,
  PRIORITY_STYLES,
  PAYMENT_STATUS_STYLES,
  formatDate,
  getStatusLabel,
} from './admin-types';
import { CaseDetail } from './case-detail';

// ─── Types ──────────────────────────────────────────────────────────────

interface CaseItem {
  id: string;
  caseNumber: string;
  title: string;
  serviceCode: string;
  serviceLabel: string;
  status: string;
  priority: string;
  quoteAmount: number | null;
  paymentStatus: string;
  missionState: string | null;
  assignedAgentName: string | null;
  slaDeadline: string | null;
  createdAt: string;
  completedAt: string | null;
  customer: { id: string; name: string; type: string };
}

const STATUS_OPTIONS = [
  'OPEN', 'QUOTED', 'PAYMENT_PENDING', 'ACCEPTED', 'IN_PROGRESS',
  'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'FAILED',
];

const PRIORITY_OPTIONS = ['NORMAL', 'URGENT', 'CRITICAL', 'HIGH'];

const PAYMENT_OPTIONS = ['PENDING', 'VERIFIED', 'FAILED', 'REFUNDED'];

// ─── Case List ───────────────────────────────────────────────────────────

export function CaseList() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const limit = 20;

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
        status: statusFilter,
        priority: priorityFilter,
        serviceCode: serviceFilter,
        paymentStatus: paymentFilter,
      });
      const res = await authFetch(`/api/admin/cases?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setCases(json.cases);
      setTotal(json.pagination.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, priorityFilter, serviceFilter, paymentFilter]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const totalPages = Math.ceil(total / limit);

  const resetPage = () => setPage(1);

  if (selectedId) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 mb-4"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft className="w-4 h-4" /> Back to Cases
        </Button>
        <CaseDetail caseId={selectedId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search case #, title, customer..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter || 'ALL'} onValueChange={(v) => { setStatusFilter(v === 'ALL' ? '' : v); resetPage(); }}>
          <SelectTrigger className="w-[150px]">
            <Filter className="w-3.5 h-3.5 mr-1" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{getStatusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter || 'ALL'} onValueChange={(v) => { setPriorityFilter(v === 'ALL' ? '' : v); resetPage(); }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Priority</SelectItem>
            {PRIORITY_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={serviceFilter || 'ALL'} onValueChange={(v) => { setServiceFilter(v === 'ALL' ? '' : v); resetPage(); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Service" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Services</SelectItem>
            {Object.entries(SERVICE_TYPE_LABELS).map(([code, label]) => (
              <SelectItem key={code} value={code}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentFilter || 'ALL'} onValueChange={(v) => { setPaymentFilter(v === 'ALL' ? '' : v); resetPage(); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Payment</SelectItem>
            {PAYMENT_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : cases.length === 0 ? (
            <div className="py-16 text-center">
              <Briefcase className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No cases found</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Case #</TableHead>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Service</TableHead>
                    <TableHead className="text-xs">Priority</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Payment</TableHead>
                    <TableHead className="text-xs text-right">SLA</TableHead>
                    <TableHead className="text-xs text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => setSelectedId(c.id)}
                    >
                      <TableCell className="font-mono text-xs font-medium">{c.caseNumber}</TableCell>
                      <TableCell className="text-sm">{c.customer.name}</TableCell>
                      <TableCell className="text-sm font-medium max-w-[180px] truncate">
                        {c.title}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.serviceLabel || SERVICE_TYPE_LABELS[c.serviceCode] || c.serviceCode}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${PRIORITY_STYLES[c.priority] || ''}`}
                        >
                          {c.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${CASE_STATUS_STYLES[c.status] || ''}`}
                        >
                          {getStatusLabel(c.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          {c.quoteAmount && (
                            <span className="text-xs font-medium">{formatNaira(c.quoteAmount)}</span>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[9px] ${PAYMENT_STATUS_STYLES[c.paymentStatus] || ''}`}
                          >
                            {c.paymentStatus || 'N/A'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {c.slaDeadline ? formatDate(c.slaDeadline) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} case{total !== 1 ? 's' : ''} · Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CaseList;
