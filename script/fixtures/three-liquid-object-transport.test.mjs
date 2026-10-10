import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeAdmission } from './liquid-object-transport-native-client.mjs';
const cli = process.env.LIQUID_TRANSPORT_NATIVE_CLI, esbuildPath = process.env.LIQUID_ESBUILD_MODULE;
if (!cli || !esbuildPath) throw Error('Requires actual LIQUID_TRANSPORT_NATIVE_CLI and existing LIQUID_ESBUILD_MODULE');
const esbuild = await import(pathToFileURL(esbuildPath).href);
async function module(entry) {
  const build = await esbuild.build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false,
    platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}
const { createThreeLiquidObjectTransport } = await module(new URL('../../apps/cli/src/programmatic/engines/three-liquid-object-transport.ts', import.meta.url));
const codec = await module(new URL('../../apps/cli/src/programmatic/engines/three-liquid-object-transport-codec.ts', import.meta.url));
const policyJson = execFileSync(cli, ['policy'], { encoding: 'utf8', windowsHide: true }).trim();
const policy = JSON.parse(policyJson);
const frame = { sessionId: 'actual-native-ts-host', index: 5, time: 1.25, seed: 19 };
const request = delta => JSON.stringify({ version: 1, params: { version: 1 }, positions: [-1, 0, 0, 1, 0, 0, 0, 1, 0],
  time: frame.time, seed: frame.seed, ...delta });
async function fixture(customEvaluate) {
  const admission = await nativeAdmission(cli, frame), controller = new AbortController();
  let evaluations = 0;
  const evaluate = async (envelope, signal) => {
    evaluations++; signal.throwIfAborted();
    if (customEvaluate) return customEvaluate(envelope, signal);
    const wire = JSON.parse(envelope);
    const payloadJson = execFileSync(cli, ['evaluate'], { input: wire.payloadJson, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    return JSON.stringify({ version: 1, identity: wire.identity, payloadJson });
  };
  const transport = createThreeLiquidObjectTransport({ frameJson: JSON.stringify(frame), policyJson,
    admission, evaluate, signal: controller.signal });
  return { admission, controller, transport, get evaluations() { return evaluations; } };
}
test('actual persistent Rust reservations precede wire encoding/evaluation and account exact UTF-8 reply bytes', async () => {
  const f = await fixture(); await f.transport.open();
  const result = JSON.parse(await f.transport.evaluate(request())); assert.equal(result.ok, true);
  const reserved = f.admission.observations.find(item => item.command.operation === 'reserve');
  const settled = f.admission.observations.find(item => item.command.operation === 'settle');
  assert(reserved.reply.reservation.maxResponseJsonBytes > settled.command.responseJsonBytes);
  assert.equal(reserved.reply.totals.requests, 1); assert.equal(settled.reply.totals.vertices, 3);
  assert(settled.reply.totals.retainedPayloadBytes >= reserved.reply.totals.retainedPayloadBytes);
  await f.transport.close(); f.transport.check(); await f.transport.dispose();
});
test('codec predicts exact encoded UTF-8 bytes without materializing escaped payload before reserve', () => {
  for (const value of ['雪', '😀', '\u0000\n\\"', '\ud800']) {
    const json = request({ params: { version: 1, transportByteTest: value } });
    const prepared = codec.prepareLiquidTransportRequest({ requestJson: json, identity: { frame, requestId: 1 }, policy });
    assert.equal(prepared.requestJsonBytes, Buffer.byteLength(json));
    assert.equal(prepared.requestEnvelopeBytes, Buffer.byteLength(prepared.encode()));
  }
});
test('non-text getter/proxy payload never supplies pre-admission metadata', async () => {
  const f = await fixture(); await f.transport.open(); let accessed = 0;
  const hostile = new Proxy({}, { get() { accessed++; throw Error('getter ran'); }, ownKeys() { accessed++; throw Error('proxy ran'); } });
  await assert.rejects(f.transport.evaluate(hostile), /UTF-8 byte/);
  assert.equal(accessed, 0); assert.equal(f.evaluations, 0);
  await assert.rejects(f.transport.evaluate(request())); await assert.rejects(f.transport.dispose());
});
test('actual Rust whole-frame cumulative mesh admission stops further evaluations and cannot be reset', async () => {
  const f = await fixture(); await f.transport.open();
  for (let i = 0; i < policy.maxMeshesPerFrame; i++) await f.transport.evaluate(request());
  await assert.rejects(f.transport.evaluate(request()), /admission rejected/);
  assert.equal(f.evaluations, policy.maxMeshesPerFrame);
  await assert.rejects(f.transport.evaluate(request())); await assert.rejects(f.transport.open());
  await assert.rejects(f.transport.dispose());
});
test('wrong reply identity rejects terminal while real Rust keeps its pending reservation', async () => {
  const f = await fixture(envelope => {
    const wire = JSON.parse(envelope); wire.identity.frame.seed++;
    return JSON.stringify({ version: 1, identity: wire.identity, payloadJson: '{}' });
  });
  await f.transport.open(); await assert.rejects(f.transport.evaluate(request()), /identity mismatch/);
  await assert.rejects(f.transport.evaluate(request()));
  const reserve = f.admission.observations.find(item => item.command.operation === 'reserve');
  assert.equal(reserve.reply.pending, true); assert.equal(reserve.reply.totals.requests, 1);
  await assert.rejects(f.transport.dispose());
});
test('abort after actual Rust reserve cannot refund it or accept a late native response', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(envelope => { started(); return new Promise(resolve => { finish = () => resolve(envelope); }); });
  await f.transport.open(); const pending = f.transport.evaluate(request()); await ready;
  f.controller.abort(new Error('cancel retained request')); await assert.rejects(pending, /cancel retained/);
  await assert.rejects(f.transport.evaluate(request())); finish(); await assert.rejects(f.transport.dispose());
  assert.equal(f.admission.observations.filter(item => item.command.operation === 'reserve').length, 1);
});
