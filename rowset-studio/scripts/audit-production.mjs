import { spawnSync } from "node:child_process";

/* global process, console */

// GHSA-qwww-vcr4-c8h2 affects React Router's RSC server-action mode. Rowset
// Studio is a static Vite SPA embedded in the Go binary: it has no RSC
// runtime, actions, loaders, or React Router server. Keep this exact advisory
// visible and acknowledged while still failing CI on every other high or
// critical production advisory. Remove the exception when upstream publishes
// a compatible patched 7.x release.
const acknowledged = new Set(["https://github.com/advisories/GHSA-qwww-vcr4-c8h2"]);
const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (!result.stdout) {
  process.stderr.write(result.stderr || "npm audit produced no JSON output\n");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch (error) {
  process.stderr.write(`could not parse npm audit JSON: ${error}\n`);
  process.exit(1);
}

if (report.error || !report.vulnerabilities) {
  process.stderr.write(`npm audit failed: ${report.message ?? "missing vulnerability data"}\n`);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities;
const checked = new Map();
function hasUnacknowledgedIssue(name, stack = new Set()) {
  if (checked.has(name)) return checked.get(name);
  if (stack.has(name)) return true;
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !["high", "critical"].includes(vulnerability.severity)) {
    checked.set(name, false);
    return false;
  }
  const nextStack = new Set(stack).add(name);
  const unacknowledged = vulnerability.via.some((cause) => {
    if (typeof cause === "string") return hasUnacknowledgedIssue(cause, nextStack);
    return !acknowledged.has(cause.url);
  });
  checked.set(name, unacknowledged);
  return unacknowledged;
}

const failures = Object.keys(vulnerabilities).filter((name) => hasUnacknowledgedIssue(name));
if (failures.length > 0) {
  process.stderr.write(`unacknowledged high/critical production advisories: ${failures.join(", ")}\n`);
  process.exit(1);
}

const activeAcknowledgements = Object.values(vulnerabilities)
  .flatMap((vulnerability) => vulnerability.via)
  .filter((cause) => typeof cause !== "string" && acknowledged.has(cause.url));
console.log(`production dependency audit passed (${activeAcknowledgements.length} acknowledged non-applicable RSC advisory)`);
