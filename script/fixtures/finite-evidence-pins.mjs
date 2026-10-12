import assert from "node:assert/strict";

// Historical source pins describe the executed producer, not today's worktree.
export function collectFiniteEvidencePins(value, {
	manifest, workspaceRoot, retained, historical,
}, trail = []) {
	if (!value || typeof value !== "object") return;
	if (typeof value.path === "string" && /^[A-Za-z]:[\\/]/.test(value.path) &&
		typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256)) {
		const path = value.path.replaceAll("\\", "/");
		const sourceRecord = manifest === "canvas-current-capture-lifecycle.json" &&
			trail.length === 2 && trail[0] === "productionSourcePins";
		if (sourceRecord) {
			assert(path.startsWith(`${workspaceRoot}/rust/wasm/src/`), "Historical source outside registered module");
			const frozenPath = path.replace(workspaceRoot, "C:/tmps/rocut-recipe-catalog-wasm-20261012/source");
			assert(!retained.has(frozenPath) || retained.get(frozenPath) === value.sha256, "Conflicting frozen source hash");
			retained.set(frozenPath, value.sha256);
			historical.push({ path, frozenPath, executedSha256: value.sha256, manifest, record: trail.join(".") });
		} else {
			assert(!retained.has(path) || retained.get(path) === value.sha256, "Conflicting artifact hash");
			retained.set(path, value.sha256);
		}
		assert(retained.size + historical.length <= 512, "Bounded artifact audit exceeded 512 files");
	}
	for (const [key, child] of Object.entries(value)) {
		collectFiniteEvidencePins(child, { manifest, workspaceRoot, retained, historical }, [...trail, key]);
	}
}
