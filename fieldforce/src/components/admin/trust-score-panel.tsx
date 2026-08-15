'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  Users,
  TrendingUp,
  Award,
  ArrowUp,
  ArrowDown,
  Minus,
  RefreshCw,
  ChevronRight,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { authFetch } from '@/lib/auth-fetch';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────

type TrustTier = 'NEW' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

interface AgentTrustScore {
  agentId: string;
  agentName: string;
  completionScore: number;
  gpsScore: number;
  evidenceScore: number;
  ratingScore: number;
  responseScore: number;
  compositeScore: number;
  trustTier: TrustTier;
  trend: 'up' | 'down' | 'stable';
  totalMissions: number;
  completedMissions: number;
  failedMissions: number;
}

interface TrustDashboardData {
  agents: AgentTrustScore[];
  totalAgents: number;
  avgCompositeScore: number;
  goldPlusCount: number;
  improvingCount: number;
}

// ─── Trust Tier Config ───────────────────────────────────────────────────

const TRUST_TIER_CONFIG: Record<TrustTier, { label: string; color: string; bgColor: string; borderColor: string }> = {
  NEW: { label: 'New', color: 'text-slate-700', bgColor: 'bg-slate-100', borderColor: 'border-slate-200' },
  BRONZE: { label: 'Bronze', color: 'text-amber-800', bgColor: 'bg-amber-100', borderColor: 'border-amber-200' },
  SILVER: { label: 'Silver', color: 'text-gray-700', bgColor: 'bg-gray-200', borderColor: 'border-gray-300' },
  GOLD: { label: 'Gold', color: 'text-yellow-800', bgColor: 'bg-yellow-100', borderColor: 'border-yellow-200' },
  PLATINUM: { label: 'Platinum', color: 'text-violet-700', bgColor: 'bg-violet-100', borderColor: 'border-violet-200' },
};

function TrustTierBadge({ tier }: { tier: TrustTier }) {
  const config = TRUST_TIER_CONFIG[tier];
  return (
    <Badge variant="outline" className={`${config.bgColor} ${config.color} ${config.borderColor} text-[11px] font-semibold px-2 py-0.5`}>
      <Award className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <ArrowUp className="w-4 h-4 text-emerald-600" />;
  if (trend === 'down') return <ArrowDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
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

// ─── Component Score Bar ─────────────────────────────────────────────────

function ComponentScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{score}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ─── Agent Detail Dialog ────────────────────────────────────────────────

function AgentDetailDialog({
  agent,
  open,
  onClose,
  onRecalculate,
  recalculating,
}: {
  agent: AgentTrustScore | null;
  open: boolean;
  onClose: () => void;
  onRecalculate: (agentId: string) => void;
  recalculating: boolean;
}) {
  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div>{agent.agentName}</div>
              <div className="flex items-center gap-2 mt-1">
                <TrustTierBadge tier={agent.trustTier} />
                <span className="text-lg font-bold">{agent.compositeScore}%</span>
                <TrendIcon trend={agent.trend} />
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Component Scores */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Component Scores</h4>
            <ComponentScoreBar label="Task Completion" score={agent.completionScore} />
            <ComponentScoreBar label="GPS Compliance" score={agent.gpsScore} />
            <ComponentScoreBar label="Evidence Quality" score={agent.evidenceScore} />
            <ComponentScoreBar label="Customer Rating" score={agent.ratingScore} />
            <ComponentScoreBar label="Response Time" score={agent.responseScore} />
          </div>

          {/* Mission Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{agent.totalMissions}</p>
              <p className="text-[11px] text-muted-foreground">Total Missions</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{agent.completedMissions}</p>
              <p className="text-[11px] text-muted-foreground">Completed</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-700">{agent.failedMissions}</p>
              <p className="text-[11px] text-muted-foreground">Failed</p>
            </div>
          </div>

          {/* Actions */}
          <Button
            onClick={() => onRecalculate(agent.agentId)}
            disabled={recalculating}
            variant="outline"
            className="w-full"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recalculating ? 'animate-spin' : ''}`} />
            {recalculating ? 'Recalculating...' : 'Recalculate Trust Score'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export function TrustScorePanel() {
  const [data, setData] = useState<TrustDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [recalculatingAll, setRecalculatingAll] = useState(false);
  const [recalculatingAgent, setRecalculatingAgent] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentTrustScore | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);

  const fetchData = async () => {
    try {
      const res = await authFetch('/api/admin/trust-scores');
      if (!res.ok) throw new Error('Failed to fetch trust scores');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredAgents = useMemo(() => {
    if (!data) return [];
    let agents = [...data.agents];
    if (tierFilter !== 'all') {
      agents = agents.filter((a) => a.trustTier === tierFilter);
    }
    agents.sort((a, b) => sortDesc ? b.compositeScore - a.compositeScore : a.compositeScore - b.compositeScore);
    return agents;
  }, [data, tierFilter, sortDesc]);

  const handleRecalculateAll = async () => {
    setRecalculatingAll(true);
    try {
      const res = await authFetch('/api/admin/trust-scores/recalculate', { method: 'POST' });
      if (!res.ok) throw new Error('Recalculation failed');
      toast.success('All trust scores recalculated successfully');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recalculation failed');
    } finally {
      setRecalculatingAll(false);
    }
  };

  const handleRecalculateAgent = async (agentId: string) => {
    setRecalculatingAgent(agentId);
    try {
      const res = await authFetch(`/api/admin/trust-scores/${agentId}/recalculate`, { method: 'POST' });
      if (!res.ok) throw new Error('Recalculation failed');
      toast.success('Trust score recalculated');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recalculation failed');
    } finally {
      setRecalculatingAgent(null);
    }
  };

  const handleAgentClick = (agent: AgentTrustScore) => {
    setSelectedAgent(agent);
    setDetailOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{error || 'No trust score data available'}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Agents"
          value={data.totalAgents}
          icon={Users}
          color="text-sky-600"
          bg="bg-sky-100"
        />
        <MetricCard
          title="Avg Composite Score"
          value={`${data.avgCompositeScore}%`}
          icon={TrendingUp}
          color="text-violet-600"
          bg="bg-violet-100"
        />
        <MetricCard
          title="Gold+ Agents"
          value={data.goldPlusCount}
          subtitle={`${data.totalAgents > 0 ? Math.round((data.goldPlusCount / data.totalAgents) * 100) : 0}% of agents`}
          icon={Award}
          color="text-yellow-600"
          bg="bg-yellow-100"
        />
        <MetricCard
          title="Improving Agents"
          value={data.improvingCount}
          icon={TrendingUp}
          color="text-emerald-600"
          bg="bg-emerald-100"
        />
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4" /> Trust Leaderboard
            </CardTitle>
            <div className="flex items-center gap-3">
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="Filter by tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  <SelectItem value="NEW">New</SelectItem>
                  <SelectItem value="BRONZE">Bronze</SelectItem>
                  <SelectItem value="SILVER">Silver</SelectItem>
                  <SelectItem value="GOLD">Gold</SelectItem>
                  <SelectItem value="PLATINUM">Platinum</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRecalculateAll}
                disabled={recalculatingAll}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${recalculatingAll ? 'animate-spin' : ''}`} />
                Recalculate All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Shield className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No agents found for this filter</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px] text-center">#</TableHead>
                        <TableHead>Agent Name</TableHead>
                        <TableHead className="text-center">Completion</TableHead>
                        <TableHead className="text-center">GPS</TableHead>
                        <TableHead className="text-center">Evidence</TableHead>
                        <TableHead className="text-center">Rating</TableHead>
                        <TableHead className="text-center">Response</TableHead>
                        <TableHead
                          className="text-center cursor-pointer select-none"
                          onClick={() => setSortDesc(!sortDesc)}
                        >
                          <span className="flex items-center gap-1 justify-center">
                            Composite <ChevronRight className={`w-3 h-3 transition-transform ${sortDesc ? 'rotate-90' : '-rotate-90'}`} />
                          </span>
                        </TableHead>
                        <TableHead className="text-center">Tier</TableHead>
                        <TableHead className="w-[50px] text-center">Trend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAgents.map((agent, idx) => (
                        <TableRow
                          key={agent.agentId}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleAgentClick(agent)}
                        >
                          <TableCell className="text-center font-semibold text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-medium">{agent.agentName}</TableCell>
                          <TableCell className="text-center text-sm">{agent.completionScore}%</TableCell>
                          <TableCell className="text-center text-sm">{agent.gpsScore}%</TableCell>
                          <TableCell className="text-center text-sm">{agent.evidenceScore}%</TableCell>
                          <TableCell className="text-center text-sm">{agent.ratingScore}%</TableCell>
                          <TableCell className="text-center text-sm">{agent.responseScore}%</TableCell>
                          <TableCell className="text-center">
                            <span className={`text-sm font-bold ${agent.compositeScore >= 80 ? 'text-emerald-600' : agent.compositeScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                              {agent.compositeScore}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <TrustTierBadge tier={agent.trustTier} />
                          </TableCell>
                          <TableCell className="text-center">
                            <TrendIcon trend={agent.trend} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden p-4 space-y-3">
                {filteredAgents.map((agent, idx) => (
                  <div
                    key={agent.agentId}
                    className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => handleAgentClick(agent)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">#{idx + 1}</span>
                        <span className="font-medium">{agent.agentName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrustTierBadge tier={agent.trustTier} />
                        <TrendIcon trend={agent.trend} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>Comp: {agent.completionScore}%</span>
                        <span>GPS: {agent.gpsScore}%</span>
                        <span>Evid: {agent.evidenceScore}%</span>
                      </div>
                      <span className={`text-sm font-bold ${agent.compositeScore >= 80 ? 'text-emerald-600' : agent.compositeScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {agent.compositeScore}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Agent Detail Dialog */}
      <AgentDetailDialog
        agent={selectedAgent}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRecalculate={handleRecalculateAgent}
        recalculating={recalculatingAgent === selectedAgent?.agentId}
      />
    </div>
  );
}

export default TrustScorePanel;
