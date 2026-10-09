import { expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeHyperframesFxChainJson } from "opencut-wasm";

interface NumericParameter {
	kind: "number";
	key: string;
	min: number;
	max: number;
	default: number;
}
interface EnumParameter {
	kind: "enum";
	key: string;
	default: string;
	options: readonly { value: string }[];
}
export interface NativeFxDefinition {
	id: string;
	params: readonly (NumericParameter | EnumParameter)[];
}
interface NativeChain {
	version: 1;
	nodes: readonly Record<string, unknown>[];
}
interface NativeFxModule {
	HF_AUDIO_FX: readonly NativeFxDefinition[];
	parseAudioFxChain(json: string): NativeChain;
}
interface NativeTailModule {
	chainTailSeconds(chain: NativeChain): number;
}

const directory =
	process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN ??
	"C:/Users/Sayo/AppData/Local/Temp/rocut-media-toolchain-YbloF9";
if (!isAbsolute(directory))
	throw Error("Expected absolute pinned HyperFrames toolchain directory");
const packageDirectory = join(directory, "node_modules/@hyperframes/core");
const manifest = JSON.parse(
	await readFile(join(packageDirectory, "package.json"), "utf8"),
) as { name?: unknown; version?: unknown };
if (manifest.name !== "@hyperframes/core" || manifest.version !== "0.8.139")
	throw Error(
		`FX differential oracle requires @hyperframes/core 0.8.139, received ${String(manifest.version)}`,
	);
const native = (await import(
	pathToFileURL(join(packageDirectory, "dist/audioFx.js")).href
)) as NativeFxModule;
const tail = (await import(
	pathToFileURL(join(packageDirectory, "dist/audio/audioFxTail.js")).href
)) as NativeTailModule;
export const definitions = native.HF_AUDIO_FX;
export const nativeParse = native.parseAudioFxChain;
export const chainJson = (nodes: readonly unknown[]): string =>
	JSON.stringify({ version: 1, nodes });

export function rustResult(input: string): Record<string, unknown> {
	return JSON.parse(normalizeHyperframesFxChainJson(input)) as Record<
		string,
		unknown
	>;
}
export function equivalent(input: string): void {
	// The oracle is the installed pinned package, never a restated normalizer.
	const expected = nativeParse(input),
		actual = rustResult(input);
	try {
		expect(Object.keys(actual).sort()).toStrictEqual([
			"chain",
			"staticTailSeconds",
		]);
		expect(actual.chain).toStrictEqual(expected);
		expect(typeof actual.staticTailSeconds).toBe("number");
		expect(actual.staticTailSeconds as number).toBeCloseTo(
			tail.chainTailSeconds(expected),
			12,
		);
	} catch (cause) {
		throw Error(`Pinned FX differential input: ${input.slice(0, 700)}`, {
			cause,
		});
	}
}
export function rustRejects(input: string): void {
	const actual = rustResult(input);
	expect(Object.keys(actual)).toStrictEqual(["error"]);
	expect(typeof actual.error).toBe("string");
	expect((actual.error as string).length).toBeGreaterThan(0);
}
export function nativeAndRustReject(input: string): void {
	expect(() => nativeParse(input)).toThrow();
	rustRejects(input);
}
export function policyRejects(input: string): void {
	// Native accepts this input: rejection is an explicit Rocut safety policy,
	// not an upstream-parity failure or a newly invented native restriction.
	expect(nativeParse(input).version).toBe(1);
	rustRejects(input);
}
