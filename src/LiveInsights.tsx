import type { LiveState } from "./live-types";

const states = ["queued", "running", "blocked", "completed", "failed"] as const;

/** Charts derive from recorded server jobs and reservations, never simulated data. */
export default function LiveInsights({ state }: { state: LiveState }) {
  const counts = states.map((status) => ({
    status,
    count: state.tasks.filter((task) => task.status === status).length,
  }));
  const maximum = Math.max(1, ...counts.map((item) => item.count));
  const durations = state.events
    .flatMap((event) => {
      const detail = event.detail as { durationMs?: unknown } | undefined;
      return event.label === "Model response received" &&
        typeof detail?.durationMs === "number"
        ? [detail.durationMs]
        : [];
    })
    .slice(0, 20)
    .sort((a, b) => a - b);
  return (
    <section className="lx-insights" aria-label="Recorded execution insights">
      <div className="lx-insight-card">
        <header>
          <h3>Recent job outcomes</h3>
          <small>{state.tasks.length} recorded jobs</small>
        </header>
        <div
          className="lx-job-chart"
          role="img"
          aria-label={counts
            .map((item) => `${item.status}: ${item.count}`)
            .join(", ")}
        >
          {counts.map((item) => (
            <div key={item.status}>
              <span>{item.status}</span>
              <div className="lx-chart-track">
                <i
                  data-status={item.status}
                  style={{ width: `${(item.count / maximum) * 100}%` }}
                />
              </div>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="lx-insight-card">
        <header>
          <h3>Project budget reservations</h3>
          <small>Estimates, not provider invoices</small>
        </header>
        {state.projects.slice(0, 5).map((project) => (
          <div className="lx-budget-chart" key={project.id}>
            <div>
              <span>{project.name}</span>
              <strong>
                ${(project.spentCents / 100).toFixed(2)} / $
                {(project.budgetCents / 100).toFixed(2)}
              </strong>
            </div>
            <progress
              value={project.spentCents}
              max={project.budgetCents}
              aria-label={`${project.name} budget reserved`}
            />
          </div>
        ))}
        <p className="lx-muted">
          {durations.length
            ? `Median of ${durations.length} recent model responses: ${(durations[Math.floor(durations.length / 2)] / 1000).toFixed(2)}s.`
            : "No model response timings recorded yet."}
        </p>
      </div>
    </section>
  );
}
