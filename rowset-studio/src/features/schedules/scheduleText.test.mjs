import assert from "node:assert/strict";
import test from "node:test";
import { describeSchedule } from "./scheduleText.ts";

test("describes each kind of schedule", () => {
  assert.equal(describeSchedule({ kind: "daily", time: "10:00", timezone: "Europe/Istanbul" }), "Every day at 10:00 · Europe/Istanbul");
  assert.equal(describeSchedule({ kind: "weekly", time: "09:30", days: [5, 1, 2, 3, 4], timezone: "UTC" }), "Weekdays at 09:30 · UTC");
  assert.equal(describeSchedule({ kind: "weekly", time: "08:00", days: [6, 0], timezone: "UTC" }), "Weekends at 08:00 · UTC");
  assert.equal(describeSchedule({ kind: "weekly", time: "08:00", days: [1, 3], timezone: "UTC" }), "Mon, Wed at 08:00 · UTC");
  assert.equal(describeSchedule({ kind: "interval", everyMinutes: 120, timezone: "UTC" }), "Every 2 hours · UTC");
  assert.equal(describeSchedule({ kind: "interval", everyMinutes: 60, timezone: "UTC" }), "Every hour · UTC");
  assert.equal(describeSchedule({ kind: "interval", everyMinutes: 15, timezone: "UTC" }), "Every 15 minutes · UTC");
});
