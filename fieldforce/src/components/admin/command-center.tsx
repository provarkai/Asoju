'use client';

import { useState, useEffect } from 'react';
import {
  Briefcase,
  Users,
  DollarSign,
  AlertTriangle,
  Clock,
  MapPin,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { formatNaira } from '@/lib/constants';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import {
  CASE_STATUS_STYLES,
  MISSION_STATE_STYLES,
  formatRelativeTime,
  getStatusLabel,
  CHART_COLORS,
  type DashboardData,
  type RecentActivityItem,
  type SLAAtRiskCase,
} from './admin-types';

// ─── KPI Card ────────────────────────────────────────────────────────────

interface KPICardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  variant?: 'default' | 'warning' | 'danger';
}

function KPICard({ title, value, icon: Icon, description, trend, trendValue, variant }: KPICardProps) {
  const variantClass =
    variant === 'danger'
      ? 'border-red-200 bg-red-50/50'
      : variant === 'warning'
        ? 'border-amber-200 bg-amber-50/50'
        : '';

  return (
    <Card className={variantClass}>
      <CardContent className="p-3 sm:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {(trend || description) && (
              <div className="flex items-center gap-1 pt-1">
                {trend === 'up' && (
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                )}
                {trend === 'down' && (
                  <ArrowDownRight className="w-3.5 h-3.5 text-red-600" />
                )}
                {trendValue && (
                  <span
                    className={`text-xs font-medium ${
                      trend === 'up'
                        ? 'text-emerald-600'
                        : trend === 'down'
                          ? 'text-red-600'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {trendValue}
                  </span>
                )}
                {description && (
                  <span className="text-xs text-muted-foreground">{description}</span>
                )}
              </div>
            )}
          </div>
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              variant === 'danger'
                ? 'bg-red-100 text-red-600'
                : variant === 'warning'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Active Missions Table ─────────────────────────────────────────────────

interface ActiveMission {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  missionState: string;
  assignedAgentName: string | null;
  slaDeadline: string | null;
  customer: { name: string };
}

function ActiveMissionsTable({ missions }: { missions: ActiveMission[] }) {
  if (missions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Active Missions
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8">
          <p className="text-center text-sm text-muted-foreground">No active field missions</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Active Field Missions
          <Badge variant="secondary" className="ml-auto text-xs">
            {missions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[320px] overflow-auto">
          <div className="min-w-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Case #</TableHead>
                <TableHead className="text-xs">Title</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Agent</TableHead>
                <TableHead className="text-xs">State</TableHead>
                <TableHead className="text-xs text-right">SLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missions.map((m) => (
                <TableRow key={m.id} className="cursor-pointer hover:bg-accent/50">
                  <TableCell className="font-mono text-xs">{m.caseNumber}</TableCell>
                  <TableCell className="text-sm font-medium max-w-[200px] truncate">
                    {m.title}
                  </TableCell>
                  <TableCell className="text-sm">{m.customer.name}</TableCell>
                  <TableCell className="text-sm">{m.assignedAgentName || '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${MISSION_STATE_STYLES[m.missionState] || ''}`}
                    >
                      {getStatusLabel(m.missionState)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground">
                    {m.slaDeadline ? formatRelativeTime(m.slaDeadline) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Activity Feed ─────────────────────────────────────────────────────────

function getEventIcon(eventType: string) {
  const t = eventType.toLowerCase();
  if (t.includes('created') || t.includes('submitted')) return '🆕';
  if (t.includes('quote') || t.includes('payment')) return '💰';
  if (t.includes('assigned') || t.includes('accepted')) return '🚀';
  if (t.includes('completed')) return '✅';
  if (t.includes('escalat')) return '⚠️';
  if (t.includes('cancel') || t.includes('failed')) return '❌';
  return '📋';
}

function ActivityFeed({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8">
          <p className="text-center text-sm text-muted-foreground">No recent activity</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="w-4 h-4" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[360px]">
          <div className="px-6 pb-4 space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                <span className="text-lg shrink-0 mt-0.5">{getEventIcon(item.eventType)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{item.actorName || item.actorType}</span>
                    {' — '}
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.case?.caseNumber} · {formatRelativeTime(item.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ─── Loading Skeletons ────────────────────────────────────────────────────

function KPIsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-6">
            <Skeleton className="h-4 w-32 mb-4" />
            <Skeleton className="h-[240px] w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Command Center ────────────────────────────────────────────────────────

export function CommandCenter() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await authFetch('/api/admin/dashboard');
        if (!res.ok) throw new Error('Failed to fetch dashboard data');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchDashboard();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <KPIsSkeleton />
        <ChartsSkeleton />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <p className="text-muted-foreground">{error || 'No dashboard data available'}</p>
        </CardContent>
      </Card>
    );
  }

  const { kpis, casesByStatus, casesByServiceType, recentActivity, slaAtRiskCases } = data;

  // Prepare chart data
  const statusChartData = casesByStatus
    .map((s) => ({
      name: getStatusLabel(s.status),
      count: s.count,
    }))
    .sort((a, b) => b.count - a.count);

  const serviceChartData = casesByServiceType
    .map((s) => ({
      name: SERVICE_TYPE_LABELS[s.serviceCode] || s.serviceCode,
      count: s.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Active missions = SLA at-risk cases that also have missionState set (approximation)
  const activeMissions: ActiveMission[] = slaAtRiskCases.slice(0, 10) as ActiveMission[];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          title="Active Cases"
          value={kpis.activeCases}
          icon={Briefcase}
          description={`${kpis.openCases} open`}
          trend="up"
          trendValue="Live"
        />
        <KPICard
          title="Customers"
          value={kpis.totalCustomers}
          icon={Users}
          description="Active accounts"
        />
        <KPICard
          title="Revenue"
          value={formatNaira(kpis.totalRevenue)}
          icon={DollarSign}
          description={
            kpis.pendingPayments > 0
              ? `${formatNaira(kpis.pendingPayments)} pending`
              : 'Verified payments'
          }
        />
        <KPICard
          title="SLA At-Risk"
          value={slaAtRiskCases.length}
          icon={AlertTriangle}
          variant={slaAtRiskCases.length > 0 ? (slaAtRiskCases.length > 3 ? 'danger' : 'warning') : 'default'}
          description={slaAtRiskCases.length > 0 ? 'Deadline within 24h' : 'All clear'}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cases by Status — Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cases by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground">
                No cases data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={statusChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={100}
                    tick={{ fontSize: 11 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                    {statusChartData.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Cases by Service Type — Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cases by Service Type</CardTitle>
          </CardHeader>
          <CardContent>
            {serviceChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground">
                No service data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={serviceChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="count"
                    nameKey="name"
                    paddingAngle={2}
                    label={({ name, percent }) =>
                      `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {serviceChartData.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity + Active Missions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActivityFeed items={recentActivity} />
        <ActiveMissionsTable missions={activeMissions} />
      </div>
    </div>
  );
}

export default CommandCenter;
