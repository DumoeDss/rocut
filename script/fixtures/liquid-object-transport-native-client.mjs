import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
// Test-only client of the actual persistent Rust session; never a policy double.
export async function nativeAdmission(cli, frame) {
  const child = spawn(cli, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = [], observations = [];
  let closed = false, stderrBytes = 0;
  child.stderr.on('data', data => { stderrBytes += data.length; });
  const close = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      closed = true;
      for (const pending of waiting.splice(0)) pending.reject(Error(`Native closed (${code}, stderr bytes ${stderrBytes})`));
      resolve(code);
    });
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const pending = waiting.shift(); if (!pending) throw Error('Uncorrelated native reply'); pending.resolve(line); });
  const send = json => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Native session closed')); return; }
    waiting.push({ resolve, reject }); child.stdin.write(`${json}\n`, error => { if (error) reject(error); });
  });
  const ready = JSON.parse(await send(JSON.stringify(frame)));
  if (ready.ok !== true) { child.stdin.end(); await close; throw Error('Native session init rejected'); }
  return {
    policy: ready.policy, observations,
    async command(json) {
      const reply = await send(json); observations.push({ command: JSON.parse(json), reply: JSON.parse(reply) }); return reply;
    },
    async terminate() { child.stdin.end(); await close; lines.close(); },
  };
}
