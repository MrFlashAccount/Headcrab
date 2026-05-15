#!/usr/bin/env node

import { runDelegateModeHealthcheck } from "../src/healthcheck.js";

let result;

try {
  result = runDelegateModeHealthcheck();
} catch {
  result = {
    ok: false,
    checks: [{ name: "healthcheck.unhandled_exception", outcome: "FAIL" }],
    summary: { passed: 0, failed: 1 },
  };
}

for (const check of result.checks) {
  console.log(`${check.outcome} ${check.name}`);
}

console.log(`SUMMARY ${result.ok ? "PASS" : "FAIL"} passed=${result.summary.passed} failed=${result.summary.failed}`);

process.exitCode = result.ok ? 0 : 1;
