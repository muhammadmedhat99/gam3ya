import { describe, expect, it } from "vitest";
import { addMonths, formatDate, formatLongDate, todayInCairo } from "./dates";
import { buildSchedule, currentCycleNumber } from "./schedule";

describe("buildSchedule", () => {
  it("monthly, design example: start 1 Jan 2027, due day 5, 10 cycles", () => {
    const s = buildSchedule({ startDate: "2027-01-01", frequency: "monthly", dueDay: 5, cycles: 10 });
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({ number: 1, startsOn: "2027-01-01", dueOn: "2027-01-05" });
    expect(s[9]).toEqual({ number: 10, startsOn: "2027-10-01", dueOn: "2027-10-05" });
  });

  it("monthly: due day before the start day falls in the next month", () => {
    const s = buildSchedule({ startDate: "2027-01-20", frequency: "monthly", dueDay: 5, cycles: 2 });
    expect(s.map((c) => c.dueOn)).toEqual(["2027-02-05", "2027-03-05"]);
  });

  it("every 15 days counted exactly from the start", () => {
    const s = buildSchedule({ startDate: "2027-01-01", frequency: "semi_monthly", dueDay: 0, cycles: 3 });
    expect(s.map((c) => c.startsOn)).toEqual(["2027-01-01", "2027-01-16", "2027-01-31"]);
    expect(s.map((c) => c.dueOn)).toEqual(["2027-01-01", "2027-01-16", "2027-01-31"]);
  });
});

describe("currentCycleNumber", () => {
  const s = buildSchedule({ startDate: "2027-01-01", frequency: "monthly", dueDay: 5, cycles: 10 });
  it.each([
    ["2026-12-31", 0],
    ["2027-01-01", 1],
    ["2027-03-07", 3],
    ["2028-05-01", 10],
  ])("%s → cycle %i", (today, n) => {
    expect(currentCycleNumber(s, today)).toBe(n);
  });
});

describe("dates", () => {
  it("clamps month ends", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
  });

  it("formats in Arabic with Western digits", () => {
    expect(formatDate("2027-03-05")).toBe("5 مارس 2027");
    expect(formatLongDate("2027-03-07")).toBe("الأحد، 7 مارس 2027");
  });

  it("gives today in Cairo", () => {
    // 23:30 UTC on 1 Jan is already 2 Jan in Cairo (UTC+2).
    expect(todayInCairo(new Date("2027-01-01T23:30:00Z"))).toBe("2027-01-02");
  });
});
