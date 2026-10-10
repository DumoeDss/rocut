import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.INK_REVIEW_THREE_MODULE;
if (!modulePath) throw new Error('Set INK_REVIEW_THREE_MODULE to existing target Three module');
const THREE = await import(pathToFileURL(modulePath).href);
assert.equal(THREE.REVISION, '185');
const source = readFileSync(new URL('../../../../elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/ink-object-scene.ts', import.meta.url), 'utf8');
const { createScene } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const ink = { version: 1, contourWidth: 2, inkDensity: .85, paperTexture: .15,
  paperScale: 32, seed: 19, inkColor: '#182026', paperColor: '#f2ead8' };
async function scene(material, configure = () => {}) {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  configure(mesh);
  root.add(mesh);
  const controller = new AbortController();
  const result = await createScene({ THREE, assets: { model: async () => ({ value: root }) },
    inputProps: { ink, modelId: 'fixture.glb', scale: 1, rotation: [0, 0, 0], rotationSpeed: [0, 0, 0],
      camera: { position: [0, 0, 4], target: [0, 0, 0], fov: 37, near: .1, far: 100 } },
    renderer: { getSize: value => value.set(640, 360) }, signal: controller.signal, frame: { time: 0 } });
  return { result, mesh, root, controller };
}
test('target185 actual Standard/Physical fragment seam exists and hook preserves final color chunks', async () => {
  for (const Type of [THREE.MeshStandardMaterial, THREE.MeshPhysicalMaterial]) {
    const original = new Type();
    const { result, mesh } = await scene(original);
    const shader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
    mesh.material.onBeforeCompile(shader);
    assert(shader.fragmentShader.includes('outgoingLight = mix(paper, inkColor, coverage);'));
    assert(shader.fragmentShader.includes('#include <opaque_fragment>'));
    assert(shader.fragmentShader.includes('#include <tonemapping_fragment>'));
    assert(shader.fragmentShader.includes('#include <colorspace_fragment>'));
    result.dispose(); mesh.geometry.dispose(); original.dispose();
  }
});
test('counterexample: alphaHash material is admitted although contour cannot follow its alpha cutouts', async () => {
  const original = new THREE.MeshStandardMaterial({ alphaHash: true });
  const { result, mesh } = await scene(original);
  assert.equal(mesh.material.alphaHash, true);
  assert.equal(mesh.children[0].material.alphaHash, false);
  assert.equal(mesh.children[0].visible, true);
  result.dispose(); assert.strictEqual(mesh.material, original);
  mesh.geometry.dispose(); original.dispose();
});
test('counterexample: hidden material produces visible contour geometry', async () => {
  const original = new THREE.MeshStandardMaterial({ visible: false });
  const { result, mesh } = await scene(original);
  assert.equal(mesh.material.visible, false);
  assert.equal(mesh.children[0].material.visible, true);
  assert.equal(mesh.children[0].visible, true);
  result.dispose(); assert.strictEqual(mesh.material, original);
  mesh.geometry.dispose(); original.dispose();
});
test('counterexample: contour ignores source mesh camera-layer exclusion', async () => {
  const original = new THREE.MeshStandardMaterial();
  const { result, mesh } = await scene(original, node => node.layers.set(1));
  assert.equal(result.camera.layers.test(mesh.layers), false);
  assert.equal(result.camera.layers.test(mesh.children[0].layers), true);
  result.dispose(); mesh.geometry.dispose(); original.dispose();
});
