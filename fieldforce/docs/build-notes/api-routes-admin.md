---
Task ID: api-routes
Agent: Main Agent
Task: Create 7 API route files for Trust, Reports, Care Plans, SOS, GPS Tracking, and Notifications

Work Log:
- Read worklog.md to understand project context and existing patterns
- Examined existing admin routes (cases, payouts) for the `requireAdmin(request)` pattern
- Read all 5 service libraries: trust-score.ts, service-report.ts, care-plan-engine.ts, sos-protocol.ts, live-tracking.ts, whatsapp-gateway.ts
- Examined agent auth pattern via bola.ts and auth.ts (getAgentIdFromRequest)
- Created 7 API route files with proper error handling, input validation, and JSON responses
- All admin routes use `requireAdmin(request)` pattern
- Agent tracking route uses `getAgentIdFromRequest(request)` pattern
- Ran lint: 0 errors in new files (3 pre-existing errors in unrelated UI components)
- Dev server compiles cleanly with no compilation errors

Files Created:
1. `src/app/api/admin/trust/route.ts` — GET (leaderboard/profile + tier distribution), POST (recalculate/recalculate_all)
2. `src/app/api/admin/reports/route.ts` — GET (list reports / by caseId), POST (generate/deliver/retry_delivery)
3. `src/app/api/admin/care-plans/route.ts` — GET (list plans / upcoming visits), POST (create/activate/pause/cancel/generate_visits)
4. `src/app/api/admin/sos/route.ts` — GET (active alerts + history), POST (acknowledge/resolve/escalate)
5. `src/app/api/missions/tracking/route.ts` — POST (report live location), GET (mission track + summary)
6. `src/app/api/admin/tracking/route.ts` — GET (mission track or all active agent locations)
7. `src/app/api/notifications/route.ts` — GET (notifications + stats), POST (send/process_pending)

Stage Summary:
- 7 API routes created following existing project patterns
- All routes delegate to existing service libraries (trust-score, service-report, care-plan-engine, sos-protocol, live-tracking, whatsapp-gateway)
- Proper error handling with AuthError catch pattern matching
- Input validation on all required parameters
- ESLint: 0 new errors, dev server: compiles clean
