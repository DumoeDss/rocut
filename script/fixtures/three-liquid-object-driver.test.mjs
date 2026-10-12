import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
const esbuildPath = process.env.LIQUID_ESBUILD_MODULE;
if (!esbuildPath) throw new Error('Set LIQUID_ESBUILD_MODULE to an existing esbuild module');
const esbuild = await import(pathToFileURL(esbuildPath).href);
const bundle = async entry => {
  const built = await esbuild.build({ entryPoints: [fileURLToPath(entry)], bundle: true,
    write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const driver = await bundle(new URL('../../apps/cli/src/programmatic/engines/three-liquid-object-driver.ts', import.meta.url));
const runPhase = new Function(`${driver.THREE_LIQUID_OBJECT_PHASE_DRIVER};return runLiquidObjectPhase;`)();
const frame = Object.freeze({ index: 5, time: 1.25, seed: 19 });
// Transport double only. It does not claim production worker, identity or Rust budget admission.
function runtime(evaluate, bound = frame) {
  let reject, terminal;
  const failure = new Promise((_, fail) => { reject = fail; }); failure.catch(() => {});
  return { failure, get terminal() { return terminal; }, fail(error) { terminal ??= error; reject(terminal); },
    async runPhase(callback) { return callback({ frame: bound, evaluate }); } };
}
test('facade binds mapped time/seed, hides service and rejects use after closed phase', async () => {
  let saved, request;
  const host = runtime(async input => { request = input; return 'Rust JSON'; });
  await runPhase({ async liquidFrame({ frame: bound, liquid }) {
    assert(Object.isFrozen(bound)); assert(Object.isFrozen(liquid));
    assert.deepEqual(Object.keys(liquid), ['deformRest']); saved = liquid;
    assert.equal(await liquid.deformRest({ params: { version: 1 }, positions: [0, 0, 0] }), 'Rust JSON');
  } }, host, frame, new AbortController().signal);
  assert.equal(request.time, frame.time); assert.equal(request.seed, frame.seed);
  assert.equal(JSON.stringify(request), JSON.stringify({ version: 1, params: { version: 1 },
    positions: [0, 0, 0], time: frame.time, seed: frame.seed }));
  await assert.rejects(saved.deformRest({ params: {}, positions: [] }), /outside/);
  assert(host.terminal);
});
test('caller clocks and mismatched host frames cannot select a request', async () => {
  let calls = 0;
  const evaluate = async () => { calls++; return ''; };
  await assert.rejects(runPhase({ async liquidFrame({ liquid }) {
    await liquid.deformRest({ params: {}, positions: [], time: 999 });
  } }, runtime(evaluate), frame, new AbortController().signal), /only params/);
  await assert.rejects(runPhase({ liquidFrame() {} }, runtime(evaluate, { ...frame, seed: 20 }),
    frame, new AbortController().signal), /does not match/);
  assert.equal(calls, 0);
});
test('two rest chunks forward the same root-space domain without overriding trusted phase', async () => {
  const domain = { min: [-2, -1, -3], max: [4, 5, 6] }, requests = [];
  const host = runtime(async request => { requests.push(request); return 'Rust JSON'; });
  await runPhase({ async liquidFrame({ liquid }) {
    for (const positions of [[-2, -1, -3], [4, 5, 6]])
      await liquid.deformRest({ params: { version: 1 }, positions, domain });
  } }, host, frame, new AbortController().signal);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.strictEqual(request.domain, domain);
    assert.equal(request.time, frame.time); assert.equal(request.seed, frame.seed);
    assert.deepEqual(Object.keys(request), ['version', 'params', 'positions', 'time', 'seed', 'domain']);
  }
});
test('malformed domain and caller timing/extra keys fail closed before Host evaluation', async () => {
  const good = { min: [0, 0, 0], max: [1, 1, 1] };
  const sparse = [0, , 0], extra = [0, 0, 0]; extra.extra = 1;
  const symbolDomain = { ...good, [Symbol('extra')]: true };
  const invalid = [undefined, null, [], 3, { min: [0, 0, 0] }, { ...good, extra: 1 },
    symbolDomain, { min: [0, 0], max: good.max }, { min: [0, 0, 0, 0], max: good.max },
    { min: [0, '0', 0], max: good.max }, { min: [0, NaN, 0], max: good.max },
    { min: good.min, max: [0, Infinity, 0] }, { min: sparse, max: good.max },
    { min: extra, max: good.max }, { min: new Float32Array(3), max: good.max }];
  let calls = 0;
  for (const domain of invalid) {
    const host = runtime(async () => { calls++; return ''; });
    await assert.rejects(runPhase({ async liquidFrame({ liquid }) {
      await liquid.deformRest({ params: {}, positions: [], domain });
    } }, host, frame, new AbortController().signal), /domain requires/);
    assert(host.terminal);
  }
  for (const extra of [{ time: 9 }, { seed: 99 }, { version: 1 }, { [Symbol('extra')]: 1 }])
    await assert.rejects(runPhase({ async liquidFrame({ liquid }) {
      await liquid.deformRest({ params: {}, positions: [], domain: good, ...extra });
    } }, runtime(async () => { calls++; return ''; }), frame, new AbortController().signal), /only params/);
  assert.equal(calls, 0);
});
test('domain geometric authority stays in Rust rather than the facade', async () => {
  let request;
  await runPhase({ async liquidFrame({ liquid }) {
    await liquid.deformRest({ params: {}, positions: [99, 0, 0],
      domain: { min: [2, 0, 0], max: [1, 0, 0] } });
  } }, runtime(async value => { request = value; return 'Rust rejection JSON'; }), frame, new AbortController().signal);
  assert.deepEqual(request.domain, { min: [2, 0, 0], max: [1, 0, 0] });
});
test('forgotten pending requests fail the frame and late completion cannot succeed', async () => {
  let finish, pending;
  const host = runtime(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(runPhase({ liquidFrame({ liquid }) {
    pending = liquid.deformRest({ params: {}, positions: [] });
  } }, host, frame, new AbortController().signal), /still pending/);
  finish('late'); await assert.rejects(pending);
  assert(host.terminal);
});
test('abort closes active phase before a late Host reply', async () => {
  let finish, pending, started;
  const ready = new Promise(resolve => { started = resolve; });
  const host = runtime(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const controller = new AbortController();
  const running = runPhase({ async liquidFrame({ liquid }) {
    pending = liquid.deformRest({ params: {}, positions: [] }); await pending;
  } }, host, frame, controller.signal);
  await ready; controller.abort(new Error('cancelled CPU probe'));
  await assert.rejects(running, /cancelled/);
  finish('late'); await assert.rejects(pending);
});
test('driver cleanup retains late createScene ownership and disposes author/assets/renderer exactly once', async () => {
  let finish, started, cleanupCallback, cleanupPromise, settled = false;
  const ready = new Promise(resolve => { started = resolve; });
  const counts = { author: 0, assets: 0, renderer: 0, context: 0, canvas: 0 };
  const host = runtime(async () => '');
  host.registerCleanup = callback => { cleanupCallback = callback; };
  host.cleanup = () => cleanupPromise ??= Promise.resolve().then(cleanupCallback);
  host.check = async () => { if (host.terminal) throw host.terminal; };
  const window = { __rocutThreeSpec: { width: 640, height: 360 } };
  class Renderer {
    setPixelRatio() {} setSize() {} setClearColor() {} setAnimationLoop() {}
    dispose() { counts.renderer++; } forceContextLoss() { counts.context++; }
  }
  const driverBody = driver.THREE_LIQUID_OBJECT_FRAME_DRIVER.slice(driver.THREE_LIQUID_OBJECT_FRAME_DRIVER.indexOf('const spec=window.__rocutThreeSpec;'));
  runInNewContext(driver.THREE_LIQUID_OBJECT_PHASE_DRIVER + driverBody, {
    window, claimLiquidObjectRuntime: () => host, AbortController, THREE: { WebGLRenderer: Renderer },
    document: { createElement: () => ({ style: {}, remove() { counts.canvas++; } }), body: { append() {} } },
    createAssets: () => ({ api: {}, async dispose() { counts.assets++; } }),
    createScene: () => { started(); return new Promise(resolve => { finish = resolve; }); },
  });
  const rendered = window.rocut.renderFrame(frame);
  rendered.then(() => { settled = true; }, () => { settled = true; });
  await ready; host.fail(new Error('Host cancelled while author creation pending'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(counts.author, 0);
  finish({ scene: { isScene: true }, camera: { isCamera: true }, dispose() { counts.author++; } });
  await assert.rejects(rendered, /cancelled|cleanup/);
  await host.cleanup();
  assert.deepEqual(counts, { author: 1, assets: 1, renderer: 1, context: 1, canvas: 1 });
});
test('actual Rust plus actual Three185 async author hook deforms/restores and disposes', {
  skip: !(process.env.LIQUID_NATIVE_CLI && process.env.LIQUID_THREE_MODULE) && 'Requires real Rust CLI and existing Three module'
}, async () => {
  const THREE = await import(pathToFileURL(process.env.LIQUID_THREE_MODULE).href);
  assert.equal(THREE.REVISION, '185');
  const scene = await bundle(new URL('../../../../elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/liquid-object-scene.ts', import.meta.url));
  const native = (input, mode) => execFileSync(process.env.LIQUID_NATIVE_CLI, mode ? [mode] : [],
    { input, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
  const params = JSON.parse(native('{"version":1}', 'params')).params;
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(2, 2, 2, 2, 2, 2);
  const mesh = new THREE.Mesh(geometry); root.add(mesh);
  const rest = Array.from(geometry.getAttribute('position').array);
  const controller = new AbortController();
  const author = await scene.createScene({ THREE, assets: { model: async () => ({ value: root }) },
    renderer: { getSize: size => size.set(640, 360) }, signal: controller.signal,
    inputProps: { modelId: 'actual-cpu.glb', liquid: params } });
  const initial = Array.from(mesh.geometry.getAttribute('position').array);
  assert.equal(initial.length, rest.length);
  // Identity geometry transforms may canonicalize signed zero. Ordinary
  // coordinates remain exactly equal, including every nonzero component.
  assert(initial.every((value, index) => value === rest[index]));
  const host = runtime(async request => native(JSON.stringify(request)));
  await runPhase(author, host, frame, controller.signal);
  assert.notDeepEqual(Array.from(mesh.geometry.getAttribute('position').array), rest);
  params.enabled = false;
  await runPhase(author, runtime(async request => native(JSON.stringify(request))), frame, controller.signal);
  assert.strictEqual(mesh.geometry, geometry);
  params.enabled = true;
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const delayed = runtime(request => {
    const actualRustResult = native(JSON.stringify(request)); started();
    return new Promise(resolve => { finish = () => resolve(actualRustResult); });
  });
  const late = runPhase(author, delayed, frame, controller.signal);
  await ready; controller.abort(new Error('cancel while Rust reply retained'));
  await assert.rejects(late, /cancel/);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(mesh.geometry, geometry);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), rest);
  controller.abort(); author.dispose(); assert.strictEqual(mesh.geometry, geometry);
  geometry.dispose();
});
test('actual Three cleanup failure still restores every borrowed geometry', {
  skip: !process.env.LIQUID_THREE_MODULE && 'Requires existing actual Three module'
}, async () => {
  const THREE = await import(pathToFileURL(process.env.LIQUID_THREE_MODULE).href);
  const { attachLiquidObjectPhase } = await import(new URL('../../../../elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/liquid-object-geometry.mjs', import.meta.url));
  const root = new THREE.Group(), original = new THREE.BoxGeometry();
  const a = new THREE.Mesh(original), b = new THREE.Mesh(original); root.add(a, b);
  const owner = attachLiquidObjectPhase({ root, params: { version: 1 } });
  let second = 0;
  a.geometry.addEventListener('dispose', () => { throw new Error('forced first dispose failure'); });
  b.geometry.addEventListener('dispose', () => { second++; });
  assert.throws(() => owner.dispose(), /cleanup failed/);
  assert.strictEqual(a.geometry, original); assert.strictEqual(b.geometry, original);
  assert.equal(second, 1); owner.dispose(); assert.equal(second, 1); original.dispose();
});
