#!/usr/bin/env node
/**
 * Local load test (phase 10): autocannon against a running server.
 * Usage: node scripts/load-test.mjs <baseUrl> <orgSlug> <eventSlug> [seconds] [connections]
 * Read-only public surfaces only (no orders are created). Prints p50 / p97.5 / p99 and req/s.
 */
import autocannon from "autocannon";

const [base = "http://localhost:3000", org, event, seconds = "15", connections = "20"] = process.argv.slice(2);
if (!org || !event) {
  console.error("usage: node scripts/load-test.mjs <baseUrl> <orgSlug> <eventSlug> [seconds] [connections]");
  process.exit(2);
}
const targets = [
  { name: "health (API, DB ping)", url: `${base}/api/v1/health` },
  { name: "ticket types (public API)", url: `${base}/api/v1/public/organizations/${org}/events/${event}/ticket-types` },
  { name: "event page (public HTML, SSR)", url: `${base}/${org}/${event}` },
  { name: "sign-in page (HTML)", url: `${base}/connexion` },
];
const rows = [];
for (const t of targets) {
  const r = await autocannon({
    url: t.url,
    connections: Number(connections),
    duration: Number(seconds),
    pipelining: 1,
  });
  rows.push({
    target: t.name,
    "req/s": Math.round(r.requests.average),
    "p50 ms": r.latency.p50,
    "p97.5 ms": r.latency.p97_5,
    "p99 ms": r.latency.p99,
    "max ms": r.latency.max,
    "2xx": r["2xx"],
    "non-2xx": r.non2xx,
    errors: r.errors,
  });
}
// biome-ignore lint/suspicious/noConsole: CLI output
console.table(rows);
