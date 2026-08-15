import { useEffect, useCallback, useState, Suspense, lazy } from 'react';
import { ClipboardList } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { demoLogin, getAgentProfile, fetchMyMissions, fetchEarnings, fetchSupportMessages, escalateMission } from '@/lib/asoju-api';
import { Skeleton } from '@/components/ui/skeleton';
import { setAuthToken } from '@/lib/auth-fetch';
import { ChatProvider } from '@/components/messaging/chat-provider';
import type { Mission } from '@/lib/types';

const AppShell = lazy(() => import('@/components/layout/app-shell').then(m => ({ default: m.AppShell })));
const OnboardingFlow = lazy(() => import('@/components/onboarding/onboarding-flow').then(m => ({ default: m.OnboardingFlow })));
const GigBoard = lazy(() => import('@/components/gig-board/gig-board').then(m => ({ default: m.GigBoard })));
const JobCard = lazy(() => import('@/components/workspace/job-card').then(m => ({ default: m.JobCard })));
const ExecutionWorkspace = lazy(() => import('@/components/workspace/execution-workspace').then(m => ({ default: m.ExecutionWorkspace })));
const FinancialDashboard = lazy(() => import('@/components/earnings/financial-dashboard').then(m => ({ default: m.FinancialDashboard })));
const PayoutHistory = lazy(() => import('@/components/earnings/payout-history').then(m => ({ default: m.PayoutHistory })));
const SupportChat = lazy(() => import('@/components/support/support-chat').then(m => ({ default: m.default })));
const AgentProfile = lazy(() => import('@/components/profile/agent-profile').then(m => ({ default: m.default })));
const ChatView = lazy(() => import('@/components/messaging/chat-view').then(m => ({ default: m.default })));

function PageLoader() {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-lg space-y-4">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function MainApp() {
  const {
    isOnboarded, agent, setAgent, setIsOnboarded, activeTab,
    missions, setMissions, setPayouts, setActiveMissionId,
    updateMission, setWalletSummary,
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

  const initializeApp = useCallback(async () => {
    try {
      setLoading(true);
      const authResult = await demoLogin();
      if (authResult.agent) {
        if (authResult.token) setAuthToken('agent', authResult.token);
        setAgent(authResult.agent);
        if (authResult.agent.status === 'ACTIVE' || authResult.agent.verificationLevel === 'IDENTITY_VERIFIED' || authResult.agent.verificationLevel === 'FIELD_VERIFIED') {
          setIsOnboarded(true);
        }
      }
    } catch (error) {
      console.warn('Demo login failed, trying direct profile fetch:', error);
      try {
        const profileData = await getAgentProfile();
        setAgent(profileData);
        if (profileData.status === 'ACTIVE' || profileData.verificationLevel === 'IDENTITY_VERIFIED' || profileData.verificationLevel === 'FIELD_VERIFIED') {
          setIsOnboarded(true);
        }
      } catch { /* will show onboarding */ }
    } finally { setLoading(false); }
  }, [setAgent, setIsOnboarded]);

  useEffect(() => { initializeApp(); }, [initializeApp]);

  const loadTabData = useCallback(async () => {
    try {
      await new Promise(r => setTimeout(r, 300));
      switch (activeTab) {
        case 'missions': { const d = await fetchMyMissions(); setMissions(d); break; }
        case 'earnings': {
          const d = await fetchEarnings();
          setPayouts(d.payouts ?? []);
          if (d.wallet) setWalletSummary(d.wallet);
          break;
        }
        case 'support': { const m = await fetchSupportMessages(); useAppStore.getState().setSupportMessages(m); break; }
      }
    } catch (e) { console.error(`Load ${activeTab} error:`, e); }
  }, [activeTab, setMissions, setPayouts, setWalletSummary]);

  useEffect(() => { if (isOnboarded) loadTabData(); }, [activeTab, isOnboarded, loadTabData]);

  const handleMissionClick = (mission: Mission) => { setSelectedMission(mission); setActiveMissionId(mission.caseId); };
  const handleBackToMissions = () => { setSelectedMission(null); setActiveMissionId(null); fetchMyMissions().then(setMissions).catch(console.error); };
  const handleEscalateMission = async (caseId: string) => {
    const reason = prompt('Describe the issue:');
    if (!reason) return;
    try { await escalateMission({ caseId, reason }); updateMission(caseId, { escalated: true, escalationReason: reason }); } catch { alert('Escalation failed.'); }
  };

  if (loading) return <PageLoader />;
  if (!isOnboarded) return <Suspense fallback={<PageLoader />}><OnboardingFlow /></Suspense>;

  return (
    <Suspense fallback={<PageLoader />}>
      <ChatProvider
        user={agent ? { userId: agent.id, role: 'AGENT' as const, displayName: agent.displayName } : null}
        enabled={isOnboarded}
      >
      <AppShell>
        {activeTab === 'gigs' && <div className="px-4 py-3"><GigBoard /></div>}
        {activeTab === 'missions' && (
          <div className="px-4 py-3 space-y-3">
            {selectedMission ? (
              <ExecutionWorkspace mission={selectedMission} onBack={handleBackToMissions} />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{missions.length} mission{missions.length !== 1 ? 's' : ''} assigned</p>
                {missions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4"><ClipboardList className="w-8 h-8 text-muted-foreground" /></div>
                    <h3 className="text-lg font-semibold">No Missions Yet</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mt-1">Head to the Gigs tab to browse assignments.</p>
                  </div>
                ) : missions.map((m) => <JobCard key={m.caseId} mission={m} onClick={() => handleMissionClick(m)} onEscalate={handleEscalateMission} />)}
              </>
            )}
          </div>
        )}
        {activeTab === 'earnings' && <div className="px-4 py-3 space-y-4"><FinancialDashboard /><PayoutHistory /></div>}
        {activeTab === 'messages' && <ChatView />}
        {activeTab === 'support' && <div className="px-4 py-3"><SupportChat /></div>}
        {activeTab === 'profile' && <div className="px-4 py-3"><AgentProfile /></div>}
      </AppShell>
      </ChatProvider>
    </Suspense>
  );
}
