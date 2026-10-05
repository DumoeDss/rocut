// Diagnostic-only main-world instrumentation, installed before the app loads.
// Weak keys/references do not keep native resources alive. Counts describe API
// ownership, never driver allocations, GPU bytes, or uninstrumented performance.
// "live" means a still-reachable wrapper without explicit resource/device
// destruction. Collection is observed at checkpoints, not counted as destroy().
export function installWebGpuAudit() {
	const scope = globalThis;
	if (scope.__rocutGpuAudit) throw new Error("GPU audit already installed");
	const available = ["GPUDevice", "GPUTexture", "GPUBuffer"].every(
		(name) => typeof scope[name] === "function",
	);
	const resourceMeta = new WeakMap();
	let resourceRefs = [];
	const deviceMeta = new WeakMap();
	const devices = [];
	const kinds = ["texture", "buffer"];
	const empty = () => ({
		created: 0,
		destroyed: 0,
		ownerReleased: 0,
		collectedWithoutDestroy: 0,
		live: 0,
		peak: 0,
	});
	const totals = { texture: empty(), buffer: empty() };
	const lifecycle = {
		devicesObserved: 0,
		devicesDestroyed: 0,
		unexpectedLosses: 0,
	};
	const originals = [];
	function wrap(proto, key, handler) {
		const original = proto[key];
		if (typeof original !== "function")
			throw new Error("Missing GPU method: " + key);
		const wrapped = function (...args) {
			return handler.call(this, original, args);
		};
		proto[key] = wrapped;
		originals.push(() => {
			if (proto[key] === wrapped) proto[key] = original;
		});
	}
	function owner(device) {
		let row = deviceMeta.get(device);
		if (!row) {
			row = { ended: false, texture: 0, buffer: 0 };
			deviceMeta.set(device, row);
			devices.push(new WeakRef(device));
			lifecycle.devicesObserved++;
			device.lost.then((info) => {
				if (info.reason !== "destroyed") lifecycle.unexpectedLosses++;
			});
		}
		return row;
	}
	if (available) {
		for (const [kind, type, method] of [
			["texture", "GPUTexture", "createTexture"],
			["buffer", "GPUBuffer", "createBuffer"],
		]) {
			wrap(scope.GPUDevice.prototype, method, function (original, args) {
				const resource = Reflect.apply(original, this, args);
				const state = owner(this);
				const meta = { kind, state, destroyed: false };
				resourceMeta.set(resource, meta);
				resourceRefs.push({ ref: new WeakRef(resource), meta });
				state[kind]++;
				const total = totals[kind];
				total.created++;
				total.live++;
				total.peak = Math.max(total.peak, total.live);
				return resource;
			});
			wrap(scope[type].prototype, "destroy", function (original, args) {
				const result = Reflect.apply(original, this, args);
				const row = resourceMeta.get(this);
				if (row && !row.destroyed && !row.state.ended) {
					row.destroyed = true;
					row.state[kind]--;
					totals[kind].destroyed++;
					totals[kind].live--;
				}
				return result;
			});
		}
		wrap(scope.GPUDevice.prototype, "destroy", function (original, args) {
			const result = Reflect.apply(original, this, args);
			const row = deviceMeta.get(this);
			if (row && !row.ended) {
				row.ended = true;
				lifecycle.devicesDestroyed++;
				for (const kind of kinds) {
					totals[kind].ownerReleased += row[kind];
					totals[kind].live -= row[kind];
				}
			}
			return result;
		});
	}
	scope.__rocutGpuAudit = {
		snapshot() {
			resourceRefs = resourceRefs.filter(({ ref, meta }) => {
				if (meta.destroyed || meta.state.ended) return false;
				if (ref.deref()) return true;
				// This proves JS-wrapper collection only, not driver byte release.
				meta.state[meta.kind]--;
				totals[meta.kind].collectedWithoutDestroy++;
				totals[meta.kind].live--;
				return false;
			});
			return JSON.parse(JSON.stringify({ available, ...lifecycle, ...totals }));
		},
		async settle() {
			for (const ref of devices) {
				const device = ref.deref();
				if (device && !deviceMeta.get(device).ended)
					await device.queue.onSubmittedWorkDone();
			}
		},
		restore() {
			for (const restore of originals.reverse()) restore();
			delete scope.__rocutGpuAudit;
		},
	};
}
