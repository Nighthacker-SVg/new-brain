import { memo, useMemo, type CSSProperties } from "react";

export interface OfficeMotionAgent {
  id: string;
  position: { x: number; y: number };
}

export interface OfficeMotionJob {
  agentId?: string | null;
  status: string;
}

/** Decorative indicators for actual running jobs. Idle agents produce no beacons. */
export const OfficeMotion = memo(function OfficeMotion({
  agents,
  jobs,
  selectedAgentId,
}: {
  agents: readonly OfficeMotionAgent[];
  jobs: readonly OfficeMotionJob[];
  selectedAgentId?: string;
}) {
  const activeAgents = useMemo(() => {
    const active = new Set(
      jobs.filter((job) => job.status === "running").map((job) => job.agentId),
    );
    return agents
      .filter(
        (agent) =>
          active.has(agent.id) &&
          Number.isFinite(agent.position?.x) &&
          Number.isFinite(agent.position?.y),
      )
      .slice(0, 32);
  }, [agents, jobs]);

  if (!activeAgents.length) return null;

  return (
    <div className="office-motion" aria-hidden="true">
      {activeAgents.map((agent) => (
        <span
          key={agent.id}
          className={`office-motion-beacon${selectedAgentId === agent.id ? " is-selected" : ""}`}
          style={
            {
              left: `${Math.max(0, Math.min(1, agent.position.x)) * 100}%`,
              top: `${Math.max(0, Math.min(1, agent.position.y)) * 100}%`,
            } as CSSProperties
          }
        >
          <span className="office-motion-ring" />
          <span className="office-motion-core" />
        </span>
      ))}
    </div>
  );
});
