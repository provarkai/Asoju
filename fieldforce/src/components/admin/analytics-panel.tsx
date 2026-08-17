'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle2,
  DollarSign,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  AreaChart,
  Area,
} from 'recharts';
import { formatNaira } from '@/lib/constants';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import { authFetch } from '@/lib/auth-fetch';
import {
  getStatusLabel,
  CHART_COLORS,
} from './admin-types';

// ─── Types ──────────────────────────────────────────────────────────────

interface AnalyticsData {
  casesByStatus: { status: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  casesByServiceType: { serviceCode: string; count: number }[];
  completionRateTrend: {
    month: string;
    total: number;
    completed: number;
    rate: number;
  }[];
  slaPerformance: {
    avgDurationHours: number;
    onTimeRate: number;
    totalCompleted: number;
    breachedCount: number;
  };
}

// ─── Metric Card ─────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'text-primary',
  bg = 'bg-muted',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
  bg?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{title}</p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Analytics Panel ──────────────────────────────────────────────────────

export function AnalyticsPanel() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const res = await authFetch('/api/admin/analytics');
        if (!res.ok) throw new Error('Failed to fetch analytics');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <p className="text-muted-foreground">{error || 'No analytics data'}</p>
        </CardContent>
      </Card>
    );
  }

  const { casesByStatus, revenueByMonth, casesByServiceType, completionRateTrend, slaPerformance } = data;

  // Completion rate = latest month
  const latestCompletion = completionRateTrend[completionRateTrend.length - 1];
  const completionRate = latestCompletion?.rate || 0;

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

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Completion Rate"
          value={`${completionRate}%`}
          subtitle={`of ${latestCompletion?.total || 0} cases`}
          icon={CheckCircle2}
          color="text-emerald-600"
          bg="bg-emerald-100"
        />
        <MetricCard
          title="SLA On-Time Rate"
          value={`${slaPerformance.onTimeRate}%`}
          subtitle={`${slaPerformance.breachedCount} breach${slaPerformance.breachedCount !== 1 ? 'es' : ''}`}
          icon={Target}
          color={slaPerformance.onTimeRate >= 80 ? 'text-emerald-600' : 'text-amber-600'}
          bg={slaPerformance.onTimeRate >= 80 ? 'bg-emerald-100' : 'bg-amber-100'}
        />
        <MetricCard
          title="Avg. Completion Time"
          value={`${slaPerformance.avgDurationHours}h`}
          subtitle={`${slaPerformance.totalCompleted} completed`}
          icon={Clock}
          color="text-sky-600"
          bg="bg-sky-100"
        />
        <MetricCard
          title="Total Revenue"
          value={formatNaira(
            revenueByMonth.reduce((s, m) => s + m.revenue, 0)
          )}
          subtitle="Last 6 months"
          icon={DollarSign}
          color="text-amber-600"
          bg="bg-amber-100"
        />
      </div>

      {/* Revenue by Month — Area Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Revenue by Month
          </CardTitle>
        </CardHeader>
        <CardContent>
          {revenueByMonth.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
              No revenue data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={revenueByMonth} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                />
                <RechartsTooltip
                  formatter={(value: number) => [formatNaira(value), 'Revenue']}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  fill="url(#revenueGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Two charts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cases by Status — Donut Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cases by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                No data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    dataKey="count"
                    nameKey="name"
                    paddingAngle={2}
                    label={({ name, percent }) =>
                      `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {statusChartData.map((_, index) => (
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

        {/* Cases by Service Type — Horizontal Bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cases by Service Type</CardTitle>
          </CardHeader>
          <CardContent>
            {serviceChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                No data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={serviceChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={120}
                    tick={{ fontSize: 10 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18}>
                    {serviceChartData.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Completion Rate Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Completion Rate Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {completionRateTrend.length === 0 ? (
            <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
              No trend data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={completionRateTrend} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <RechartsTooltip
                  formatter={(value: number) => [`${value}%`, 'Completion Rate']}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]} barSize={32}>
                  {completionRateTrend.map((_, index) => (
                    <Cell
                      key={index}
                      fill={index === completionRateTrend.length - 1 ? '#10b981' : '#10b98180'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AnalyticsPanel;
