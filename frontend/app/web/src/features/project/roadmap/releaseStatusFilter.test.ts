import { describe, expect, it } from "vitest";
import { DEFAULT_RELEASE_STATUSES, releaseStatusSelection, releasesWithStatus } from "./releaseStatusFilter";

const releases = [
  { id: "r1", status: "DeployedToLive" },
  { id: "r2", status: "InProgress" },
  { id: "r3", status: "NotStarted" },
];
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe("release status filter (FS-REQ-95)", () => {
  it("hides live releases until the filter is changed", () => {
    expect(DEFAULT_RELEASE_STATUSES).not.toContain("DeployedToLive");
    expect(ids(releasesWithStatus(releases, releaseStatusSelection(undefined)))).toEqual(["r2", "r3"]);
  });

  it("shows only the statuses picked", () => {
    expect(ids(releasesWithStatus(releases, new Set(["DeployedToLive"])))).toEqual(["r1"]);
  });

  it("an empty selection shows every release", () => {
    expect(ids(releasesWithStatus(releases, releaseStatusSelection([])))).toEqual(["r1", "r2", "r3"]);
  });

  it("drops a stored status that no longer exists", () => {
    expect([...releaseStatusSelection(["InProgress", "Shipped"])]).toEqual(["InProgress"]);
  });
});
