import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type {
	FlameOracleFrame,
	FlameReference,
	FlameSong,
} from "./mv-flame-oracle-contract";
import { createFlameOracle } from "./mv-flame-oracle";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";
import { check, difference } from "./mv-afterimage-capture";

const iterationLoop = "for (let it = 0; it < 220; it++) for (const q of idx)";
const roiBounds =
	"const x0 = Math.max(0, Math.floor(ecx - rx - 6)), y0 = Math.max(0, Math.floor(ecy - ry - 6));\n    const x1 = Math.min(img.width, Math.ceil(ecx + rx + 6)), y1 = Math.min(img.height, Math.ceil(ecy + ry + 6));";

/** Reference-derived sensitivity negatives, NOT production-native mutants.
 * Expected pixels always come from the unchanged original realm. No diffusion
 * math is copied, and no checkout file is edited. Exact one-site replacement.
 */
export async function flameSensitivity({
	reference,
	song,
	resources,
	frame,
}: {
	reference: FlameReference;
	song: FlameSong;
	resources: readonly ResolvedProgrammaticResource[];
	frame: FlameOracleFrame;
}) {
	const source = reference.scripts.find((s) => s.id === "scenes/dark.js");
	check(source, "Missing dark.js sensitivity source");
	const before = await digest(new TextEncoder().encode(source.code).buffer);
	check(
		before === source.sha256,
		"Unchanged original source identity mismatch",
	);
	const original = await createFlameOracle({ reference, song, resources });
	const expected = original.render(frame);
	const results: Record<string, unknown> = {};
	try {
		check(
			expected.prepared,
			"Sensitivity requires original full prepared image",
		);
		for (const [name, oldText, newText] of [
			["low-iterations", iterationLoop, iterationLoop.replace("220", "20")],
			[
				"low-roi",
				roiBounds,
				roiBounds
					.replaceAll("ecx - rx", "ecx - rx * 0.35")
					.replaceAll("ecx + rx", "ecx + rx * 0.35")
					.replaceAll("ecy - ry", "ecy - ry * 0.35")
					.replaceAll("ecy + ry", "ecy + ry * 0.35"),
			],
		] as const) {
			const normalized = source.code.replaceAll("\r\n", "\n");
			check(
				normalized.split(oldText).length === 2,
				`${name} mutation must match exactly one site`,
			);
			const code = normalized.replace(oldText, newText),
				sha256 = await digest(new TextEncoder().encode(code).buffer);
			const mutantReference: FlameReference = {
				...reference,
				scripts: reference.scripts.map((s) =>
					s.id === source.id ? { ...s, code, sha256 } : s,
				),
			};
			const mutant = await createFlameOracle({
				reference: mutantReference,
				song,
				resources,
			});
			try {
				const actual = mutant.render(frame);
				try {
					check(actual.prepared, "Mutant missing prepared image");
					const diff = difference(
						expected.prepared.pixels,
						actual.prepared.pixels,
					);
					check(diff.max > 2 || diff.mae >= 0.025, `${name} is not detectable`);
					results[name] = {
						kind: "reference-derived-sensitivity-negative",
						baseScriptSha256: before,
						mutantScriptSha256: sha256,
						diffText: { removed: oldText, added: newText },
						fullPreparedDifference: diff,
					};
				} finally {
					actual.canvas.width = actual.canvas.height = 1;
				}
			} finally {
				mutant.dispose();
			}
		}
		check(
			(await digest(new TextEncoder().encode(source.code).buffer)) === before,
			"Sensitivity changed positive reference",
		);
		return results;
	} finally {
		expected.canvas.width = expected.canvas.height = 1;
		original.dispose();
	}
}
