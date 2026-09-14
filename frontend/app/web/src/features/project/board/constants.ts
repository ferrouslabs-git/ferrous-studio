// Shared vocabulary for the board pages. Ported from the reference app's
// static/js/core.js; the status sets themselves live with their api clients.
import type { EpicStatus } from "./epicsApi";
import { EPIC_STATUSES } from "./epicsApi";
import type { RequirementStatus } from "./requirementsApi";
import type { SprintState } from "./sprintsApi";

export const ST_ICON: Record<RequirementStatus, string> = {
  Todo: "○",
  Doing: "◐",
  Review: "◎",
  Blocked: "⛔",
  Done: "✓",
};

// The normal path through a sprint board. Blocked is a flag you set from any
// of these and clear back to where it was, not a stage of its own.
export const SB_STAGES: RequirementStatus[] = ["Todo", "Doing", "Review", "Done"];

export const EPIC_STATUS_LABEL: Record<EpicStatus, string> = {
  Readiness: "Readiness",
  Implementation: "Implementation",
  ReleasedToUAT: "Released to UAT",
  HumanValidation: "Human Validation",
  Done: "Done",
};

export const nextEpicStatus = (s: EpicStatus): EpicStatus =>
  EPIC_STATUSES[(EPIC_STATUSES.indexOf(s) + 1) % EPIC_STATUSES.length];

export const SPRINT_STATE_LABEL: Record<SprintState, string> = {
  planned: "planned",
  active: "active",
  done: "done",
};

// The reference's default sprint capacity, in hours (ten working days).
export const DEFAULT_CAPACITY_HOURS = 80;
