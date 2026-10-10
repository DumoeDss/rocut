import * as wasm from "opencut-wasm";
import {
	createHeartOwnerProvider,
	createHeartNativeUploadBitmap,
	type HeartOwnerApi,
	type HeartNativePixels,
} from "./mv-heart-owner-provider";
import { openHeartOwnerOracle } from "./mv-heart-owner-browser-oracle";
import { openHeartOwnerRaster } from "./mv-heart-owner-browser-raster";
import type { HeartOwnerReference } from "./mv-heart-owner-reference";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";
import { HEART_OWNER_PROTOTYPE_TICKS } from "./mv-heart-owner-matrix";
import { probeExclusiveHeartCapacity, probeHeartAggregateCapacity } from "./mv-heart-owner-capacity";
interface ActualOwner extends HeartOwnerApi {
	diagnosticJson(): string;
	dispose(): void;
	free(): void;
}
interface Constructor {
	new (): ActualOwner;
	capabilityJson(): string;
}
function object(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}
function constructor(v: unknown): v is Constructor {
	if (
		typeof v !== "function" ||
		typeof Reflect.get(v, "capabilityJson") !== "function"
	)
		return false;
	const prototype: unknown = Reflect.get(v, "prototype");
	return (
		object(prototype) &&
		[
			"prepare",
			"manifestJson",
			"imageBytes",
			"frameJson",
			"cancel",
			"diagnosticJson",
			"dispose",
			"free",
		].every((k) => typeof Reflect.get(prototype, k) === "function")
	);
}
declare global {
	var __heartOwnerReference: HeartOwnerReference;
	var __heartOwnerProgress: string;
	var __heartOwnerResult: unknown;
	var __heartOwnerSpriteDiagnostic: unknown;
	var __heartOwnerFailedFrame: unknown;
	var __heartOwnerCapacity: unknown;
	var __heartOwnerAggregateCapacity: unknown;
}
const checks: Record<string, boolean> = {};
function requireCheck({ name, valid }: { name: string; valid: boolean }) {
	checks[name] = valid;
	if (!valid) throw Error(`Heart owner prototype gate failed: ${name}`);
}
function state(owner: ActualOwner) {
	const v: unknown = JSON.parse(owner.diagnosticJson());
	if (!object(v)) throw Error("Heart owner diagnostics missing");
	return v;
}
function difference({ a, b }: { a: Uint8ClampedArray; b: Uint8ClampedArray }) {
	if (a.length !== 1920 * 1080 * 4 || b.length !== a.length)
		throw Error("Heart full native RGBA required");
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
async function nativePng(size: number) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw Error("Heart fixture native Canvas2D missing");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, size, size);
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(Error("Native PNG encode failed"))),
			"image/png",
		),
	);
	const encoded = await blob.arrayBuffer(),
		bitmap = await createImageBitmap(blob);
	try {
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		ctx.drawImage(bitmap, 0, 0);
		const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
		const sha256 = await typeCardReferenceDigest(encoded);
		const source: HeartNativePixels = {
			resource: {
				id: "heart",
				kind: "image",
				mimeType: "image/png",
				attachmentKey: `programmatic-sha256-${sha256}`,
				byteLength: encoded.byteLength,
				sha256,
			},
			encoded,
			width: bitmap.width,
			height: bitmap.height,
			rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		};
		return { source, bitmap };
	} catch (error) {
		bitmap.close();
		throw error;
	} finally {
		canvas.width = canvas.height = 1;
	}
}
const frame = ({ ticks, burn }: { ticks: number; burn: boolean }) => ({
	scene: {
		kind: burn ? "heartBurn" : "heartShatter",
		settings: { heart: "heart" },
	},
	shotStartTicks: 0,
	shotEndTicks: 600000,
	songTicks: ticks,
	beats: Array.from({ length: 11 }, (_, i) => i * 60000),
	bpm: 120,
});
async function run() {
	const Owner: unknown = Reflect.get(wasm, "MvHeartOwner");
	if (!constructor(Owner))
		throw Error(
			"Private actual WASM lacks MvHeartOwner class; no mock/fallback is permitted",
		);
	const owner = new Owner(),
		capabilityJson = () => Owner.capabilityJson();
	let fixture: Awaited<ReturnType<typeof nativePng>> | undefined,
		raster: Awaited<ReturnType<typeof openHeartOwnerRaster>> | undefined,
		oracle: Awaited<ReturnType<typeof openHeartOwnerOracle>> | undefined;
	let provider:
		| Awaited<ReturnType<typeof createHeartOwnerProvider<ImageBitmap>>>
		| undefined;
	const observations: unknown[] = [],
		hashes = new Map<string, string>();
	let repeats = 0;
	try {
		const capability: unknown = JSON.parse(capabilityJson());
		fixture = await nativePng(20);
		raster = await openHeartOwnerRaster();
		globalThis.__heartOwnerProgress = "exclusive-exact1024-capacity";
		globalThis.__heartOwnerCapacity = await probeExclusiveHeartCapacity({
			createOwner: () => new Owner(), capabilityJson, nativePng, frame,
			onEvidence: evidence => { globalThis.__heartOwnerCapacity = evidence; },
			render: input => raster!.render(input),
		});
		requireCheck({ name: "exclusive-exact1024-native-prepare-frame-release", valid: true });
		oracle = await openHeartOwnerOracle({
			reference: globalThis.__heartOwnerReference,
			source: fixture.bitmap,
		});
		provider = await createHeartOwnerProvider({
			owner,
			source: fixture.source,
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: createHeartNativeUploadBitmap,
		});
		globalThis.__heartOwnerAggregateCapacity = await probeHeartAggregateCapacity({ owner, capabilityJson, nativePng });
		requireCheck({ name: "64-plus-256MiB-aggregate-reservation-rejected", valid: true });
		const ticks = HEART_OWNER_PROTOTYPE_TICKS;
		for (const burn of [false, true])
			for (const [visit, songTicks] of ticks.entries()) {
				const key = `${burn ? "burn" : "shatter"}/${songTicks}`;
				globalThis.__heartOwnerProgress = `${key}/${visit}`;
				const plan = provider.frame(frame({ ticks: songTicks, burn }));
				const actual = raster.render({
						plan: plan.plan,
						preparedImage: (image) => provider!.preparedImage(image),
					}),
					expected = oracle.render({ ticks: songTicks, burn });
				const diff = difference({ a: actual, b: expected });
				if (diff.max > 2 || diff.mae >= 0.025) {
					globalThis.__heartOwnerFailedFrame = { key, visit, difference: diff,
						nativeSha: await typeCardReferenceDigest(actual.buffer),
						originalSha: await typeCardReferenceDigest(expected.buffer) };
					try {
						globalThis.__heartOwnerSpriteDiagnostic = await oracle.diagnose({
							plan: plan.plan,
							preparedImage: (image: Parameters<NonNullable<typeof provider>["preparedImage"]>[0]) =>
								provider!.preparedImage(image),
						});
					} catch (error) {
						globalThis.__heartOwnerSpriteDiagnostic = { error: String(error) };
					}
				}
				requireCheck({
					name: `pixels/${key}/${visit}`,
					valid: diff.max <= 2 && diff.mae < 0.025,
				});
				const nativeSha = await typeCardReferenceDigest(actual.buffer),
					originalSha = await typeCardReferenceDigest(expected.buffer);
				const hash = `${nativeSha}/${originalSha}`;
				if (hashes.has(key)) {
					requireCheck({
						name: `repeat/${key}/${visit}`,
						valid: hashes.get(key) === hash,
					});
					repeats++;
				} else hashes.set(key, hash);
				observations.push({
					mode: burn ? "burn" : "shatter",
					songTicks,
					visit,
					difference: diff,
					nativeSha,
					originalSha,
				});
			}
		const baseline = state(owner);
		const other = await createHeartOwnerProvider({
			owner,
			source: fixture.source,
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: createHeartNativeUploadBitmap,
		});
		let rejected = false;
		try {
			owner.frameJson(
				other.session,
				JSON.stringify({
					...frame({ ticks: 120000, burn: false }),
					binding: other.identity.binding,
				}),
			);
		} catch {
			rejected = true;
		} finally {
			other.dispose();
		}
		requireCheck({
			name: "authored-facts-rejected-only-current-session",
			valid: rejected && state(owner).sessions === baseline.sessions,
		});
		provider.frame(frame({ ticks: 120000, burn: false }));
		const changed = fixture.source.encoded.slice(0);
		new Uint8Array(changed)[0] ^= 1;
		const digest = await typeCardReferenceDigest(changed);
		const bad = {
			...fixture.source,
			encoded: changed,
			resource: {
				...fixture.source.resource,
				sha256: digest,
				attachmentKey: `programmatic-sha256-${digest}`,
			},
		};
		rejected = false;
		try {
			await createHeartOwnerProvider({
				owner,
				source: bad,
				ceilingBytes: 64 * 1024 * 1024,
				capabilityJson,
				createBitmap: createHeartNativeUploadBitmap,
			});
		} catch {
			rejected = true;
		}
		requireCheck({
			name: "actual-owner-invalid-PNG-header-failclosed",
			valid: rejected && state(owner).sessions === baseline.sessions,
		});
		const controller = new AbortController();
		let lateClosed = 0,
			releaseUpload: () => void = () => {
				throw Error("late upload not started");
			},
			started: () => void = () => {};
		const startedPromise = new Promise<void>((resolve) => {
			started = resolve;
		});
		const cancelled = createHeartOwnerProvider({
			owner,
			source: fixture.source,
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			signal: controller.signal,
			createBitmap: async (input) => {
				const bitmap = await createHeartNativeUploadBitmap(input),
					close = bitmap.close.bind(bitmap);
				bitmap.close = () => {
					lateClosed++;
					close();
				};
				started();
				await new Promise<void>((resolve) => {
					releaseUpload = resolve;
				});
				return bitmap;
			},
		});
		await Promise.race([
			startedPromise,
			cancelled.then(() => {
				throw Error("Cancellation upload completed before barrier");
			}),
		]);
		try {
			controller.abort();
			requireCheck({
				name: "cancel-retains-reservation-until-native-drain",
				valid: state(owner).sessions === Number(baseline.sessions) + 1,
			});
		} finally {
			releaseUpload();
		}
		rejected = false;
		try {
			await cancelled;
		} catch {
			rejected = true;
		}
		requireCheck({
			name: "late-native-bitmap-closed-isolated",
			valid:
				rejected &&
				lateClosed === 1 &&
				state(owner).sessions === baseline.sessions,
		});
		provider.frame(frame({ ticks: 0, burn: false }));
		provider.dispose();
		provider = undefined;
		requireCheck({
			name: "all-owner-session-reservations-released",
			valid: state(owner).sessions === 0 && state(owner).reservedBytes === 0,
		});
		return {
			passed: true,
			scope:
				"prototype exact1024 native capacity plus dedicated20px original drawBreak(shatter/burn) pixel boundary; no public/full-MV/export acceptance",
			observations,
			repeats,
			checks,
			capability,
			capacity: globalThis.__heartOwnerCapacity,
			aggregateCapacity: globalThis.__heartOwnerAggregateCapacity,
			fixture: {
				width: 20,
				height: 20,
				encodedSha256: fixture.source.resource.sha256,
			},
			thresholds: { maxChannelAtMost: 2, maeLessThan: 0.025 },
			publicSourceDispatchTested: false,
			wholeFilmTested: false,
			exportTested: false,
			ordinary1024CapacityAccepted: true,
		};
	} finally {
		try {
			provider?.dispose();
		} finally {
			try {
				oracle?.dispose();
				raster?.dispose();
				fixture?.bitmap.close();
			} finally {
				try {
					owner.dispose();
				} finally {
					owner.free();
				}
			}
		}
	}
}
run()
	.then((result) => {
		globalThis.__heartOwnerResult = result;
	})
	.catch((error) => {
		globalThis.__heartOwnerResult = {
			passed: false,
			error: String(error?.stack ?? error),
			checks,
			spriteDiagnostic: globalThis.__heartOwnerSpriteDiagnostic,
			failedFrame: globalThis.__heartOwnerFailedFrame,
			capacity: globalThis.__heartOwnerCapacity,
			aggregateCapacity: globalThis.__heartOwnerAggregateCapacity,
		};
	});
