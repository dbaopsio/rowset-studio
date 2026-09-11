export interface ScheduleSpec {
  kind: "daily" | "weekly" | "interval";
  time?: string;
  days?: number[];
  everyMinutes?: number;
  timezone: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human description of a schedule, e.g. "Weekdays at 10:00 · Europe/Istanbul". */
export function describeSchedule(spec: ScheduleSpec): string {
  let text: string;
  if (spec.kind === "interval") {
    const minutes = spec.everyMinutes ?? 0;
    text = minutes % 60 === 0 ? `Every ${minutes / 60 === 1 ? "hour" : `${minutes / 60} hours`}` : `Every ${minutes} minutes`;
  } else if (spec.kind === "daily") {
    text = `Every day at ${spec.time}`;
  } else {
    const days = [...new Set(spec.days ?? [])].sort((a, b) => a - b);
    const key = days.join(",");
    const label = key === "1,2,3,4,5" ? "Weekdays" : key === "0,6" ? "Weekends" : days.length === 7 ? "Every day" : days.map((day) => DAY_NAMES[day]).join(", ");
    text = `${label} at ${spec.time}`;
  }
  return `${text} · ${spec.timezone}`;
}

/** Local time zone of this browser, falling back to UTC. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
