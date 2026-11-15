import { addDays, addMonths } from "./dates";

/** BUSINESS_RULES.md §3 and DATABASE.md §10: monthly, or every 15 days from the start date. */
export type Frequency = "monthly" | "semi_monthly";

export const SEMI_MONTHLY_DAYS = 15;

export interface ScheduleInput {
  startDate: string;
  frequency: Frequency;
  /** monthly: day of month 1–28; semi_monthly: days after the cycle start 0–14. */
  dueDay: number;
  cycles: number;
}

export interface CycleDates {
  number: number;
  startsOn: string;
  dueOn: string;
}

/** Cycle N pays the slot at payout position N, so this is also the payout calendar. */
export function buildSchedule({ startDate, frequency, dueDay, cycles }: ScheduleInput): CycleDates[] {
  return Array.from({ length: cycles }, (_, i) => {
    if (frequency === "semi_monthly") {
      const startsOn = addDays(startDate, SEMI_MONTHLY_DAYS * i);
      return { number: i + 1, startsOn, dueOn: addDays(startsOn, dueDay) };
    }
    const startsOn = addMonths(startDate, i);
    // The first `dueDay` on or after the cycle start.
    const sameMonth = `${startsOn.slice(0, 8)}${String(dueDay).padStart(2, "0")}`;
    const dueOn = sameMonth >= startsOn ? sameMonth : addMonths(sameMonth, 1);
    return { number: i + 1, startsOn, dueOn };
  });
}

/** 1-based number of the cycle running on `today`, 0 before the start, capped at the last. */
export function currentCycleNumber(schedule: CycleDates[], today: string): number {
  let current = 0;
  for (const cycle of schedule) {
    if (cycle.startsOn <= today) current = cycle.number;
  }
  return current;
}
