// Shared vocabulary for the board pages. Ported from the reference app's
// static/js/core.js; the status sets themselves live with their api clients.
//
// There are two sets, and they answer different questions. WORK status
// (RequirementStatus) is what state a piece of work is in -- carried by
// requirements, rolled up read-only for the features and epics above them.
// DELIVERY status (DeliveryStatus) is how far a body of work has been pushed
// towards live -- carried by sprints and releases, set by hand, and free to
// move in any direction.
//
// Values are stored space-free ("NotStarted") and labelled here for display
// ("Not started"), so a CSS class name (`st-NotStarted`) stays stable even
// if the wording changes.
import type { RequirementStatus } from "./requirementsApi";
import type { DeliveryStatus } from "./sprintsApi";

export const ST_LABEL: Record<RequirementStatus, string> = {
  NotStarted: "Not started",
  InProgress: "In progress",
  ToTest: "To test",
  Done: "Done",
  Blocked: "Blocked",
};

export const ST_ICON: Record<RequirementStatus, string> = {
  NotStarted: "○",
  InProgress: "◐",
  ToTest: "◎",
  Blocked: "⛔",
  Done: "✓",
};

// The normal path through a sprint board. Blocked is a flag you set from any
// of these and clear back to where it was, not a stage of its own.
export const SB_STAGES: RequirementStatus[] = ["NotStarted", "InProgress", "ToTest", "Done"];

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  NotStarted: "Not started",
  InProgress: "In progress",
  ToTest: "To test",
  DeployedToUAT: "Deployed to UAT",
  DeployedToStaging: "Deployed to Staging",
  DeployedToLive: "Deployed to Live",
};

// The reference's default sprint capacity, in hours (ten working days).
export const DEFAULT_CAPACITY_HOURS = 80;
