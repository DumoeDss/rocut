import { readFileSync } from "node:fs";
import { createReferenceFixture } from "./frost-reference-fixture.mjs";
import { FROST_AUDIT_GATES } from "./frost-reference-gpu-audit-metrics.mjs";
import { sameFrostBytes } from "./frost-reference-gpu-audit-invariants.mjs";

export const FROST_AUDIT_OUTPUTS = [
	"nativeRgba",
	"canonicalNativeRgba",
	"defaultCanvasRgba",
	"diagnosticCanvasRgba",
	"rawCanvasRgba",
	"readbackCanvasRgba",
];

export function loadFrostAuditContract(hard, fail) {
	let fixture, manifest;
	try {
		manifest = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				readFileSync(
					new URL(
						"../../docs/evidence/frost-optical-fixture-v2.json",
						import.meta.url,
					),
				),
			),
		);
		fixture = createReferenceFixture();
	} catch (error) {
		fail("fixture", "load", String(error));
		return null;
	}
	hard(
		"fixture",
		"sourceHash",
		fixture.sourceSha256 === manifest.sourceSha256,
		"Generated source does not match frozen manifest",
	);
	hard(
		"fixture",
		"dimensions",
		manifest.dimensions.width === fixture.width &&
			manifest.dimensions.height === fixture.height &&
			manifest.dimensions.rgbaBytes === fixture.source.length,
		"Frozen dimensions mismatch",
	);
	hard(
		"fixture",
		"gates",
		Object.keys(FROST_AUDIT_GATES).every(
			(k) =>
				JSON.stringify(manifest.gates[k]) ===
				JSON.stringify(FROST_AUDIT_GATES[k]),
		),
		"Pre-output numeric gates changed",
	);
	hard(
		"fixture",
		"expectedCaseSet",
		sameFrostBytes(
			Object.keys(manifest.expectedSha256).sort(),
			fixture.cases.map((c) => c.id).sort(),
		),
		"Frozen expected case set mismatch",
	);
	for (const item of fixture.cases)
		hard(
			item.id,
			"expectedHash",
			item.expectedSha256 === manifest.expectedSha256[item.id],
			"Generated f64 expected pixels do not match frozen manifest",
		);
	return { fixture, manifest };
}

export function frostAuditBytes(value, id, field, length, fail) {
	if (!(value instanceof Uint8Array) || value.length !== length) {
		fail(id, field, "Exact-sized Uint8Array RGBA required");
		return null;
	}
	return value;
}

export function indexFrostAuditRecords(input, fixture, hard, fail) {
	const records = Array.isArray(input?.records) ? input.records : [];
	if (!Array.isArray(input?.records))
		fail("input", "records", "Records array required");
	hard(
		"input",
		"recordCount",
		records.length === fixture.cases.length,
		"Exactly ten records required",
	);
	const byId = new Map(),
		known = new Set(fixture.cases.map((c) => c.id));
	for (const record of records) {
		if (!record || !known.has(record.id)) {
			fail(record?.id ?? "input", "unknownCase", "Unknown case record");
			continue;
		}
		if (byId.has(record.id)) {
			fail(record.id, "duplicateCase", "Duplicate case record");
			continue;
		}
		byId.set(record.id, record);
	}
	return byId;
}
