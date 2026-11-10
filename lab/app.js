'use strict';
// Local teaching server. Intentionally includes one blocking route.
const http = require('node:http');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const port = Number(process.env.PORT || 3000);
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
let requests = 0, errors = 0, counter = 0;
let cache = null, pending = null;
let previousCpu = process.cpuUsage(), previousTime = performance.now();
let cpuPercent = 0;
const sampler = setInterval(() => {
  const now = performance.now();
  const used = process.cpuUsage(previousCpu);
  cpuPercent = 100 * (used.user + used.system) / ((now - previousTime) * 1000);
  previousCpu = process.cpuUsage(); previousTime = now;
}, 1000);
sampler.unref();
function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function catalogue() {
  await delay(200); // Simulated I/O, not a real database.
  return { items: ['Notebook', 'Pen'], generatedAt: new Date().toISOString() };
}
const server = http.createServer(async (req, res) => {
  const started = performance.now();
  const path = new URL(req.url, 'http://localhost').pathname;
  const measured = path !== '/metrics';
  if (measured) requests++;
  res.on('finish', () => {
    if (measured && res.statusCode >= 500) errors++;
    if (measured && process.env.LOG_REQUESTS === '1') {
      console.log(JSON.stringify({ path, status: res.statusCode,
        ms: +(performance.now() - started).toFixed(2), pid: process.pid }));
    }
  });
  try {
    if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
    if (path === '/health') return send(res, 200, { status: 'ok', pid: process.pid });
    if (path === '/fail') return send(res, 503, { error: 'Planned lab failure' });
    if (path === '/counter') return send(res, 200, { pid: process.pid, count: ++counter });
    if (path === '/blocking') {
      const until = performance.now() + 100;
      while (performance.now() < until) {} // Deliberate CPU blocking.
      return send(res, 200, { mode: 'blocking', pid: process.pid });
    }
    if (path === '/async') {
      await delay(100); // Models waiting for I/O, NOT CPU work offloaded.
      return send(res, 200, { mode: 'async-wait', pid: process.pid });
    }
    if (path === '/catalogue') return send(res, 200, await catalogue());
    if (path === '/cached') {
      if (cache && Date.now() < cache.expires) {
        return send(res, 200, { source: 'hit', ...cache.value });
      }
      // Share an in-flight read so concurrent misses do not duplicate work.
      if (!pending) pending = catalogue().then(value => {
        cache = { value, expires: Date.now() + 5000 };
        return value;
      }).finally(() => { pending = null; });
      return send(res, 200, { source: 'miss-or-coalesced', ...await pending });
    }
    if (path === '/metrics') {
      const memory = process.memoryUsage();
      return send(res, 200, { pid: process.pid, requests, errors,
        errorRate: requests ? errors / requests : 0,
        cpuPercent: +cpuPercent.toFixed(1),
        rssMiB: +(memory.rss / 1048576).toFixed(1),
        heapUsedMiB: +(memory.heapUsed / 1048576).toFixed(1),
        loopP99ms: +(histogram.percentile(99) / 1e6).toFixed(2) });
    }
    send(res, 404, { error: 'Route not found' });
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    else res.destroy();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Lab PID ${process.pid}: http://127.0.0.1:${port}`));
function shutdown() {
  server.close(() => { histogram.disable(); clearInterval(sampler); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
