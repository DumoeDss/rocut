import { sha256 } from "./frost-reference-fixture.mjs";
import {
	FROST_AUDIT_OUTPUTS,
	loadFrostAuditContract,
	frostAuditBytes,
	indexFrostAuditRecords,
} from "./frost-reference-gpu-audit-contract.mjs";
import {
	FROST_AUDIT_GATES,
	createFrostMetricAuditor,
	auditFrostCaseMetrics,
} from "./frost-reference-gpu-audit-metrics.mjs";
import {
	sameFrostBytes,
	auditCanonicalFrostSource,
	frostPlateauOffsets,
	auditFrostCaseInvariants,
	auditFrostCaseRelationships,
} from "./frost-reference-gpu-audit-invariants.mjs";

/** Artifact audit only. No caller backend, identity or expected pixels establish GPU execution. */
export function auditFrostReferenceCapture(input) {
	const failures = [],
		allmetrics = [],
		hardInvariants = {};
	const fail = (id, check, detail) => failures.push({ id, check, detail });
	const hard = (id, check, condition, detail) => {
		hardInvariants[`${id}:${check}`] = Boolean(condition);
		if (!condition) fail(id, check, detail);
	};
	const result = () => ({
		ok: failures.length === 0,
		allmetrics,
		hardInvariants,
		failures,
		scope:
			"Independent frozen f64 artifact audit; not evidence of runtime execution, backend, ABI or authorization",
		contract:
			"canonicalNative uses independent referenceRgba(case, canonicalSource), native straight2/.15/alpha0; rawNative uses authored source. This additional canonical-native gate was fixed before production GPU capture.",
	});
	const loaded = loadFrostAuditContract(hard, fail);
	if (!loaded) return result();
	const { fixture, manifest } = loaded;
	const bytes = (value, id, field) =>
		frostAuditBytes(value, id, field, fixture.source.length, fail);
	const source = bytes(input?.source, "input", "source"),
		canonical = bytes(input?.canonicalSource, "input", "canonicalSource");
	if (source)
		hard(
			"input",
			"sourceHash",
			sha256(source) === manifest.sourceSha256,
			"Capture source differs from frozen authored source",
		);
	const metric = createFrostMetricAuditor(allmetrics, fail);
	if (source && canonical)
		metric(
			"input",
			"canonicalSourceFidelity",
			canonical,
			source,
			FROST_AUDIT_GATES.source,
			true,
		);
	auditCanonicalFrostSource(source, canonical, hard);
	const byId = indexFrostAuditRecords(input, fixture, hard, fail);
	const native = new Map(),
		canonicalNative = new Map(),
		plateau = frostPlateauOffsets(fixture, hard);
	for (const item of fixture.cases) {
		const record = byId.get(item.id);
		if (!record) {
			fail(item.id, "missingCase", "Missing case record");
			continue;
		}
		const bypass = ["negative-handle", "neutral"].includes(item.id);
		hard(
			item.id,
			"passCount",
			record.passCount === (bypass ? 0 : 1),
			"Pass count does not match native resolver expectation",
		);
		if (bypass) {
			const value = bytes(record.fixtureRgba, item.id, "fixtureRgba");
			if (value)
				hard(
					item.id,
					"bypassPoisonExact",
					sameFrostBytes(value, fixture.source),
					"Non-GPU bypass must preserve all authored bytes, including poisoned hidden RGB",
				);
			continue;
		}
		const out = Object.fromEntries(
			FROST_AUDIT_OUTPUTS.map((field) => [
				field,
				bytes(record[field], item.id, field),
			]),
		);
		if (out.nativeRgba) native.set(item.id, out.nativeRgba);
		if (out.canonicalNativeRgba)
			canonicalNative.set(item.id, out.canonicalNativeRgba);
		auditFrostCaseMetrics(item, out, canonical, metric);
		auditFrostCaseInvariants(item, out, fixture, canonical, plateau, hard);
	}
	auditFrostCaseRelationships(manifest, native, canonicalNative, hard);
	return result();
}
