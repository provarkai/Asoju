'use client';

import { useState, useEffect } from 'react';
import {
  Mail,
  Phone,
  MapPin,
  Users,
  Briefcase,
  DollarSign,
  CalendarDays,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { formatNaira } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import {
  CASE_STATUS_STYLES,
  PRIORITY_STYLES,
  formatDate,
  getStatusLabel,
} from './admin-types';

// ─── Types ──────────────────────────────────────────────────────────────

interface CustomerDetailData {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  type: string;
  status: string;
  primaryContact: string | null;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  members: Member[];
  cases: CaseItem[];
  payments: PaymentItem[];
  summary: {
    totalPayments: number;
    totalPaymentCount: number;
    verifiedTotal: number;
    verifiedCount: number;
    pendingTotal: number;
    pendingCount: number;
    casesByStatus: { status: string; count: number }[];
  };
}

interface Member {
  id: string;
  email: string;
  displayName: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface CaseItem {
  id: string;
  caseNumber: string;
  title: string;
  serviceCode: string;
  status: string;
  priority: string;
  paymentStatus: string;
  quoteAmount: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface PaymentItem {
  id: string;
  amount: number;
  method: string;
  status: string;
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
  case: { caseNumber: string; title: string };
}

const TYPE_STYLES: Record<string, string> = {
  INDIVIDUAL: 'bg-sky-100 text-sky-800 border-sky-200',
  CORPORATE: 'bg-violet-100 text-violet-800 border-violet-200',
  GOVERNMENT: 'bg-amber-100 text-amber-800 border-amber-200',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  INACTIVE: 'bg-slate-100 text-slate-700 border-slate-200',
  SUSPENDED: 'bg-red-100 text-red-800 border-red-200',
};

// ─── Customer Detail Component ────────────────────────────────────────────

export function CustomerDetail({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      try {
        const res = await authFetch(`/api/admin/customers/${customerId}`);
        if (!res.ok) throw new Error('Failed to fetch customer');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchDetail();
  }, [customerId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <p className="text-muted-foreground">{error || 'Customer not found'}</p>
        </CardContent>
      </Card>
    );
  }

  const activeCases = data.summary.casesByStatus
    ?.filter((s) => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(s.status))
    .reduce((acc, s) => acc + s.count, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Customer Header */}
      <div>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xl font-bold text-primary">
              {data.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-semibold">{data.name}</h2>
              <Badge
                variant="outline"
                className={`text-[10px] ${TYPE_STYLES[data.type] || ''}`}
              >
                {data.type}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] ${STATUS_STYLES[data.status] || ''}`}
              >
                {data.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap text-sm text-muted-foreground">
              {data.email && (
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> {data.email}
                </span>
              )}
              {data.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {data.phone}
                </span>
              )}
              {(data.city || data.state) && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> {[data.city, data.state, data.country].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              Created {formatDate(data.createdAt)}
              {data.primaryContact && (
                <>
                  <Separator orientation="vertical" className="h-3" />
                  Primary Contact: {data.primaryContact}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.cases.length}</p>
              <p className="text-xs text-muted-foreground">Total Cases</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeCases}</p>
              <p className="text-xs text-muted-foreground">Active Cases</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatNaira(data.summary.verifiedTotal)}</p>
              <p className="text-xs text-muted-foreground">Verified Spend</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.members.length}</p>
              <p className="text-xs text-muted-foreground">Team Members</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cases Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> Cases
            <Badge variant="secondary" className="ml-auto text-xs">{data.cases.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.cases.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No cases for this customer
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Case #</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Service</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Priority</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cases.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.caseNumber}</TableCell>
                      <TableCell className="text-sm font-medium">{c.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {SERVICE_TYPE_LABELS[c.serviceCode] || c.serviceCode}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${CASE_STATUS_STYLES[c.status] || ''}`}
                        >
                          {getStatusLabel(c.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${PRIORITY_STYLES[c.priority] || ''}`}
                        >
                          {c.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        {c.quoteAmount ? formatNaira(c.quoteAmount) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" /> Team Members
            <Badge variant="secondary" className="ml-auto text-xs">{data.members.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.members.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No team members
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs">Role</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Last Login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm font-medium">{m.displayName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                      <TableCell className="text-xs">{m.role}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${m.isActive ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                        >
                          {m.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {m.lastLoginAt ? formatDate(m.lastLoginAt) : 'Never'}
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

export default CustomerDetail;
