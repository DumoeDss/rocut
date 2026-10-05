import type {
	MotionTextFontAssetRef,
	MotionTextSequence,
} from "@opencut/editor-contracts";

import {
	inspectMotionTextFont,
	inspectMotionTextFontCoverage,
} from "../../../wasm/motion-text-font";
import type {
	MotionTextRenderDiagnostic,
	MotionTextResolvedFont,
} from "./types";

export type MotionTextRenderPurpose = "preview" | "export";

export interface MotionTextFontBytesLoader {
	loadBuiltinFont(args: {
		font: MotionTextFontAssetRef;
		signal: AbortSignal;
	}): Promise<ArrayBuffer>;
	loadProjectFont(args: {
		projectId: string;
		assetId: string;
		signal: AbortSignal;
	}): Promise<ArrayBuffer | null>;
}

type MotionTextFontInspector = typeof inspectMotionTextFont;
type MotionTextFontCoverageInspector = typeof inspectMotionTextFontCoverage;

export interface MotionTextFontFaceHandle {
	readonly family: string;
	readonly native: FontFace | null;
}

export interface MotionTextFontEnvironment {
	loadSystemFont(args: { font: MotionTextFontAssetRef }): Promise<void>;
	loadFontFace(args: {
		font: MotionTextFontAssetRef;
		family: string;
		bytes: Uint8Array;
	}): Promise<MotionTextFontFaceHandle>;
	addFontFace(face: MotionTextFontFaceHandle): void;
	deleteFontFace(face: MotionTextFontFaceHandle): void;
}

export interface MotionTextFontRuntimeOptions extends MotionTextFontBytesLoader {
	readonly environment?: MotionTextFontEnvironment;
	readonly inspectFont?: MotionTextFontInspector;
	readonly inspectCoverage?: MotionTextFontCoverageInspector;
}

export interface PreparedMotionTextFonts {
	readonly diagnostics: readonly MotionTextRenderDiagnostic[];
	readonly fingerprint: string;
	readonly fonts: ReadonlyMap<string, MotionTextResolvedFont>;
	readonly generation: number;
}

export interface MotionTextFontRuntimeSnapshot {
	readonly generation: number;
	readonly cachedFonts: number;
	readonly loadedFaces: number;
	readonly pendingLoads: number;
	readonly disposed: boolean;
}

interface LoadedFont {
	readonly bytes: Uint8Array | null;
	readonly digest: string | null;
	readonly font: MotionTextResolvedFont;
	readonly face: MotionTextFontFaceHandle | null;
	readonly system: boolean;
}

class MotionTextFontGenerationError extends Error {
	constructor() {
		super("Motion-text font preparation became stale.");
		this.name = "MotionTextFontGenerationError";
	}
}

export class MotionTextFontRuntime {
	private readonly cachedFonts = new Map<string, Promise<LoadedFont>>();
	private readonly controllers = new Set<AbortController>();
	private readonly loadedFaces = new Set<MotionTextFontFaceHandle>();
	private generation = 0;
	private disposed = false;
	private hasFailedLoads = false;
	private readonly loader: MotionTextFontBytesLoader;
	private readonly inspectFont: MotionTextFontInspector;
	private readonly inspectCoverage: MotionTextFontCoverageInspector;
	private readonly environment: MotionTextFontEnvironment;

	constructor(options: MotionTextFontRuntimeOptions) {
		this.loader = options;
		this.inspectFont = options.inspectFont ?? inspectMotionTextFont;
		// Custom inspectors remain compatible; production validates/digests the
		// immutable loaded bytes once, then checks changing glyphs without hashing.
		this.inspectCoverage =
			options.inspectCoverage ??
			options.inspectFont ??
			inspectMotionTextFontCoverage;
		this.environment = options.environment ?? BROWSER_FONT_ENVIRONMENT;
	}

	async prepareSequence({
		projectId,
		purpose,
		sequence,
	}: {
		projectId: string;
		purpose: MotionTextRenderPurpose;
		sequence: MotionTextSequence;
	}): Promise<PreparedMotionTextFonts> {
		this.assertLive();
		const generation = this.generation;
		const textByFont = referencedTextByFont({ sequence });
		if (textByFont.size === 0) {
			return {
				diagnostics: [],
				fingerprint: `fonts:${generation}:none`,
				fonts: new Map(),
				generation,
			};
		}

		const diagnostics: MotionTextRenderDiagnostic[] = [];
		const resolvedFonts = new Map<string, MotionTextResolvedFont>();
		const fingerprints: string[] = [];
		for (const [fontId, text] of textByFont) {
			const font = sequence.fonts.find((candidate) => candidate.id === fontId);
			if (!font) continue;
			try {
				const loaded = await this.loadFont({
					font,
					projectId,
					generation,
				});
				this.assertGeneration({ generation });
				const issue = inspectLoadedFont({
					font,
					loaded,
					text,
					purpose,
					inspectFont: this.inspectCoverage,
				});
				if (issue) diagnostics.push(issue);
				if (!issue || purpose === "preview") {
					resolvedFonts.set(font.id, loaded.font);
				}
				fingerprints.push(loaded.font.fingerprint);
			} catch (error) {
				if (error instanceof MotionTextFontGenerationError) throw error;
				diagnostics.push(
					fontDiagnostic({
						font,
						purpose,
						code: diagnosticCodeForError(error),
						message: `Failed to prepare motion-text font ${font.id}: ${errorMessage(error)}`,
					}),
				);
			}
		}

		return {
			diagnostics,
			fingerprint: `fonts:${generation}:${fingerprints.sort().join("|")}`,
			fonts: resolvedFonts,
			generation,
		};
	}

	// Retry only on an explicit export attempt, not on every preview frame.
	// A generation change also retires nodes that cached fallback preparation.
	retryFailedLoads(): void {
		this.assertLive();
		if (this.hasFailedLoads) this.invalidate();
	}

	invalidate(): void {
		if (this.disposed) return;
		this.generation += 1;
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
		this.cachedFonts.clear();
		this.hasFailedLoads = false;
		this.releaseFaces();
	}

	dispose(): void {
		if (this.disposed) return;
		this.invalidate();
		this.disposed = true;
	}

	inspect(): MotionTextFontRuntimeSnapshot {
		return {
			generation: this.generation,
			cachedFonts: this.cachedFonts.size,
			loadedFaces: this.loadedFaces.size,
			pendingLoads: this.controllers.size,
			disposed: this.disposed,
		};
	}

	private loadFont({
		font,
		projectId,
		generation,
	}: {
		font: MotionTextFontAssetRef;
		projectId: string;
		generation: number;
	}): Promise<LoadedFont> {
		const key = fontCacheKey({ font, projectId });
		const cached = this.cachedFonts.get(key);
		if (cached) return cached;
		const pending = this.loadFontUncached({
			font,
			projectId,
			generation,
		}).catch((error: unknown) => {
			if (!this.disposed && generation === this.generation) {
				this.hasFailedLoads = true;
			}
			throw error;
		});
		this.cachedFonts.set(key, pending);
		return pending;
	}

	private async loadFontUncached({
		font,
		projectId,
		generation,
	}: {
		font: MotionTextFontAssetRef;
		projectId: string;
		generation: number;
	}): Promise<LoadedFont> {
		if (font.source === "system") {
			await this.environment.loadSystemFont({ font });
			this.assertGeneration({ generation });
			return {
				bytes: null,
				digest: null,
				face: null,
				font: resolvedFont({ font, family: font.family, digest: "system" }),
				system: true,
			};
		}

		const controller = new AbortController();
		this.controllers.add(controller);
		let registeredFace: MotionTextFontFaceHandle | null = null;
		try {
			const buffer =
				font.source === "project"
					? await this.loader.loadProjectFont({
							projectId,
							assetId: requiredAssetId(font),
							signal: controller.signal,
						})
					: await this.loader.loadBuiltinFont({
							font,
							signal: controller.signal,
						});
			if (!buffer) throw new Error("font attachment is missing");
			this.assertGeneration({ generation });
			const bytes = new Uint8Array(buffer.slice(0));
			const validation = this.inspectFont({ bytes, text: "" });
			if (!validation.inspection) {
				throw new Error(validation.error ?? "invalid-font:unknown");
			}
			const digest = validation.inspection.contentDigest;
			if (
				font.contentDigest &&
				!digestsEqual({ expected: font.contentDigest, actual: digest })
			) {
				throw new Error(
					`font-digest-mismatch:expected ${font.contentDigest}, received ${digest}`,
				);
			}
			const family = isolatedFamily({ font, digest });
			registeredFace = await this.environment.loadFontFace({
				font,
				family,
				bytes,
			});
			this.assertGeneration({ generation });
			this.environment.addFontFace(registeredFace);
			this.loadedFaces.add(registeredFace);
			return {
				bytes,
				digest,
				face: registeredFace,
				font: resolvedFont({ font, family, digest }),
				system: false,
			};
		} catch (error) {
			if (registeredFace) {
				this.environment.deleteFontFace(registeredFace);
				this.loadedFaces.delete(registeredFace);
			}
			if (generation !== this.generation || controller.signal.aborted) {
				throw new MotionTextFontGenerationError();
			}
			throw error;
		} finally {
			this.controllers.delete(controller);
		}
	}

	private assertGeneration({ generation }: { generation: number }): void {
		this.assertLive();
		if (generation !== this.generation) {
			throw new MotionTextFontGenerationError();
		}
	}

	private assertLive(): void {
		if (this.disposed) {
			throw new Error("Motion-text font runtime is disposed.");
		}
	}

	private releaseFaces(): void {
		for (const face of this.loadedFaces) this.environment.deleteFontFace(face);
		this.loadedFaces.clear();
	}
}

function referencedTextByFont({
	sequence,
}: {
	sequence: MotionTextSequence;
}): ReadonlyMap<string, string> {
	const text = new Map<string, string[]>();
	for (const cut of sequence.resolvedPlan?.cuts ?? []) {
		const fontId = cut.fontId ?? sequence.defaults.fontId;
		if (!fontId) continue;
		const entries = text.get(fontId) ?? [];
		entries.push(cut.text);
		text.set(fontId, entries);
	}
	return new Map(
		[...text].map(([fontId, entries]) => [fontId, entries.join("\n")]),
	);
}

function inspectLoadedFont({
	font,
	loaded,
	text,
	purpose,
	inspectFont,
}: {
	font: MotionTextFontAssetRef;
	loaded: LoadedFont;
	text: string;
	purpose: MotionTextRenderPurpose;
	inspectFont: MotionTextFontCoverageInspector;
}): MotionTextRenderDiagnostic | null {
	if (loaded.system) {
		if (purpose === "export") {
			return fontDiagnostic({
				font,
				purpose,
				code: "unverifiable-system-font",
				message: `System font ${font.family} cannot provide a reproducible export digest.`,
			});
		}
		return null;
	}
	if (!loaded.bytes) return null;
	const result = inspectFont({ bytes: loaded.bytes, text });
	if (!result.inspection) {
		return fontDiagnostic({
			font,
			purpose,
			code: "invalid-font",
			message: `Motion-text font ${font.id} is invalid: ${result.error ?? "unknown error"}.`,
		});
	}
	if (result.inspection.missingCodePoints.length === 0) return null;
	return {
		...fontDiagnostic({
			font,
			purpose,
			code: "missing-glyph",
			message: `Motion-text font ${font.id} is missing ${result.inspection.missingCodePoints.length} required glyphs.`,
		}),
		codePoints: result.inspection.missingCodePoints,
	};
}

function fontDiagnostic({
	font,
	purpose,
	code,
	message,
}: {
	font: MotionTextFontAssetRef;
	purpose: MotionTextRenderPurpose;
	code: MotionTextRenderDiagnostic["code"];
	message: string;
}): MotionTextRenderDiagnostic {
	return {
		severity: purpose === "export" ? "error" : "warning",
		code,
		fontId: font.id,
		message,
	};
}

function fontCacheKey({
	font,
	projectId,
}: {
	font: MotionTextFontAssetRef;
	projectId: string;
}): string {
	return JSON.stringify({
		projectId: font.source === "project" ? projectId : null,
		id: font.id,
		source: font.source,
		assetId: font.assetId ?? null,
		contentDigest: font.contentDigest ?? null,
		builtinPath: font.builtinPath ?? null,
		family: font.family,
		style: font.style,
		weight: font.weight,
	});
}

function requiredAssetId(font: MotionTextFontAssetRef): string {
	if (!font.assetId) throw new Error("project font has no asset id");
	return font.assetId;
}

function isolatedFamily({
	font,
	digest,
}: {
	font: MotionTextFontAssetRef;
	digest: string;
}): string {
	const id = font.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 32);
	const suffix = digest.replace(/^sha256:/u, "").slice(0, 16);
	return `__rocut_mt_${id}_${suffix}`;
}

function resolvedFont({
	font,
	family,
	digest,
}: {
	font: MotionTextFontAssetRef;
	family: string;
	digest: string;
}): MotionTextResolvedFont {
	return {
		family,
		style: font.style,
		weight: font.weight,
		fingerprint: `${font.id}:${font.source}:${family}:${font.style}:${font.weight}:${digest}`,
	};
}

function digestsEqual({
	expected,
	actual,
}: {
	expected: string;
	actual: string;
}): boolean {
	const normalize = (value: string) =>
		value.toLowerCase().replace(/^sha-?256:/u, "");
	return normalize(expected) === normalize(actual);
}

function quoteFamily(family: string): string {
	return `"${family.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

const BROWSER_FONT_ENVIRONMENT: MotionTextFontEnvironment = {
	async loadSystemFont({ font }) {
		if (typeof document === "undefined" || !document.fonts) {
			throw new Error("font-load-failed:FontFaceSet is unavailable");
		}
		const css = `${font.style} ${font.weight} 16px ${quoteFamily(font.family)}`;
		await document.fonts.load(css);
		if (!document.fonts.check(css)) {
			throw new Error(
				`font-load-failed:System font ${font.family} is unavailable`,
			);
		}
	},
	async loadFontFace({ font, family, bytes }) {
		if (typeof FontFace === "undefined") {
			throw new Error("font-load-failed:FontFace is unavailable");
		}
		const native = await new FontFace(family, bytes.slice().buffer, {
			style: font.style,
			weight: String(font.weight),
		}).load();
		return { family, native };
	},
	addFontFace(face) {
		if (typeof document === "undefined" || !document.fonts || !face.native) {
			throw new Error("font-load-failed:FontFaceSet is unavailable");
		}
		document.fonts.add(face.native);
	},
	deleteFontFace(face) {
		if (typeof document !== "undefined" && face.native) {
			document.fonts.delete(face.native);
		}
	},
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function diagnosticCodeForError(
	error: unknown,
): MotionTextRenderDiagnostic["code"] {
	const message = errorMessage(error);
	if (message.includes("font-digest-mismatch")) {
		return "font-digest-mismatch";
	}
	if (message.includes("invalid-font")) return "invalid-font";
	return "font-load-failed";
}
