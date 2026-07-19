/**
 * Minimal cron matcher for the daily report schedule.
 *
 * Hand-rolled rather than pulled from a package: node-cron ships a background
 * daemon that resolves its worker through `__dirname`, which is undefined once
 * Nitro bundles the server to ESM. That crashed the container on boot while the
 * build itself passed, because building never executes the bundle. The need here
 * is one expression in one timezone, so a dependency is not worth that risk.
 *
 * Supports the standard 5 fields — minute hour day-of-month month day-of-week —
 * with `*`, `n`, `a-b`, `a,b,c`, `*​/n` and `a-b/n`.
 */

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Standard cron: when both day fields are restricted, either may match. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

const RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

function parseField(spec: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();

  for (const part of spec.split(",")) {
    if (!part) return null;
    const [rangePart, stepPart] = part.split("/");
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (step < 1) return null;

    let lo: number;
    let hi: number;

    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
      lo = Number(a);
      hi = Number(b);
    } else {
      if (!/^\d+$/.test(rangePart)) return null;
      lo = Number(rangePart);
      // `n/step` counts up from n to the end of the field — a standard extension.
      hi = stepPart === undefined ? lo : max;
    }

    // Day-of-week 7 is a second spelling of Sunday.
    if (max === 6) {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }

  return values.size ? values : null;
}

export function parseCron(expression: string): CronFields | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsed = fields.map((f, i) => parseField(f, RANGES[i][0], RANGES[i][1]));
  if (parsed.some((p) => p === null)) return null;

  return {
    minute: parsed[0]!,
    hour: parsed[1]!,
    dayOfMonth: parsed[2]!,
    month: parsed[3]!,
    dayOfWeek: parsed[4]!,
    dayOfMonthRestricted: fields[2] !== "*",
    dayOfWeekRestricted: fields[4] !== "*",
  };
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}

export interface ZonedTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/**
 * Wall-clock time in the given zone. Reading it fresh on every tick is what makes
 * DST correct — Egypt observes it again, and a UTC offset captured once would
 * drift by an hour twice a year.
 */
export function zonedNow(date: Date, timeZone: string): ZonedTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Some ICU builds report midnight as hour 24 under hour12:false.
  const hour = get("hour") % 24;
  const minute = get("minute");
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { year, month, day, hour, minute, weekday };
}

export function matches(fields: CronFields, t: ZonedTime): boolean {
  if (!fields.minute.has(t.minute)) return false;
  if (!fields.hour.has(t.hour)) return false;
  if (!fields.month.has(t.month)) return false;

  const domHit = fields.dayOfMonth.has(t.day);
  const dowHit = fields.dayOfWeek.has(t.weekday);

  // Both restricted → either matching is enough. Otherwise the restricted one
  // decides, and if neither is restricted every day matches.
  if (fields.dayOfMonthRestricted && fields.dayOfWeekRestricted) return domHit || dowHit;
  if (fields.dayOfMonthRestricted) return domHit;
  if (fields.dayOfWeekRestricted) return dowHit;
  return true;
}

/** Stable key for one minute in the target zone, used to fire exactly once. */
export function minuteKey(t: ZonedTime): string {
  return `${t.year}-${t.month}-${t.day}T${t.hour}:${t.minute}`;
}
