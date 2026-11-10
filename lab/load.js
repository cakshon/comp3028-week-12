'use strict';
// Fixed request count, fixed concurrency, local destinations only.
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const target = new URL(process.argv[2] || 'http://127.0.0.1:3000/health');
const total = Number(process.argv[3] || 100);
const concurrency = Number(process.argv[4] || 10);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.protocol !== 'http:') {
  throw new Error('This classroom client accepts local HTTP targets only.');
}
if (!Number.isInteger(total) || total < 1 || total > 10000 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error('Use 1..10000 requests and 1..100 concurrent clients.');
}
let next = 0, ok = 0, httpErrors = 0, networkErrors = 0;
const latencies = [];
function request() {
  return new Promise(resolve => {
    const start = performance.now();
    let settled = false;
    const finish = success => {
      if (settled) return;
      settled = true;
      latencies.push(performance.now() - start);
      if (success === null) networkErrors++;
      else if (success) ok++;
      else httpErrors++;
      resolve();
    };
    // Fresh connections also make worker distribution easier to observe.
    const req = http.get(target, { agent: false }, res => {
      res.resume();
      res.on('end', () => finish(res.statusCode >= 200 && res.statusCode < 300));
      res.on('error', () => finish(null));
    });
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', () => finish(null));
  });
}
async function worker() { while (next++ < total) await request(); }
(async () => {
  const start = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const seconds = (performance.now() - start) / 1000;
  latencies.sort((a,b) => a-b);
  const percentile = p => latencies[Math.ceil(p * latencies.length) - 1];
  console.log(JSON.stringify({ total, concurrency, ok, httpErrors, networkErrors,
    seconds: +seconds.toFixed(3), completedPerSecond: +(total / seconds).toFixed(1),
    meanMs: +(latencies.reduce((a,b) => a+b, 0) / total).toFixed(2),
    p50ms: +percentile(.5).toFixed(2), p95ms: +percentile(.95).toFixed(2),
    p99ms: +percentile(.99).toFixed(2) }, null, 2));
})();
