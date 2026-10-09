import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { THREAD_REFERENCE_FILES } from "./mv-thread-contract";
import type {
	FlameReference,
	FlameSong,
	FlameOracleFrame,
	FlameOracleEngine,
} from "./mv-flame-oracle-contract";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the original realm boundary instead of narrowing a Window by cast. */
function isOriginalFlameEngine(value: unknown): value is FlameOracleEngine {
	if (
		!isRecord(value) ||
		!isRecord(value.SCENES) ||
		!isRecord(value.loaded) ||
		!isRecord(value.__darkDebug)
	)
		return false;
	const { SCENES, loaded } = value;
	return (
		["makeClock", "makeEnv", "canvas"].every(
			(key) => typeof value[key] === "function",
		) &&
		["get", "set", "has"].every((key) => typeof loaded[key] === "function") &&
		["thread", "fall", "flame", "ink"].every((key) => {
			const scene = SCENES[key];
			return (
				isRecord(scene) &&
				typeof scene.preload === "function" &&
				typeof scene.draw === "function"
			);
		})
	);
}

/** Whole unchanged originals own all scene math, clock, envelope and caches.
 * The existing debug canvas exposes original deflamed pixels AFTER feathering.
 */
export async function createFlameOracle({
	reference: inputReference,
	song: inputSong,
	resources: inputResources,
}: {
	reference: FlameReference;
	song: FlameSong;
	resources: readonly ResolvedProgrammaticResource[];
}) {
	const reference = structuredClone(inputReference),
		song = structuredClone(inputSong);
	const resources = inputResources.map(({ resource, body }) => ({
		resource: structuredClone(resource),
		body: body.slice(0),
	}));
	if (
		reference.version !== 1 ||
		reference.scripts.length !== THREAD_REFERENCE_FILES.length
	)
		throw Error("Incomplete original Flame source");
	for (const [index, source] of reference.scripts.entries())
		if (
			source.id !== THREAD_REFERENCE_FILES[index] ||
			(await digest(new TextEncoder().encode(source.code).buffer)) !==
				source.sha256
		)
			throw Error("Flame original script identity mismatch");
	const ids = new Set<string>();
	for (const { resource, body } of resources) {
		if (
			resource.kind !== "image" ||
			ids.has(resource.id) ||
			body.byteLength !== resource.byteLength ||
			(await digest(body)) !== resource.sha256
		)
			throw Error("Flame original image identity mismatch");
		ids.add(resource.id);
	}
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Complete original Flame oracle";
	iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid"><base href="https://rocut-oracle.invalid/"><body></body>`;
	const bitmaps: ImageBitmap[] = [];
	const dispose = () => {
		for (const bitmap of bitmaps) bitmap.close();
		bitmaps.length = 0;
		iframe.remove();
	};
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Flame original realm timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("Flame original realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow;
		if (!realm?.document) throw Error("Flame original realm is inaccessible");
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(`Complete original Flame script: ${event.message}`);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			for (const source of reference.scripts) {
				const script = realm.document.createElement("script");
				script.textContent = source.code;
				realm.document.body.append(script);
				if (scriptError) throw scriptError;
			}
		} finally {
			realm.removeEventListener("error", onError);
		}
		const engine: unknown = Reflect.get(realm, "Z");
		if (!isOriginalFlameEngine(engine))
			throw Error("Complete dark.js Flame registrations missing");
		const scene = engine.SCENES.flame;
		for (const { resource, body } of resources) {
			const bitmap = await realm.createImageBitmap(
				new Blob([body], { type: resource.mimeType }),
				{
					premultiplyAlpha: "default",
					colorSpaceConversion: "none",
				},
			);
			bitmaps.push(bitmap);
			engine.loaded.set(resource.id, bitmap);
		}
		const clock = engine.makeClock(song.beats, song.bpm, song.downbeatIndex0);
		const env = engine.makeEnv(song.envelope);
		engine.audio = { stops: song.stops ?? [] };
		const bindings = new Map<string, string>();
		let disposed = false;
		return {
			dispose() {
				if (!disposed) {
					disposed = true;
					dispose();
				}
			},
			render(input: FlameOracleFrame) {
				if (disposed) throw Error("Flame original realm already disposed");
				const frame = structuredClone(input);
				const preloaded = scene.preload(frame.args);
				if (preloaded.length !== 1 || !engine.loaded.has(preloaded[0]!))
					throw Error("Unadmitted original Flame preload");
				if (frame.args.mode !== "dark") {
					// Original cache is keyed only by path. A changed author binding
					// needs a fresh realm, not stale cached pixels used as an oracle.
					const key = preloaded[0]!,
						value = JSON.stringify(frame.args.flameAt ?? "original-default");
					if (bindings.has(key) && bindings.get(key) !== value)
						throw Error(
							"Changed Flame landmarks require a fresh original realm",
						);
					bindings.set(key, value);
				}
				const canvas = engine.canvas(1920, 1080),
					ctx = canvas.getContext("2d")!;
				try {
					scene.draw(ctx, {
						args: frame.args,
						t: frame.time,
						lt: frame.time - frame.shotStart,
						dur: frame.duration,
						p: (frame.time - frame.shotStart) / frame.duration,
						shot: { t0: frame.shotStart, t1: frame.shotStart + frame.duration },
						clock,
						env,
					});
					const prepared =
						frame.args.mode === "dark"
							? undefined
							: engine.__darkDebug.deflamed;
					if (frame.args.mode !== "dark" && !prepared)
						throw Error("Original Flame did not expose its prepared canvas");
					return {
						canvas,
						pixels: ctx.getImageData(0, 0, 1920, 1080).data,
						prepared: prepared
							? {
									width: prepared.width,
									height: prepared.height,
									pixels: prepared
										.getContext("2d")!
										.getImageData(0, 0, prepared.width, prepared.height).data,
								}
							: undefined,
						provenance: {
							scripts: reference.scripts.map(({ id, sha256 }) => ({
								id,
								sha256,
							})),
							frame,
							song,
							images: resources.map(({ resource }) => resource),
							scope:
								"Whole unchanged original Flame and makeEnv; original debug canvas after diffusion and feathering; no native expected pixels",
						},
					};
				} catch (error) {
					canvas.width = canvas.height = 1;
					throw error;
				}
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
