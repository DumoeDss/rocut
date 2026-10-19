import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
	rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { packageDirectoryArguments } from "./wasm-package-directory.mjs";
import { runContract } from "./run-wasm-api-contract.mjs";
import { REVIEWED_API_ADDITIONS } from "./fixtures/wasm-current-api-review.mjs";
import { EXPECTED as HISTORICAL } from "./wasm-api-surface-contract.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { pkgDir, remaining } = packageDirectoryArguments(
	process.argv.slice(2),
	"--pkg-dir",
	root,
);
assert.deepEqual(remaining, []);
const source = readFileSync(join(pkgDir, "opencut_wasm.d.ts"), "utf8");
// The October 11 contract refresh already absorbed these additions into its
// binary pins. Its frozen evidence retains their origins relative to C0b;
// comparing only with the refreshed binary set incorrectly drops their review.
const earlierAdditions = new Set(
	JSON.parse(
		readFileSync(
			join(root, "docs", "evidence", "wasm-authority-20261011.json"),
			"utf8",
		),
	).apiDelta.publicJsOrigins.map(({ name }) => name),
);
test("all public additions have explicit provider, consumer and type coverage", () => {
	const wrapper = readFileSync(join(pkgDir, "opencut_wasm.js"), "utf8");
	const exports = wrapper
		.match(/export \{([\s\S]*?)\} from/)[1]
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	const additions = exports.filter(
		(name) =>
			earlierAdditions.has(name) ||
			(!HISTORICAL.wasmExportsAsRecorded.includes(`${name}|function`) &&
				!["WasmRuntimeGraphicsQuery", "WasmRuntimeGpuResourceQuery"].includes(
					name,
				)),
	);
	assert.deepEqual(
		additions.sort(),
		REVIEWED_API_ADDITIONS.map(([name]) => name).sort(),
	);
	const fixture = readFileSync(
		join(root, "script", "fixtures", "wasm-current-api-contract.ts"),
		"utf8",
	);
	for (const [name, provider, consumer] of REVIEWED_API_ADDITIONS) {
		assert.ok(readFileSync(join(root, provider)).length > 0, provider);
		assert.ok(readFileSync(join(root, consumer)).length > 0, consumer);
		assert.ok(
			fixture
				.replace(/\s+/g, "")
				.includes(
					`type${name === "commitRenderFramePngForHandle" ? "NativeFramePngCommit" : name}Exact=Assert<Equal<`,
				),
			name,
		);
	}
});
test("current additive signatures and original frozen contracts compile", () => {
	assert.equal(runContract(["--pkg-dir", pkgDir]), 0);
});
const controls = [
	[
		"removed media folder planner binding",
		"export function planMediaFolderMutationJson(input: string): string;",
		"",
	],
	[
		"changed media folder planner input transport",
		"planMediaFolderMutationJson(input: string): string;",
		"planMediaFolderMutationJson(input: Uint8Array): string;",
	],
	[
		"any widened media folder validator result",
		"validateMediaFoldersJson(input: string): string;",
		"validateMediaFoldersJson(input: string): any;",
	],
	[
		"removed media folder validator binding",
		"export function validateMediaFoldersJson(input: string): string;",
		"",
	],
	[
		"removed track lock validator binding",
		"export function validateTrackLocksJson(input: string): string;",
		"",
	],
	[
		"changed track lock validator input transport",
		"validateTrackLocksJson(input: string): string;",
		"validateTrackLocksJson(input: Uint8Array): string;",
	],
	[
		"any widened track lock validator result",
		"validateTrackLocksJson(input: string): string;",
		"validateTrackLocksJson(input: string): any;",
	],
	[
		"removed directional video time binding",
		"export function resolveDirectionalVideoSourceTime(options: DirectionalVideoSourceTimeOptions): MediaTime | undefined;",
		"",
	],
	[
		"widened directional trim result",
		"directionalSourceTrims(options: DirectionalSourceTrims): DirectionalSourceTrims | undefined;",
		"directionalSourceTrims(options: DirectionalSourceTrims): any;",
	],
	[
		"changed reverse PCM transport",
		"reverseAudioSamples(samples: Float32Array): Float32Array;",
		"reverseAudioSamples(samples: Uint8Array): Float32Array;",
	],
	[
		"changed byte-bound media facts transport",
		"inspectMediaFactsBytes(input: Uint8Array): string;",
		"inspectMediaFactsBytes(input: string): string;",
	],
	[
		"any widened timeline replacement return",
		"resolveTimelineReplacementBytes(input: Uint8Array): string;",
		"resolveTimelineReplacementBytes(input: Uint8Array): any;",
	],
	[
		"removed timeline undo binding",
		"export function resolveTimelineUndoBytes(input: Uint8Array): string;",
		"",
	],
	[
		"removed native export job binding",
		"export function resolveNativeExportJobJson(input: string): string;",
		"",
	],
	[
		"changed native export job transport",
		"resolveNativeExportJobJson(input: string): string;",
		"resolveNativeExportJobJson(input: Uint8Array): string;",
	],
	[
		"any widened composition production return",
		"resolveCompositionProductionJson(input: string): string;",
		"resolveCompositionProductionJson(input: string): any;",
	],
	[
		"removed native wholegraph PNG commit",
		"export function commitRenderFramePngForHandle(handle: number, request: number): Promise<NativeFramePng>;",
		"",
	],
	[
		"any widened native wholegraph PNG return",
		"commitRenderFramePngForHandle(handle: number, request: number): Promise<NativeFramePng>;",
		"commitRenderFramePngForHandle(handle: number, request: number): Promise<any>;",
	],
	[
		"changed native wholegraph PNG handle width",
		"commitRenderFramePngForHandle(handle: number, request: number): Promise<NativeFramePng>;",
		"commitRenderFramePngForHandle(handle: bigint, request: number): Promise<NativeFramePng>;",
	],
	[
		"removed current function",
		"export function sampleScalarAnimationBatchJson(input: string): string;",
		"",
	],
	[
		"changed current binary transport",
		"encodeRemotionProducedAudioWav(input: Uint8Array): Uint8Array;",
		"encodeRemotionProducedAudioWav(input: string): Uint8Array;",
	],
	[
		"changed current owner output",
		"beginStage(session: number, kind: string, slot: number): MvMemoriesStage;",
		"beginStage(session: number, kind: string, slot: number): number;",
	],
	[
		"any widened current JSON return",
		"resolveEffectLayerParamsJson(input: string): string;",
		"resolveEffectLayerParamsJson(input: string): any;",
	],
	[
		"changed current owner ID width",
		"step(id: bigint, max_pixels: number): boolean;",
		"step(id: number, max_pixels: number): boolean;",
	],
];
// Mutate only this interface: Blaze has similar owner/alpha fields and must not
// accidentally be the declaration that proves the new contract rejects drift.
const nativeFramePng = source.match(
	/^export interface NativeFramePng \{[^\n]*\}/m,
)?.[0];
assert.ok(
	nativeFramePng,
	"NativeFramePng must be present in the actual package",
);
for (const [name, from, to] of [
	["any widened wholegraph PNG bytes", "png: Uint8Array;", "png: any;"],
	["narrowed wholegraph PNG owner", "owner: string;", "owner: number;"],
	[
		"changed wholegraph PNG alpha contract",
		"alphaMode: 'straight';",
		"alphaMode: string;",
	],
]) {
	assert.ok(
		nativeFramePng.includes(from),
		"control must target exact native frame interface",
	);
	controls.push([name, nativeFramePng, nativeFramePng.replace(from, to)]);
}
for (const [name, from, to] of controls)
	test(name, () => {
		assert.ok(
			source.includes(from),
			"negative control must mutate real declaration",
		);
		const temporary = mkdtempSync(join(tmpdir(), "rocut-current-api-control-"));
		const declaration = join(temporary, "opencut_wasm.d.ts");
		try {
			writeFileSync(declaration, source.replace(from, to), {
				encoding: "utf8",
				flag: "wx",
			});
			let output = "";
			const status = runContract(["--pkg-dir", temporary], (...args) => {
				const result = spawnSync(...args);
				output = (result.stdout ?? "") + (result.stderr ?? "");
				return result;
			});
			assert.equal(status, 2, output);
			assert.match(
				output,
				/wasm-current-api-contract\.ts/,
				"the new fixture, not unrelated errors, must reject drift",
			);
		} finally {
			unlinkSync(declaration);
			rmdirSync(temporary);
		}
	});
