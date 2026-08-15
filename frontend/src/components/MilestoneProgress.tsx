// Platform Expansion PRD §3.3 "Construction Milestone & % Completion
// Tracker" — "Frontend computes completion via real-time aggregation of
// completed tasks." No backend aggregation endpoint on purpose (see
// backend/src/cases/checklist-templates.ts's comment) — this is that
// aggregation, computed client-side from whatever CaseTask rows the case
// detail response already carries.

export interface MilestoneTask {
  label: string;
  isComplete: boolean;
  milestoneGroup: string | null;
}

const MILESTONE_ORDER = ['FOUNDATION', 'DPC', 'SUPERSTRUCTURE', 'ROOFING', 'FINISHING'] as const;

const MILESTONE_LABELS: Record<string, string> = {
  FOUNDATION: 'Foundation',
  DPC: 'DPC',
  SUPERSTRUCTURE: 'Superstructure',
  ROOFING: 'Roofing',
  FINISHING: 'Finishing',
};

export function MilestoneProgress({ tasks }: { tasks: MilestoneTask[] }) {
  const grouped = tasks.filter((t) => t.milestoneGroup);
  if (grouped.length === 0) return null;

  const overallComplete = grouped.filter((t) => t.isComplete).length;
  const overallPercent = Math.round((overallComplete / grouped.length) * 100);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Construction progress</h2>
      <div className="case-row">
        <span className="muted">Overall</span>
        <span>{overallPercent}% complete</span>
      </div>
      <div style={{ background: 'var(--asoju-border)', borderRadius: 4, height: 8, overflow: 'hidden', margin: '0.4rem 0 1rem' }}>
        <div style={{ background: 'var(--asoju-green)', width: `${overallPercent}%`, height: '100%' }} />
      </div>

      {MILESTONE_ORDER.map((group) => {
        const groupTasks = grouped.filter((t) => t.milestoneGroup === group);
        if (groupTasks.length === 0) return null;
        const complete = groupTasks.filter((t) => t.isComplete).length;
        const percent = Math.round((complete / groupTasks.length) * 100);

        return (
          <div key={group} style={{ marginBottom: '0.6rem' }}>
            <div className="case-row">
              <span>{MILESTONE_LABELS[group] ?? group}</span>
              <span className="muted">
                {complete}/{groupTasks.length} ({percent}%)
              </span>
            </div>
            <div style={{ background: 'var(--asoju-border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ background: percent === 100 ? 'var(--asoju-green)' : 'var(--asoju-muted)', width: `${percent}%`, height: '100%' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
