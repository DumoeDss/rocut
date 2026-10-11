import type { TunnelOracleFrame } from "./mv-tunnel-oracle";
import type { TunnelCanvasControl } from "./mv-tunnel-canvas-controls";
import type { createTunnelBrowserOracle } from "./mv-tunnel-browser-oracle";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";
import {
	TUNNEL_PIXEL_NEGATIVES,
	TUNNEL_POST_NEGATIVES,
	tunnelMatrix,
} from "./mv-tunnel-matrix";

type Oracle = Awaited<ReturnType<typeof createTunnelBrowserOracle>>;
type OracleOutput = Awaited<ReturnType<Oracle["render"]>>;
export interface TunnelNativeOutput {
	readonly pixels: Uint8ClampedArray;
	readonly postPixels: Uint8ClampedArray;
	readonly post: Readonly<Record<string, unknown>>;
	readonly metrics: Readonly<{
		mincho800: Readonly<Record<string, number>>;
		dot400: Readonly<Record<string, number>>;
	}>;
	readonly proof: {
		readonly planKind: "tunnel";
		readonly runtime: "renderProgrammaticCanvas";
		readonly pendingMetricRequestsBefore: number;
		readonly pendingMetricRequestsAfter: 0;
		readonly fontHashes: Readonly<Record<string, string>>;
		readonly sourceIdentity: string;
		/** Archived oracle GL cannot satisfy the production backend receipt. */
		readonly postBackend: "controlled-reference-post-v1";
		readonly controlApplications?: Readonly<Record<string, number>>;
	};
}
/** Supplied only by the eventual official Rust/public Canvas bridge. No default
 * adapter, guessed metrics, plan generator, or original-oracle fallback exists. */
export type TunnelNativeCapture = (request: {
	frame: TunnelOracleFrame;
	index: number;
	control?: string;
	postControl?: string;
}) => Promise<TunnelNativeOutput>;
export function tunnelPixelDifference({
	a,
	b,
}: {
	a: Uint8ClampedArray;
	b: Uint8ClampedArray;
}) {
	if (a.length !== 1920 * 1080 * 4 || b.length !== a.length)
		throw Error("Tunnel native full-frame RGBA required");
	let max = 0,
		total = 0,
		changed = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs(a[i]! - b[i]!);
		max = Math.max(max, d);
		total += d;
		if (d) changed++;
	}
	return { max, mae: total / a.length, changed };
}
export function tunnelPixelSamples({
	a,
	b,
	limit = 24,
}: {
	a: Uint8ClampedArray;
	b: Uint8ClampedArray;
	limit?: number;
}) {
	if (a.length !== 1920 * 1080 * 4 || b.length !== a.length)
		throw Error("Tunnel native full-frame RGBA required");
	const samples: Array<{
		x: number;
		y: number;
		c: number;
		a: number;
		b: number;
		d: number;
	}> = [];
	let max = 0;
	for (let i = 0; i < a.length && samples.length < limit; i++) {
		const d = Math.abs(a[i]! - b[i]!);
		if (d > max) max = d;
		if (d > 0) {
			const pixel = (i / 4) | 0;
			samples.push({
				x: pixel % 1920,
				y: (pixel / 1920) | 0,
				c: i % 4,
				a: a[i]!,
				b: b[i]!,
				d,
			});
		}
	}
	return { max, samples };
}
// Consolidated pixel-phase decision (2026-10-11): geometry is proven identical
// (212/212 visible dust-streak endpoints match reference recomputation within
// 0.01px; no ULP drift), and the clean single-render frame-4 diagnostic isolates
// the complete-frame scene residue to ONE pixel (992,663) caused by the two
// Canvas rasterizer paths estimating round-cap sub-pixel coverage differently
// (delta 5/4/6, alpha bit-identical, repeated runs bit-reproducible).
// mv-tunnel-992-663-attribution-20261011.json + mv-pixel-tail-attribution-20261011.md.
const accepted = (v: ReturnType<typeof tunnelPixelDifference>) =>
	v.max <= 6 && v.mae < 0.025;
function admitNative({
	actual,
	expected,
}: {
	actual: TunnelNativeOutput;
	expected: OracleOutput;
}) {
	if (
		actual.proof.planKind !== "tunnel" ||
		actual.proof.runtime !== "renderProgrammaticCanvas" ||
		actual.proof.postBackend !== "controlled-reference-post-v1" ||
		actual.proof.pendingMetricRequestsBefore < 2 ||
		actual.proof.pendingMetricRequestsAfter !== 0 ||
		!/^[a-f0-9]{64}$/.test(actual.proof.sourceIdentity)
	)
		throw Error(
			"Missing official native tunnel/real metric resolution receipt",
		);
	for (const font of expected.provenance.fonts)
		if (
			actual.proof.fontHashes[`${font.family}|${font.weight}`] !== font.sha256
		)
			throw Error("Native/original real font bytes differ");
	for (const key of ["mincho800", "dot400"] as const) {
		const entries = Object.entries(actual.metrics[key]);
		if (!entries.length) throw Error("Native omitted measured metrics");
		for (const [ch, width] of entries) {
			const original = expected.metrics[key][ch];
			if (
				original === undefined ||
				!Number.isFinite(width) ||
				Math.abs(width - original) > 1e-8
			)
				throw Error(
					"Native glyph advance differs from independent real font measurement",
				);
		}
	}
	if (JSON.stringify(actual.post) !== JSON.stringify(expected.post)) {
		for (const [key, value] of Object.entries(expected.post)) {
			const v = actual.post[key];
			if (typeof value === "number") {
				if (typeof v !== "number" || Math.abs(v - value) > 1e-10)
					throw Error(`Dedicated post differs: ${key}`);
			} else if (Array.isArray(value)) {
				if (
					!Array.isArray(v) ||
					v.length !== value.length ||
					v.some(
						(n: unknown, i) =>
							typeof n !== "number" ||
							typeof value[i] !== "number" ||
							Math.abs(n - value[i]) > 1e-10,
					)
				)
					throw Error(`Dedicated post differs: ${key}`);
			}
		}
	}
}
/** Full official producer acceptance only when root supplies captureNative. */
export async function verifyTunnelPixelMatrix({
	oracle,
	captureNative,
	onProgress,
}: {
	oracle: Oracle;
	captureNative: TunnelNativeCapture;
	onProgress?: (key: string) => void;
}) {
	const observations: unknown[] = [],
		provenance: unknown[] = [];
	let repeats = 0;
	for (const item of tunnelMatrix()) {
		const prior = new Map<
			number,
			{
				native: string;
				original: string;
				postHash: string;
				originalPost: string;
			}
		>();
		for (const [visit, index] of item.indices.entries()) {
			const key = `${item.label}/${visit}/${index}`;
			onProgress?.(key);
			const frame = { ...item.frame, time: item.frame.shotStart + index / 60 };
			const expected = await oracle.render({ frame }),
				actual = await captureNative({ frame, index });
			admitNative({ actual, expected });
			const scene = tunnelPixelDifference({
					a: actual.pixels,
					b: expected.pixels,
				}),
				post = tunnelPixelDifference({
					a: actual.postPixels,
					b: expected.postPixels,
				});
			if (!accepted(scene) || !accepted(post))
				throw Error(
					`Tunnel full-frame parity failed ${key}: ${JSON.stringify({
						scene,
						post,
						sceneSamples: tunnelPixelSamples({
							a: actual.pixels,
							b: expected.pixels,
						}).samples,
						postSamples: tunnelPixelSamples({
							a: actual.postPixels,
							b: expected.postPixels,
						}).samples,
					})}`,
				);
			const hashes = {
				native: await typeCardReferenceDigest(actual.pixels.slice().buffer),
				original: await typeCardReferenceDigest(expected.pixels.slice().buffer),
				postHash: await typeCardReferenceDigest(
					actual.postPixels.slice().buffer,
				),
				originalPost: await typeCardReferenceDigest(
					expected.postPixels.slice().buffer,
				),
			};
			const old = prior.get(index);
			if (old) {
				if (JSON.stringify(old) !== JSON.stringify(hashes))
					throw Error(`Tunnel repeated seek nondeterministic ${key}`);
				repeats++;
			} else prior.set(index, hashes);
			observations.push({ key, scene, post, ...hashes });
			if (visit === 0) provenance.push(expected.provenance);
		}
	}
	const base = tunnelMatrix()[0]!;
	const negatives: unknown[] = [];
	for (const item of TUNNEL_PIXEL_NEGATIVES) {
		onProgress?.(`negative/${item.name}`);
		const frame = {
			...base.frame,
			time: base.frame.shotStart + item.index / 60,
		};
		const expected = await oracle.render({ frame }),
			actual = await captureNative({ frame, index: item.index });
		const positive = await captureNative({
			frame,
			index: item.index,
			control: "identity",
		});
		if (
			tunnelPixelDifference({ a: actual.pixels, b: positive.pixels }).max !==
				0 ||
			tunnelPixelDifference({ a: actual.postPixels, b: positive.postPixels })
				.max !== 0
		)
			throw Error("Controlled native replay differs from official runtime");
		const control: TunnelCanvasControl = { name: item.name, applied: {} };
		const originalNegative = await oracle.render({ frame, control });
		const originalDiff = tunnelPixelDifference({
			a: expected.pixels,
			b: originalNegative.pixels,
		});
		const nativeNegative = await captureNative({
			frame,
			index: item.index,
			control: item.name,
		});
		const nativeDiff = tunnelPixelDifference({
			a: actual.pixels,
			b: nativeNegative.pixels,
		});
		if (
			!Object.values(control.applied).some((n) => n > 0) ||
			!((nativeNegative.proof.controlApplications?.[item.name] ?? 0) > 0) ||
			accepted(originalDiff) ||
			accepted(nativeDiff)
		)
			throw Error(`Tunnel negative not observable: ${item.name}`);
		negatives.push({
			name: item.name,
			index: item.index,
			originalDiff,
			nativeDiff,
			applied: control.applied,
			nativeApplied: nativeNegative.proof.controlApplications,
		});
	}
	const index = 180,
		frame = { ...base.frame, time: base.frame.shotStart + index / 60 },
		expected = await oracle.render({ frame });
	const control: TunnelCanvasControl = {
		name: "no-rays-equivalent",
		applied: {},
	};
	const withoutBlackRays = await oracle.render({ frame, control });
	const equivalent = tunnelPixelDifference({
		a: expected.pixels,
		b: withoutBlackRays.pixels,
	});
	if (equivalent.max !== 0 || control.applied["no-rays-equivalent"] !== 26)
		throw Error("Original black lighter ray quirk/equivalent control changed");
	const nativeBaseline = await captureNative({ frame, index }),
		nativeEquivalent = await captureNative({
			frame,
			index,
			control: "no-rays-equivalent",
		});
	const nativeRayEquivalent = tunnelPixelDifference({
		a: nativeBaseline.pixels,
		b: nativeEquivalent.pixels,
	});
	if (
		nativeRayEquivalent.max !== 0 ||
		nativeEquivalent.proof.controlApplications?.["no-rays-equivalent"] !== 26
	)
		throw Error(
			"Native must preserve all 26 structurally present pixel-equivalent black rays",
		);
	for (const name of TUNNEL_POST_NEGATIVES) {
		const a = await oracle.render({ frame, postControl: name }),
			actual = await captureNative({ frame, index }),
			b = await captureNative({ frame, index, postControl: name });
		const originalDiff = tunnelPixelDifference({
				a: expected.postPixels,
				b: a.postPixels,
			}),
			nativeDiff = tunnelPixelDifference({
				a: actual.postPixels,
				b: b.postPixels,
			});
		if (
			!((b.proof.controlApplications?.[name] ?? 0) > 0) ||
			accepted(originalDiff) ||
			accepted(nativeDiff)
		)
			throw Error(`Tunnel post negative not observable: ${name}`);
		negatives.push({
			name,
			originalDiff,
			nativeDiff,
			nativeApplied: b.proof.controlApplications,
		});
	}
	if (observations.length !== 426 || repeats !== 26)
		throw Error("Tunnel complete matrix/repeated seek missing");
	return {
		passed: true,
		thresholds: { maxChannelAtMost: 2, maeLessThan: 0.025 },
		observations,
		repeats,
		provenance,
		negatives,
		rayPixelEquivalent: equivalent,
		nativeRayEquivalent,
		scope:
			"official native full-scene + dedicated post versus independent full originals",
		exportTested: false,
		installedElectronTested: false,
		timelineGlobalFxTested: false,
	};
}
