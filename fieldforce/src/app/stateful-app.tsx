'use client';

import { useEffect, useCallback, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { demoLogin, getAgentProfile, fetchMyMissions, fetchEarnings, fetchSupportMessages, escalateMission } from '@/lib/asoju-api';
import { Skeleton } from '@/components/ui/skeleton';
import { setAuthToken } from '@/lib/auth-fetch';
import type { Mission } from '@/lib/types';

// Direct imports for lightweight components
import { GigBoard } from '@/components/gig-board/gig-board';
import { FinancialDashboard } from '@/components/earnings/financial-dashboard';
import { PayoutHistory } from '@/components/earnings/payout-history';
import { JobCard } from '@/components/workspace/job-card';
import { ExecutionWorkspace } from '@/components/workspace/execution-workspace';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import SupportChat from '@/components/support/support-chat';
import AgentProfile from '@/components/profile/agent-profile';
import { ChatProvider } from '@/components/messaging/chat-provider';
import ChatView from '@/components/messaging/chat-view';

export default function StatefulApp() {
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
      // C2: Authenticate first (sets JWT cookie)
      const authResult = await demoLogin();
      if (authResult.agent) {
        if (authResult.token) setAuthToken('agent', authResult.token);
        setAgent(authResult.agent);
        if (authResult.agent.status === 'ACTIVE' || authResult.agent.verificationLevel === 'IDENTITY_VERIFIED' || authResult.agent.verificationLevel === 'FIELD_VERIFIED') {
          setIsOnboarded(true);
        }
      }
    } catch (error) {
      // Fallback: try fetching profile directly (if cookie already exists)
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

  if (loading) {
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

  if (!isOnboarded) {
    return <OnboardingFlow />;
  }

  return (
    <ChatProvider
      user={agent ? { userId: agent.id, role: 'AGENT' as const, displayName: agent.displayName } : null}
      enabled={isOnboarded}
    >
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
              ) : missions.map((m: Mission) => <JobCard key={m.caseId} mission={m} onClick={() => handleMissionClick(m)} onEscalate={handleEscalateMission} />)}
            </>
          )}
        </div>
      )}
      {activeTab === 'earnings' && <div className="px-4 py-3 space-y-4"><FinancialDashboard /><PayoutHistory /></div>}
      {activeTab === 'support' && <div className="px-4 py-3"><SupportChat /></div>}
      {activeTab === 'messages' && <ChatView />}
      {activeTab === 'profile' && <div className="px-4 py-3"><AgentProfile /></div>}
    </ChatProvider>
  );
}
