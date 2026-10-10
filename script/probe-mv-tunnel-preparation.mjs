import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTunnelReference } from "./fixtures/mv-tunnel-reference.ts";
import { loadTunnelPostReference } from "./fixtures/mv-tunnel-post-reference.ts";
import {
	TUNNEL_FONTS,
	TUNNEL_LATIN,
	TUNNEL_PIXEL_NEGATIVES,
	TUNNEL_POST_NEGATIVES,
	tunnelMatrix,
} from "./fixtures/mv-tunnel-matrix.ts";
import { titleRiffFontIdentity } from "./fixtures/mv-title-riff-reference-font-identity.ts";
import { snapshotTypeCardFonts } from "./fixtures/mv-type-card-reference-fonts.ts";
import { splitTunnelGlyphCoverage } from "./fixtures/mv-tunnel-fonts.ts";

// Deliberately CPU-only: this must never substitute for official producer pixels.
assert.deepEqual(process.argv.slice(2), ["--cpu-only"]);
const original = process.env.ROCUT_TUNNEL_REFERENCE_ROOT;
assert.ok(
	original && isAbsolute(original),
	"Supply absolute ROCUT_TUNNEL_REFERENCE_ROOT",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadTunnelReference(original),
	post = await loadTunnelPostReference(original);
const definitions = await Promise.all(
	TUNNEL_FONTS.map(async (role) => {
		const body = await readFile(
			join(root, "apps/web/public/motion-text/fonts", role.file),
		);
		const bytes = Uint8Array.from(body).buffer;
		return {
			...role,
			bytes,
			byteLength: body.length,
			sha256: createHash("sha256").update(body).digest("hex"),
			descriptor: { weight: String(role.weight), style: "normal" },
			sfnt: titleRiffFontIdentity(bytes, role.family, role.weight),
		};
	}),
);
const fonts = snapshotTypeCardFonts(definitions);
const latin = splitTunnelGlyphCoverage({
	fonts,
	family: "DotGothic16",
	weight: 400,
	text: TUNNEL_LATIN.join("") + "   ·   ",
});
const matrix = tunnelMatrix();
console.log(
	JSON.stringify(
		{
			stage: "prepared-cpu-only",
			nativeAcceptancePassed: false,
			browserExecuted: false,
			cargoExecuted: false,
			wasmExecuted: false,
			exportExecuted: false,
			observationsPlanned: matrix.reduce((n, c) => n + c.indices.length, 0),
			repeatsPlanned: 26,
			fullForwardFrames: 360,
			width: 1920,
			height: 1080,
			fps: 60,
			scripts: [
				...reference.scripts.map(({ id, sha256 }) => ({ id, sha256 })),
				{ id: post.id, sha256: post.sha256 },
			],
			fonts: definitions.map(({ bytes: _bytes, ...identity }) => identity),
			latinRouting: {
				primaryFamily: "DotGothic16",
				fallbackFamily: "Noto Serif JP",
				weight: 400,
				...latin,
			},
			negativesPlanned: {
				scene: TUNNEL_PIXEL_NEGATIVES,
				post: TUNNEL_POST_NEGATIVES,
				pixelEquivalent: "26 unchanged black lighter ray wedges",
			},
			futureEntry:
				"script/fixtures/mv-tunnel-pixel-suite.ts: verifyTunnelPixelMatrix({ oracle, captureNative })",
			missingOfficialBridge:
				"Declared ordered resource-ID font stacks; native metric request/response routing; final Rust tunnel plan/public Canvas; dedicated post. No fallback implementation is supplied.",
			scope:
				"Exact original script/font-byte preflight and bounded matrix only; NOT native, GPU, font-rendering, pixel, export, or full-MV acceptance",
		},
		null,
		2,
	),
);
