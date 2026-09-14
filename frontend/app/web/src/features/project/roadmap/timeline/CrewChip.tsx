// A crew chip on the timeline: the agent's name, hued by status (running =
// pulsing, board.css .tl-agent). The sprint row's tooltip also names the
// requirement the agent is on -- the reference app's tlSprintRow -- while the
// fold bar's stops at name · status (tlFoldBar), so the caller says which.
// Local to the timeline because the shared AgentChip has no place for the
// requirement. Ported from static/js/timeline.js.
import type { Agent } from "../../board/agentsApi";
import { useBoard } from "../../board/boardData";

export function CrewChip({ agent, showWork = false }: { agent: Agent; showWork?: boolean }) {
  const { index } = useBoard();
  let title = `${agent.name} · ${agent.status}`;
  if (showWork && agent.current_requirement_id) {
    const req = index.requirementById.get(agent.current_requirement_id);
    title += ` · working on ${req?.human_id ?? "a requirement"}`;
  }
  return (
    <i className={`tl-agent ag-${agent.status}`} title={title}>
      {agent.name}
    </i>
  );
}
