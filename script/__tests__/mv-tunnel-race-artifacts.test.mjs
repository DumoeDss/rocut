import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveTunnelRaceArtifacts } from "../fixtures/mv-tunnel-race-artifacts.mjs";

test("race artifact protocol retains its original name and separates oracle diagnostics", async () => {
	const artifact = await mkdtemp(join(tmpdir(), "rocut-race-artifacts-cpu-"));
	const original = globalThis.__tunnelRaceFailure;
	const oracle = globalThis.__tunnelOracleRepeatDiagnostic;
	try {
		globalThis.__tunnelRaceFailure = { metadata: { key: "original-failure" }, buffers: {} };
		globalThis.__tunnelOracleRepeatDiagnostic = { metadata: { diagnosticOnly: true }, buffers: {} };
		const page = { async evaluate(fn, argument) { return fn(argument); } };
		await saveTunnelRaceArtifacts({ page, artifact });
		await saveTunnelRaceArtifacts({ page, artifact,
			globalKey: "__tunnelOracleRepeatDiagnostic", prefix: "oracle-repeat" });
		assert.equal(JSON.parse(await readFile(join(artifact, "race-failure.json"), "utf8")).metadata.key,
			"original-failure");
		assert.equal(JSON.parse(await readFile(join(artifact, "oracle-repeat-diagnostic.json"), "utf8"))
			.metadata.diagnosticOnly, true);
	} finally {
		globalThis.__tunnelRaceFailure = original;
		globalThis.__tunnelOracleRepeatDiagnostic = oracle;
	}
});
