// "Who owns this?" -- the one control, wherever it is asked. Requirements
// have carried an assignee since the board was ported; epics and features
// gained one on 2026-09-18, and three hand-rolled member <select>s drifting
// apart was not worth it.
//
// The list is the organisation's active members, already loaded by
// BoardProvider. The server refuses an id that is not one of them, so an
// assignee left behind by someone who has since left the organisation is
// shown by id rather than silently dropped -- it is real, and clearing it is
// the user's call.
import { useBoard } from "./boardData";

interface AssigneeSelectProps {
  /** The current assignee's user id, or null. */
  value: string | null;
  /** Called with the new id, or null to unassign. */
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  /** For a control with no visible <label> beside it. */
  ariaLabel?: string;
  /** For a control that has one, pointing at it with htmlFor. */
  id?: string;
  className?: string;
}

export function AssigneeSelect({ value, onChange, disabled, ariaLabel, id, className }: AssigneeSelectProps) {
  const { members } = useBoard();
  const known = value === null || members.some((m) => m.user_id === value);

  return (
    <select
      id={id}
      className={className ?? "select"}
      value={value ?? ""}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">— unassigned —</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.name || m.email}
        </option>
      ))}
      {!known && <option value={value}>Someone no longer in this organisation</option>}
    </select>
  );
}

/** The assignee as a chip, for a row or card head. Renders nothing when
 *  unassigned: an empty chip on every row would be noise. */
export function AssigneeChip({ userId, what }: { userId: string | null; what: string }) {
  const { index } = useBoard();
  if (!userId) return null;
  return (
    <span className="bchip asg" title={`${what} assigned to ${index.memberName(userId)}`}>
      {index.memberName(userId)}
    </span>
  );
}
