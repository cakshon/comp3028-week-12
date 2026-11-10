'use strict';
const cluster = require('node:cluster');
if (cluster.isPrimary) {
  console.log(`Primary PID ${process.pid}; starting two workers`);
  let stopping = false;
  for (let i = 0; i < 2; i++) cluster.fork();
  cluster.on('exit', worker => {
    console.log(`Worker ${worker.process.pid} exited`);
    if (!stopping) cluster.fork();
  });
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const worker of Object.values(cluster.workers)) worker.process.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  require('./app');
}
