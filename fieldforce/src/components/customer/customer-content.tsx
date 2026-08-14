'use client';

import { lazy, Suspense } from 'react';
import { useCustomerContext } from './customer-shell';

const HomeSummary = lazy(() => import('./home-summary'));
const RequestList = lazy(() => import('./request-list'));
const NewRequestForm = lazy(() => import('./new-request-form'));
const CaseList = lazy(() => import('./case-list'));
const CaseDetail = lazy(() => import('./case-detail'));
const BillingHistory = lazy(() => import('./billing-history'));
const CustomerProfile = lazy(() => import('./customer-profile'));
const ChatCustomerView = lazy(() => import('@/components/messaging/chat-customer-view').then(m => ({ default: m.default })));

function ViewLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function CustomerContent() {
  const { activeView, selectedCaseId } = useCustomerContext();

  return (
    <Suspense fallback={<ViewLoader />}>
      {activeView === 'home' && <HomeSummary />}
      {activeView === 'requests' && <RequestList />}
      {activeView === 'new-request' && <NewRequestForm />}
      {activeView === 'cases' && <CaseList />}
      {activeView === 'case-detail' && selectedCaseId && <CaseDetail caseId={selectedCaseId} />}
      {activeView === 'billing' && <BillingHistory />}
      {activeView === 'messages' && <ChatCustomerView />}
      {activeView === 'profile' && <CustomerProfile />}
    </Suspense>
  );
}
