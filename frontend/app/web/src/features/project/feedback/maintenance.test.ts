import { describe, expect, it } from "vitest";
import {
  awaitingConfirmation,
  chargedWork,
  contractedIn,
  currentMonth,
  fmtDay,
  fmtDuration,
  fmtHours,
  fmtMonth,
  maintenanceLedger,
  monthOf,
  nextMonth,
} from "./maintenance";

const contract = (start_date: string, hours_per_month: number, end_date: string | null = null) => ({
  start_date,
  end_date,
  hours_per_month,
});
const resolved = (resolved_at: string | null, estimate_hours: number | null) => ({ resolved_at, estimate_hours });

describe("months", () => {
  it("reads the month off a date or a timestamp", () => {
    expect(monthOf("2026-03-14")).toBe("2026-03");
    expect(monthOf("2026-03-31T23:30:00")).toBe("2026-03");
  });
  it("steps across the year end", () => {
    expect(nextMonth("2026-11")).toBe("2026-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
  it("takes the current month by UTC", () => {
    expect(currentMonth(new Date(Date.UTC(2026, 9, 31, 23, 59)))).toBe("2026-10");
  });
});

describe("contractedIn", () => {
  it("covers the start and end months whole, and nothing outside them", () => {
    const cs = [contract("2026-01-20", 10, "2026-03-05")];
    expect(contractedIn(cs, "2025-12")).toBe(0);
    expect(contractedIn(cs, "2026-01")).toBe(10);
    expect(contractedIn(cs, "2026-03")).toBe(10);
    expect(contractedIn(cs, "2026-04")).toBe(0);
  });
  it("runs an open-ended contract for ever", () => {
    expect(contractedIn([contract("2026-01-01", 8)], "2030-06")).toBe(8);
  });
  it("adds overlapping contracts together", () => {
    const cs = [contract("2026-01-01", 10, "2026-06-30"), contract("2026-06-01", 4)];
    expect(contractedIn(cs, "2026-05")).toBe(10);
    expect(contractedIn(cs, "2026-06")).toBe(14);
    expect(contractedIn(cs, "2026-07")).toBe(4);
  });
});

describe("maintenanceLedger", () => {
  it("is empty with no contracts, or before the first one starts", () => {
    expect(maintenanceLedger([], [resolved("2026-01-05T10:00:00", 3)], "2026-03")).toEqual([]);
    expect(maintenanceLedger([contract("2026-05-01", 10)], [], "2026-03")).toEqual([]);
  });

  it("lists every month from the first contract to now and rolls unused hours over", () => {
    const rows = maintenanceLedger(
      [contract("2026-01-10", 10)],
      [resolved("2026-01-15T09:00:00", 4), resolved("2026-03-02T09:00:00", 12.5)],
      "2026-03",
    );
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(rows[0]).toMatchObject({ contracted: 10, rolledOver: 0, used: 4, balance: 6 });
    expect(rows[1]).toMatchObject({ contracted: 10, rolledOver: 6, used: 0, balance: 16 });
    expect(rows[2]).toMatchObject({ contracted: 10, rolledOver: 16, used: 12.5, balance: 13.5 });
  });

  it("carries an overspend forward as a negative balance", () => {
    const rows = maintenanceLedger([contract("2026-01-01", 5)], [resolved("2026-01-20T12:00:00", 8)], "2026-02");
    expect(rows[0].balance).toBe(-3);
    expect(rows[1]).toMatchObject({ rolledOver: -3, balance: 2 });
  });

  it("follows the contract as it changes, and keeps the balance through a gap", () => {
    const rows = maintenanceLedger(
      [contract("2026-01-01", 10, "2026-01-31"), contract("2026-03-01", 20)],
      [],
      "2026-03",
    );
    expect(rows.map((r) => [r.contracted, r.balance])).toEqual([
      [10, 10],
      [0, 10],
      [20, 30],
    ]);
  });

  it("counts resolved reports with no estimate but draws nothing for them", () => {
    const rows = maintenanceLedger(
      [contract("2026-01-01", 10)],
      [resolved("2026-01-02T00:00:00", null), resolved("2026-01-03T00:00:00", 2), resolved(null, 9)],
      "2026-01",
    );
    expect(rows[0]).toMatchObject({ used: 2, resolved: 2, unestimated: 1, balance: 8 });
  });

  it("ignores work resolved before the first contract", () => {
    const rows = maintenanceLedger([contract("2026-02-01", 10)], [resolved("2026-01-31T23:00:00", 6)], "2026-02");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ used: 0, balance: 10 });
  });

  it("does not let floating-point sums drift", () => {
    const rows = maintenanceLedger(
      [contract("2026-01-01", 1)],
      [resolved("2026-01-02T00:00:00", 0.1), resolved("2026-01-03T00:00:00", 0.2)],
      "2026-01",
    );
    expect(rows[0].used).toBe(0.3);
    expect(rows[0].balance).toBe(0.7);
  });
});

describe("formatting", () => {
  it("shows hours as hours", () => {
    expect(fmtHours(12)).toBe("12h");
    expect(fmtHours(7.5)).toBe("7.5h");
    expect(fmtHours(-3)).toBe("-3h");
    expect(fmtHours(-0)).toBe("0h");
  });
  it("names a month and a day in British English", () => {
    expect(fmtMonth("2026-03")).toBe("March 2026");
    expect(fmtDay("2026-03-14")).toBe("14 Mar 2026");
  });
  it("shows a resolution time in the largest sensible unit", () => {
    const min = 60_000;
    expect(fmtDuration(40 * min)).toBe("40m");
    expect(fmtDuration(5 * 60 * min)).toBe("5h");
    expect(fmtDuration((3 * 24 + 4) * 60 * min)).toBe("3d 4h");
    expect(fmtDuration(2 * 24 * 60 * min)).toBe("2d");
    expect(fmtDuration(-1)).toBe("—");
  });
});

describe("chargedWork (FS-REQ-54)", () => {
  const report = (id: string, estimate: number | null) => ({ id, resolved_at: "2026-03-10T09:00:00", estimate_hours: estimate });

  it("charges a report its own estimate until requirements are raised from it", () => {
    expect(chargedWork([report("a", 3)], [{ feedback_id: "other", estimate_hours: 8 }])).toEqual([
      { resolved_at: "2026-03-10T09:00:00", estimate_hours: 3 },
    ]);
  });

  it("then charges the sum of those requirements' estimates instead", () => {
    const reqs = [
      { feedback_id: "a", estimate_hours: 2.5 },
      { feedback_id: "a", estimate_hours: null },
      { feedback_id: "a", estimate_hours: 4 },
    ];
    expect(chargedWork([report("a", 3)], reqs)[0].estimate_hours).toBe(6.5);
  });

  it("has nothing to charge when no raised requirement is estimated", () => {
    expect(chargedWork([report("a", 3)], [{ feedback_id: "a", estimate_hours: null }])[0].estimate_hours).toBeNull();
  });
});

describe("awaitingConfirmation", () => {
  const report = (id: string, status: string, estimate_hours: number | null) => ({ id, status, resolved_at: null, estimate_hours });

  it("sums only the reports waiting for the client to confirm", () => {
    const out = awaitingConfirmation(
      [report("a", "EstimatedToConfirm", 1.5), report("b", "EstimatedToConfirm", 0.2), report("c", "New", 9), report("d", "Resolved", 4)],
      [],
    );
    expect(out).toEqual({ hours: 1.7, count: 2, unestimated: 0 });
  });

  it("charges raised requirements in place of the report, as the log will", () => {
    const out = awaitingConfirmation(
      [report("a", "EstimatedToConfirm", 1)],
      [{ feedback_id: "a", estimate_hours: 3 }, { feedback_id: "a", estimate_hours: 2 }],
    );
    expect(out.hours).toBe(5);
  });

  it("counts a waiting report with nothing to charge", () => {
    expect(awaitingConfirmation([report("a", "EstimatedToConfirm", null)], [])).toEqual({ hours: 0, count: 1, unestimated: 1 });
  });
});

describe("actual hours", () => {
  it("charges a resolved report its actual hours over its estimate", () => {
    const [w] = chargedWork([{ id: "a", resolved_at: "2026-10-01", estimate_hours: 2, actual_hours: 3.5 }], []);
    expect(w.estimate_hours).toBe(3.5);
  });

  it("falls back to the estimate while no actual is recorded", () => {
    const [w] = chargedWork([{ id: "a", resolved_at: "2026-10-01", estimate_hours: 2, actual_hours: null }], []);
    expect(w.estimate_hours).toBe(2);
  });

  it("charges each raised requirement its actual else its estimate", () => {
    const [w] = chargedWork(
      [{ id: "a", resolved_at: "2026-10-01", estimate_hours: 9, actual_hours: 9 }],
      [
        { feedback_id: "a", estimate_hours: 2, actual_hours: 1 },
        { feedback_id: "a", estimate_hours: 3, actual_hours: null },
      ],
    );
    expect(w.estimate_hours).toBe(4);
  });

  it("keeps the figure awaiting confirmation on estimates", () => {
    const out = awaitingConfirmation(
      [{ id: "a", status: "EstimatedToConfirm", resolved_at: null, estimate_hours: 2, actual_hours: 5 }],
      [],
    );
    expect(out.hours).toBe(2);
  });
});
