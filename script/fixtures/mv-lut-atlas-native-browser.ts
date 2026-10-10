import * as wasm from "opencut-wasm";
import { compareLutAtlasPixels } from "./mv-lut-atlas-browser";
import type {
	MvLutAtlasPlan,
	MvLutAtlasRowSample,
} from "../../packages/editor-contracts/src/mv-lut-atlas";
import { isProgrammaticResource } from "../../packages/editor-contracts/src/programmatic-resources";
interface Owner {
	prepare(metadata: string, bytes: Uint8Array): unknown;
	sample(id: number, alias: string): unknown;
	resolveParameters(id: number, json: string): unknown;
	bindRow(id: number, alias: string, rgba: Uint8Array): unknown;
	rowPixels(id: number, alias: string): Uint8Array;
	dispose(id: number): void;
	clear(): void;
	free(): void;
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function owner(value: unknown): value is Owner {
	return (
		record(value) &&
		[
			"prepare",
			"sample",
			"resolveParameters",
			"bindRow",
			"rowPixels",
			"dispose",
			"clear",
			"free",
		].every((key) => typeof value[key] === "function")
	);
}
function tuple(value: unknown, length: number): value is number[] {
	return (
		Array.isArray(value) &&
		value.length === length &&
		value.every((n) => typeof n === "number" && Number.isFinite(n))
	);
}
function sample(value: unknown): value is MvLutAtlasRowSample {
	return (
		record(value) &&
		typeof value.row === "number" &&
		typeof value.atlasSha256 === "string" &&
		tuple(value.rect, 4) &&
		value.rect[0] === 0 &&
		value.rect[2] === 256 &&
		value.rect[3] === 1 &&
		(value.sourceResource === null ||
			isProgrammaticResource(value.sourceResource))
	);
}
function plan(value: unknown): value is MvLutAtlasPlan {
	if (
		!record(value) ||
		value.version !== 1 ||
		value.profile !== "original-lut-atlas-v1" ||
		!tuple(value.size, 2) ||
		value.size[0] !== 256 ||
		value.size[1] !== 16 ||
		!isProgrammaticResource(value.paletteResource) ||
		typeof value.atlasSha256 !== "string" ||
		typeof value.usedRows !== "number" ||
		typeof value.allocationBytes !== "number" ||
		!record(value.aliases) ||
		!Object.values(value.aliases).every((n) => typeof n === "number") ||
		!record(value.palettes) ||
		!Array.isArray(value.rows)
	)
		return false;
	return value.rows.every(
		(row) =>
			record(row) &&
			typeof row.row === "number" &&
			tuple(row.destinationRect, 4) &&
			((row.kind === "image" &&
				isProgrammaticResource(row.resource) &&
				tuple(row.sourceRect, 4)) ||
				(row.kind === "ramp" &&
					typeof row.name === "string" &&
					tuple(row.gradientPoints, 4) &&
					Array.isArray(row.stops) &&
					row.stops.every(
						(stop) =>
							Array.isArray(stop) &&
							stop.length === 2 &&
							typeof stop[0] === "number" &&
							typeof stop[1] === "string",
					))),
	);
}
interface Input {
	reference: { id: "core/main.js"; code: string; sha256: string };
	palette: { resourceId: string; bytes: string; sha256: string };
	images: { path: string; resourceId: string; bytes: string; sha256: string }[];
	metadata: Record<string, unknown>;
}
function input(value: unknown): value is Input {
	return (
		record(value) &&
		record(value.reference) &&
		value.reference.id === "core/main.js" &&
		typeof value.reference.code === "string" &&
		typeof value.reference.sha256 === "string" &&
		record(value.palette) &&
		typeof value.palette.resourceId === "string" &&
		typeof value.palette.bytes === "string" &&
		typeof value.palette.sha256 === "string" &&
		Array.isArray(value.images) &&
		value.images.every(
			(i) =>
				record(i) &&
				typeof i.path === "string" &&
				typeof i.resourceId === "string" &&
				typeof i.bytes === "string" &&
				typeof i.sha256 === "string",
		) &&
		record(value.metadata)
	);
}
function binary(base64: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
function rejects({
	label,
	call,
}: {
	label: string;
	call: () => unknown;
}): void {
	let rejected = false;
	try {
		call();
	} catch {
		rejected = true;
	}
	if (!rejected) throw Error("Native LUT negative accepted: " + label);
}
async function run() {
	const supplied: unknown = Reflect.get(globalThis, "__lutAtlasInput");
	if (!input(supplied)) throw Error("Native LUT runner inputs unavailable");
	const constructor: unknown = Reflect.get(wasm, "MvLutAtlasOwner");
	if (typeof constructor !== "function")
		throw Error("Private WASM lacks actual LUT owner");
	const instance: unknown = Reflect.construct(constructor, []);
	if (!owner(instance)) throw Error("Private WASM LUT owner ABI missing");
	const images = supplied.images.map((i) => ({
		...i,
		bytes: binary(i.bytes).buffer,
	}));
	const palette = {
		...supplied.palette,
		bytes: binary(supplied.palette.bytes).buffer,
	};
	const parts = [
		new Uint8Array(palette.bytes),
		...images.map((i) => new Uint8Array(i.bytes)),
	];
	const combined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		combined.set(part, offset);
		offset += part.byteLength;
	}
	let sessionId: number | undefined;
	let preparedMetadata: Record<string, unknown> | undefined;
	try {
		const report = await compareLutAtlasPixels({
			reference: supplied.reference,
			palette,
			images,
			evaluateNativePlan: async ({ images: decoded, requiredAlias }) => {
				const metadata = {
					...supplied.metadata,
					decodedImages: decoded,
					requiredAliases: [requiredAlias],
				};
				preparedMetadata = metadata;
				const result = instance.prepare(JSON.stringify(metadata), combined);
				if (
					!record(result) ||
					typeof result.sessionId !== "number" ||
					!plan(result.plan) ||
					!record(result.samples) ||
					!sample(result.samples[requiredAlias])
				)
					throw Error("Actual Rust LUT prepare receipt malformed");
				sessionId = result.sessionId;
				return { plan: result.plan, sample: result.samples[requiredAlias] };
			},
		});
		if (sessionId === undefined)
			throw Error("Actual LUT native owner session absent");
		const post = instance.resolveParameters(
			sessionId,
			JSON.stringify({ lutA: "P4", lutMix: 0.18 }),
		);
		if (
			!record(post) ||
			post.lutA !== report.requiredRow ||
			post.lutB !== report.requiredRow
		)
			throw Error("Rust P4/post row resolution mismatch");
		const binding = instance.bindRow(
			sessionId,
			"P4",
			new Uint8Array(report.rowRgba),
		);
		if (
			!record(binding) ||
			binding.byteLength !== 1024 ||
			typeof binding.sampledSha256 !== "string" ||
			!sample(binding.sample) ||
			binding.sample.row !== report.requiredRow
		)
			throw Error("Actual Rust row pixel receipt malformed");
		const taken = instance.rowPixels(sessionId, "P4");
		if (
			taken.length !== report.rowRgba.length ||
			taken.some((v, i) => v !== report.rowRgba[i])
		)
			throw Error("Actual Rust row pixels differ");
		if (!preparedMetadata || !Array.isArray(preparedMetadata.decodedImages))
			throw Error("Native metadata baseline missing");
		const activeId = sessionId;
		const corrupted = combined.slice();
		corrupted[corrupted.length - 1] ^= 1;
		rejects({
			label: "actual resource SHA",
			call: () => instance.prepare(JSON.stringify(preparedMetadata), corrupted),
		});
		rejects({
			label: "unclaimed/short binary",
			call: () =>
				instance.prepare(
					JSON.stringify(preparedMetadata),
					combined.subarray(0, combined.length - 1),
				),
		});
		const wrongDimensions = {
			...preparedMetadata,
			decodedImages: preparedMetadata.decodedImages.map((fact, index) =>
				record(fact) && index === 0 ? { ...fact, width: 255 } : fact,
			),
		};
		rejects({
			label: "false decoded dimensions",
			call: () => instance.prepare(JSON.stringify(wrongDimensions), combined),
		});
		rejects({
			label: "missing required alias",
			call: () =>
				instance.prepare(
					JSON.stringify({
						...preparedMetadata,
						requiredAliases: ["missing-alias"],
					}),
					combined,
				),
		});
		rejects({
			label: "JS integer coercion",
			call: () => instance.sample(Number.NaN, "P4"),
		});
		rejects({
			label: "unknown named post",
			call: () =>
				instance.resolveParameters(
					activeId,
					JSON.stringify({ lutA: "missing-alias" }),
				),
		});
		let shortRejected = false;
		try {
			instance.bindRow(sessionId, "P4", new Uint8Array(1023));
		} catch {
			shortRejected = true;
		}
		if (!shortRejected) throw Error("Native row length negative accepted");
		instance.dispose(sessionId);
		let staleRejected = false;
		try {
			instance.sample(sessionId, "P4");
		} catch {
			staleRejected = true;
		}
		if (!staleRejected) throw Error("Native stale owner negative accepted");
		const {
			nativeRgba: _native,
			originalRgba: _original,
			rowRgba: _row,
			...metrics
		} = report;
		Reflect.set(globalThis, "__lutAtlasResult", {
			status: "passed",
			...metrics,
			post,
			rowPixelSha256: binding.sampledSha256,
			nativeRowByteLength: taken.length,
			negativeCount: 8,
			scope:
				"real resource bytes/native plan/exact atlas pixels/P4 resolution/row binding; not full movie/post GL/export",
		});
	} finally {
		instance.clear();
		instance.free();
	}
}
void run().catch((error) =>
	Reflect.set(globalThis, "__lutAtlasResult", {
		status: "failed",
		error: error instanceof Error ? error.message : String(error),
	}),
);
