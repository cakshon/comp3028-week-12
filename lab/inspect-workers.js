'use strict';
const http = require('node:http');
const seen = new Set();
async function once() {
  await new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:3000/counter', {agent: false}, res => {
      let body = '';
      res.on('data', part => { body += part; });
      res.on('end', () => { const data = JSON.parse(body); seen.add(data.pid); console.log(data); resolve(); });
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
(async () => {
  for (let i = 0; i < 20; i++) await once();
  console.log('Distinct worker PIDs:', [...seen]);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
