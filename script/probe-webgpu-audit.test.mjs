import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { installWebGpuAudit } from "./probe-webgpu-audit.mjs";

function fixture(weakRefType) {
	return runInNewContext(
		`
		class GPUTexture { destroy() {} }
		class GPUBuffer { destroy() {} }
		class GPUDevice {
			lost = new Promise(() => {});
			queue = {onSubmittedWorkDone: async () => {}};
			createTexture(desc) { if (desc.fail) throw new Error("invalid texture"); return new GPUTexture(); }
			createBuffer() { return new GPUBuffer(); }
			destroy() {}
		}
		Object.assign(globalThis, {GPUTexture, GPUBuffer, GPUDevice});
		const original = GPUDevice.prototype.createTexture;
		(${installWebGpuAudit.toString()})();
		({audit: __rocutGpuAudit, device: new GPUDevice(), GPUDevice, original});
	`,
		weakRefType ? { WeakRef: weakRefType } : {},
	);
}

test("resource create/destroy counts actual calls once and preserves return values", async () => {
	const { audit, device } = fixture();
	const texture = device.createTexture({});
	const buffer = device.createBuffer({});
	assert.equal(audit.snapshot().texture.live, 1);
	texture.destroy();
	texture.destroy();
	buffer.destroy();
	await audit.settle();
	const state = audit.snapshot();
	assert.equal(state.texture.created, 1);
	assert.equal(state.texture.destroyed, 1);
	assert.equal(state.texture.live, 0);
	assert.equal(state.buffer.live, 0);
});

test("missing destroy negative control is observable, never silently classified as released", () => {
	const { audit, device } = fixture();
	for (let i = 0; i < 40; i++) device.createTexture({});
	assert.equal(audit.snapshot().texture.live, 40);
	assert.equal(audit.snapshot().texture.destroyed, 0);
});

test("device destruction attributes remaining resources to owner release without double counting", () => {
	const { audit, device } = fixture();
	const texture = device.createTexture({});
	device.createBuffer({});
	device.destroy();
	device.destroy();
	texture.destroy();
	const state = audit.snapshot();
	assert.equal(state.devicesDestroyed, 1);
	assert.equal(state.texture.ownerReleased, 1);
	assert.equal(state.texture.destroyed, 0);
	assert.equal(state.texture.live, 0);
	assert.equal(state.buffer.live, 0);
});

test("native errors propagate and failed creation is not counted", () => {
	const { audit, device } = fixture();
	assert.throws(() => device.createTexture({ fail: true }), /invalid texture/);
	assert.equal(audit.snapshot().texture.created, 0);
});

test("restoration reinstates native methods", () => {
	const { audit, GPUDevice, original } = fixture();
	assert.notEqual(GPUDevice.prototype.createTexture, original);
	audit.restore();
	assert.equal(GPUDevice.prototype.createTexture, original);
});

test("collected wrappers are distinguished from destroy calls and owner release", () => {
	const refs = [];
	class ControlledWeakRef {
		constructor(target) {
			this.target = target;
			refs.push(this);
		}
		deref() {
			return this.target;
		}
	}
	const { audit, device } = fixture(ControlledWeakRef);
	const texture = device.createTexture({});
	assert.equal(audit.snapshot().texture.live, 1);
	refs.find((ref) => ref.target === texture).target = undefined;
	assert.equal(audit.snapshot().texture.live, 0);
	assert.equal(audit.snapshot().texture.collectedWithoutDestroy, 1);
	device.destroy();
	const state = audit.snapshot().texture;
	assert.equal(state.ownerReleased, 0);
	assert.equal(state.destroyed, 0);
	assert.equal(state.created, state.collectedWithoutDestroy);
});
