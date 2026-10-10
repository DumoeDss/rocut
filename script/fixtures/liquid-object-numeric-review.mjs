import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { attachLiquidObject } from '../../../../elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/liquid-object-geometry.mjs';
const cli = process.env.LIQUID_NATIVE_CLI;
const modulePath = process.env.LIQUID_THREE_MODULE;
if (!cli || !modulePath) throw new Error('Requires actual LIQUID_NATIVE_CLI and existing LIQUID_THREE_MODULE');
const THREE = await import(pathToFileURL(modulePath).href);
assert.equal(THREE.REVISION, '185');
const native = input => execFileSync(cli, [], { input, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
const f32Max = new Float32Array([3.4028234663852886e38])[0];
const params = { version: 1, enabled: true, amount: 1, frequency: 16, speed: 16, twist: 2 };
test('finite large Float32 rest input is rejected by actual Rust before applying geometry', () => {
  for (const magnitude of [1_000_000.0625, 1e20, f32Max]) {
    assert(Number.isFinite(new Float32Array([magnitude])[0]));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([magnitude, 0, 0, 0, magnitude, 0, 0, 0, magnitude], 3));
    const original = Array.from(geometry.getAttribute('position').array);
    const mesh = new THREE.Mesh(geometry), root = new THREE.Group(); root.add(mesh);
    const owner = attachLiquidObject({ root, params, evaluateFrame: native });
    assert.throws(() => owner.update({ time: 86400, seed: 0xffffffff }), /within.*1000000/);
    assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array), original);
    assert(mesh.geometry.getAttribute('position').array.every(Number.isFinite));
    owner.dispose(); geometry.dispose();
  }
});
test('admitted rest +/-1e6 with amount/twist/time/seed boundaries stays finite after actual Float32 application', () => {
  const geometry = new THREE.BoxGeometry(2e6, 2e6, 2e6);
  const mesh = new THREE.Mesh(geometry), root = new THREE.Group(); root.add(mesh);
  const rest = Array.from(geometry.getAttribute('position').array);
  const owner = attachLiquidObject({ root, params, evaluateFrame: native });
  for (const twist of [-2, 2]) for (const time of [0, 1.25, 86400]) for (const seed of [0, 0xffffffff]) {
    params.twist = twist;
    const raw = JSON.parse(native(JSON.stringify({ version: 1, params, time, seed, positions: rest })));
    assert.equal(raw.ok, true); assert(raw.frame.positions.every(Number.isFinite));
    // Mathematical conservative bound, not a replacement admission policy.
    assert(raw.frame.positions.every(value => Math.abs(value) < 2_700_000));
    owner.update({ time, seed });
    assert(mesh.geometry.getAttribute('position').array.every(Number.isFinite));
    assert(mesh.geometry.getAttribute('position').array.every(value => Math.abs(value) < f32Max));
  }
  owner.dispose(); geometry.dispose();
});
