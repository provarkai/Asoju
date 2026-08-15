'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  MapPin,
  Users,
  RefreshCw,
  Satellite,
  BatteryMedium,
  Clock,
  ChevronRight,
  Navigation,
  Map,
  X,
  Wifi,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { authFetch } from '@/lib/auth-fetch';
import { formatDateTime, formatRelativeTime } from './admin-types';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────

interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: string;
  label?: string;
}

interface ActiveAgent {
  agentId: string;
  agentName: string;
  missionId: string;
  missionTitle: string;
  currentLat: number;
  currentLng: number;
  lastUpdate: string;
  batteryLevel: number;
  track: GpsPoint[];
}

interface TrackingDashboardData {
  activeAgents: ActiveAgent[];
  totalActive: number;
}

// ─── Battery Display ────────────────────────────────────────────────────

function BatteryIndicator({ level }: { level: number }) {
  const color = level > 60 ? 'text-emerald-600' : level > 30 ? 'text-amber-600' : 'text-red-600';
  const bg = level > 60 ? 'bg-emerald-500' : level > 30 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5" title={`${level}% battery`}>
      <div className="w-6 h-3 rounded-sm border border-current text-muted-foreground relative overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full ${bg} transition-all`}
          style={{ width: `${Math.max(level, 5)}%` }}
        />
      </div>
      <span className={`text-[11px] font-medium ${color}`}>{level}%</span>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  icon: Icon,
  color = 'text-primary',
  bg = 'bg-muted',
}: {
  title: string;
  value: string | number;
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
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Map Placeholder ──────────────────────────────────────────────────

function MapPlaceholder({ agentCount }: { agentCount: number }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="relative bg-gradient-to-br from-emerald-50 via-sky-50 to-slate-100 rounded-lg overflow-hidden" style={{ minHeight: '320px' }}>
          {/* Grid pattern overlay */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }} />
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-full bg-white/80 shadow-lg flex items-center justify-center mb-4">
              <Map className="w-8 h-8 text-sky-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">Live Map</h3>
            <p className="text-sm text-slate-500 max-w-md">
              Integration Required — Configure Google Maps API key to enable real-time map visualization.
            </p>
            <div className="mt-3 bg-white/90 rounded-lg px-4 py-2 text-xs text-slate-500 shadow-sm">
              <span className="font-mono text-[10px] block">
                NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_api_key
              </span>
            </div>
          </div>
          {/* Animated dot indicators */}
          {agentCount > 0 && (
            <div className="absolute top-4 right-4">
              <div className="flex items-center gap-1.5 bg-white/90 rounded-full px-3 py-1.5 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium text-emerald-700">{agentCount} agent{agentCount !== 1 ? 's' : ''} active</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Active Agent Card ───────────────────────────────────────────────────

function ActiveAgentCard({
  agent,
  onClick,
}: {
  agent: ActiveAgent;
  onClick: () => void;
}) {
  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Navigation className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{agent.agentName}</p>
              <p className="text-xs text-muted-foreground truncate">{agent.missionTitle}</p>
            </div>
          </div>
          <BatteryIndicator level={agent.batteryLevel} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono">
              {agent.currentLat.toFixed(6)}, {agent.currentLng.toFixed(6)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>Updated {formatRelativeTime(agent.lastUpdate)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-primary font-medium">
              View Track <ChevronRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Mission Track Dialog ────────────────────────────────────────────────

function computeTotalDistance(track: GpsPoint[]): number {
  if (track.length < 2) return 0;
  let dist = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const R = 6371; // km
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    dist += R * c;
  }
  return dist;
}

function computeTotalDuration(track: GpsPoint[]): string {
  if (track.length < 2) return '0m';
  const first = new Date(track[0].timestamp).getTime();
  const last = new Date(track[track.length - 1].timestamp).getTime();
  const diffMins = Math.floor((last - first) / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function MissionTrackDialog({
  agent,
  open,
  onClose,
}: {
  agent: ActiveAgent | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!agent) return null;

  const totalDistance = computeTotalDistance(agent.track);
  const totalDuration = computeTotalDuration(agent.track);

  return (
    <div className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div className="bg-background rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Navigation className="w-4 h-4 text-primary" />
              Mission Track
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">{agent.agentName} — {agent.missionTitle}</p>
          </div>
          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Summary */}
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-lg font-bold">{totalDistance.toFixed(2)} km</p>
              <p className="text-[11px] text-muted-foreground">Total Distance</p>
            </div>
            <div>
              <p className="text-lg font-bold">{totalDuration}</p>
              <p className="text-[11px] text-muted-foreground">Total Duration</p>
            </div>
            <div>
              <p className="text-lg font-bold">{agent.track.length}</p>
              <p className="text-[11px] text-muted-foreground">GPS Points</p>
            </div>
          </div>
        </div>

        {/* Track Points */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-0">
            {agent.track.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MapPin className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No GPS track data available</p>
              </div>
            ) : (
              agent.track.map((point, idx) => (
                <div key={idx} className="flex gap-3">
                  {/* Timeline line */}
                  <div className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${idx === 0 ? 'bg-emerald-500' : idx === agent.track.length - 1 ? 'bg-red-500' : 'bg-primary/40'}`} />
                    {idx < agent.track.length - 1 && (
                      <div className="w-px flex-1 bg-border" />
                    )}
                  </div>
                  {/* Point info */}
                  <div className="pb-4 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {idx === 0 ? 'Start' : idx === agent.track.length - 1 ? 'End' : `Point ${idx + 1}`}
                      </span>
                      {point.label && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{point.label}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                      {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDateTime(point.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export function LiveTrackingPanel() {
  const [data, setData] = useState<TrackingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<ActiveAgent | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await authFetch('/api/admin/live-tracking');
      if (!res.ok) throw new Error('Failed to fetch tracking data');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [refreshing]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Auto-refresh every 10s
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchData();
      }, 10000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, fetchData]);

  const handleAgentClick = (agent: ActiveAgent) => {
    setSelectedAgent(agent);
    setTrackOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="py-16">
        <CardContent className="text-center">
          <Satellite className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Auto-Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Satellite className="w-5 h-5 text-primary" /> Live GPS Tracking
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {autoRefresh && (
              <span className="inline-flex items-center gap-1">
                <Wifi className="w-3 h-3 text-emerald-500" /> Auto-refreshing every 10s
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <Label htmlFor="auto-refresh" className="text-sm">Auto-refresh</Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchData}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          title="Agents in Field"
          value={data?.totalActive || 0}
          icon={Users}
          color="text-emerald-600"
          bg="bg-emerald-100"
        />
        <MetricCard
          title="GPS Points Today"
          value={data?.activeAgents.reduce((sum, a) => sum + a.track.length, 0) || 0}
          icon={MapPin}
          color="text-sky-600"
          bg="bg-sky-100"
        />
      </div>

      {/* Map Placeholder */}
      <MapPlaceholder agentCount={data?.totalActive || 0} />

      {/* Active Agents List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Navigation className="w-4 h-4" /> Active Agents in Field
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(!data || data.activeAgents.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Navigation className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No agents currently in the field</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {data.activeAgents.map((agent) => (
                <ActiveAgentCard
                  key={agent.agentId}
                  agent={agent}
                  onClick={() => handleAgentClick(agent)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mission Track Dialog */}
      <MissionTrackDialog
        agent={selectedAgent}
        open={trackOpen}
        onClose={() => setTrackOpen(false)}
      />
    </div>
  );
}

export default LiveTrackingPanel;
