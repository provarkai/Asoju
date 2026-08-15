'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ScrollText,
  Search,
  ChevronLeft,
  ChevronRight,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { authFetch } from '@/lib/auth-fetch';
import { formatDateTime, formatRelativeTime } from './admin-types';

// ─── Types ──────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: string | null;
  correlationId: string | null;
  createdAt: string;
  adminUser: {
    id: string;
    displayName: string;
    email: string;
    role: string;
  } | null;
}

const ACTION_OPTIONS = [
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'CASE_UPDATED',
  'QUOTE_GENERATED',
  'QUOTE_ACCEPTED',
  'PAYMENT_RECEIVED',
  'MISSION_ASSIGNED',
  'TIMELINE_EVENT_ADDED',
  'ADMIN_LOGIN',
  'ADMIN_LOGOUT',
];

const ENTITY_OPTIONS = [
  'Customer',
  'Case',
  'Quote',
  'Payment',
  'Mission',
  'AdminUser',
  'TimelineEvent',
];

// ─── Audit Log ──────────────────────────────────────────────────────────

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const limit = 50;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        action: actionFilter,
        entityType: entityFilter,
      });
      const res = await authFetch(`/api/admin/audit?${params}`);
      if (!res.ok) throw new Error('Failed to fetch audit log');
      const json = await res.json();
      setEvents(json.events);
      setTotal(json.pagination.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const totalPages = Math.ceil(total / limit);

  const resetPage = () => setPage(1);

  const getActionBadgeStyle = (action: string): string => {
    const a = action.toLowerCase();
    if (a.includes('created')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (a.includes('updated') || a.includes('accepted')) return 'bg-sky-100 text-sky-800 border-sky-200';
    if (a.includes('login') || a.includes('logout')) return 'bg-slate-100 text-slate-700 border-slate-200';
    if (a.includes('payment')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (a.includes('assign')) return 'bg-violet-100 text-violet-800 border-violet-200';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={actionFilter || 'ALL'} onValueChange={(v) => { setActionFilter(v === 'ALL' ? '' : v); resetPage(); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Actions</SelectItem>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={entityFilter || 'ALL'} onValueChange={(v) => { setEntityFilter(v === 'ALL' ? '' : v); resetPage(); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Entities</SelectItem>
            {ENTITY_OPTIONS.map((e) => (
              <SelectItem key={e} value={e}>{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">
          {total} event{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center">
              <ScrollText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No audit events found</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-[160px]">Timestamp</TableHead>
                    <TableHead className="text-xs">Actor</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Entity</TableHead>
                    <TableHead className="text-xs">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id} className="hover:bg-accent/30">
                      <TableCell className="text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{formatDateTime(e.createdAt)}</span>
                          <span className="text-muted-foreground">{formatRelativeTime(e.createdAt)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {e.adminUser?.displayName || e.actorType}
                          </span>
                          {e.adminUser?.email && (
                            <span className="text-[11px] text-muted-foreground">
                              {e.adminUser.email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] whitespace-nowrap ${getActionBadgeStyle(e.action)}`}
                        >
                          {e.action.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span>{e.entityType}</span>
                          <span className="font-mono text-muted-foreground text-[10px]">
                            {e.entityId.slice(0, 12)}...
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                        {e.metadata ? (
                          <span className="font-mono text-[10px] block truncate" title={e.metadata}>
                            {e.metadata.length > 80
                              ? e.metadata.slice(0, 80) + '...'
                              : e.metadata}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
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

export default AuditLog;
