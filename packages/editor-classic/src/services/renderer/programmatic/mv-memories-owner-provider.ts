import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { DECODER, digest } from "./mv-memories-owner-protocol";
import * as json from "./mv-memories-owner-json";
import type {
	Disposable,
	MemoriesOwnerApi,
	MemoriesOwnerStatics,
	MemoriesOutput,
	MemoriesStage,
	MvMemories,
	MvMemoriesPlan,
	Publication,
} from "./mv-memories-owner-protocol";
import type { MemoriesNativePlatform } from "./mv-memories-owner-native";
/** Native render lifetime only. Authored JSON never contains facts, stage handles,
 * RGBA, native font metrics, or resource URL fallbacks. */
export async function createMemoriesOwnerProvider({
	owner,
	statics,
	args,
	resources,
	ceilingBytes,
	loadBytes,
	native,
	signal,
}: {
	owner: MemoriesOwnerApi;
	statics: MemoriesOwnerStatics;
	args: MvMemories;
	resources: readonly ProgrammaticResource[];
	ceilingBytes: number;
	loadBytes: (resource: ProgrammaticResource) => Promise<Uint8Array>;
	native: MemoriesNativePlatform;
	signal?: AbortSignal;
}) {
	const authored = structuredClone(args),
		descriptors = structuredClone(resources),
		argsJson = JSON.stringify(authored);
	const capability = json.parse({
		input: statics.capabilityJson(),
		guard: json.capability,
	});
	if (
		!Number.isSafeInteger(ceilingBytes) ||
		ceilingBytes <= 0 ||
		ceilingBytes > capability.maxOwnerBytes ||
		!capability.opaqueStages
	)
		throw Error("Memories owner capability unavailable");
	signal?.throwIfAborted();
	const requests = json.parse({
		input: statics.sourceRequestsJson(argsJson, JSON.stringify(descriptors)),
		guard: json.requests,
	});
	const identity = json.parse({
		input: owner.diagnosticJson(),
		guard: json.diagnostic,
	});
	if (identity.disposed || !Number.isSafeInteger(identity.ownerId))
		throw Error("Memories native owner identity unavailable");
	let ticket: Disposable | undefined = owner.reserve(ceilingBytes),
		session: number | undefined,
		stage: MemoriesStage | undefined;
	let closed = false,
		disposed = false,
		active: Promise<unknown> | undefined;
	const check = () => {
		signal?.throwIfAborted();
		if (closed) throw Error("Memories native lifetime cancelled");
	};
	const publication = (output: MemoriesOutput) => {
		const data = json.parse({ input: output.json(), guard: json.publication });
		if (
			data.identity.ownerId !== identity.ownerId ||
			data.identity.sessionId !== session
		)
			throw Error("Memories publication owner/session mismatch");
		return data;
	};
	const upload = async (output: MemoriesOutput) => {
		try {
			const data = publication(output);
			for (const [index, r] of data.rasters.entries()) {
				check();
				const bytes = output.bytes(index);
				await native.upload({ r, bytes });
				check();
			}
			if (data.retired) native.release(data.retired);
			return data;
		} finally {
			output.free();
		}
	};
	const release = () => {
		if (disposed) return;
		disposed = true;
		// Only after all source loads, digest/readback/upload promises have settled.
		native.dispose();
		stage?.free();
		stage = undefined;
		ticket?.free();
		ticket = undefined;
		if (session !== undefined) {
			owner.cancel(session);
			session = undefined;
		}
	};
	const prepareStage = async ({
		kind,
		slot = 0,
	}: {
		kind: string;
		slot?: number;
	}) => {
		check();
		stage = owner.beginStage(session!, kind, slot);
		const data = json.parse({ input: stage.json(), guard: json.stage });
		if ((await digest(new TextEncoder().encode(data.planJson))) !== data.planSha256)
			throw Error("Memories original Rust stage plan digest mismatch");
		check();
		if (
			data.output.identity.ownerId !== identity.ownerId ||
			data.output.identity.sessionId !== session
		)
			throw Error("Memories native stage identity mismatch");
		for (const [index, r] of data.output.rasters.entries()) {
			await native.upload({ r, bytes: stage.bytes(index) });
			check();
		}
		const rgba = await native.readback({
			plan: json.parse({ input: data.planJson, guard: json.plan }),
			size: data.size,
		});
		check();
		const rgbaSha256 = await digest(rgba);
		check();
		const consumed = stage;
		stage = undefined;
		const out = owner.acceptStage(
			session!,
			consumed,
			JSON.stringify({
				planSha256: data.planSha256,
				rgbaSha256,
				width: data.size[0],
				height: data.size[1],
				decoder: DECODER,
			}),
			rgba,
		);
		if (out) await upload(out);
		for (const r of data.output.rasters) native.release(r);
	};
	try {
		const encodedParts: Uint8Array[] = [],
			decodedParts: Uint8Array[] = [],
			images: unknown[] = [],
			fontRanges: {
				resource: ProgrammaticResource;
				encoded: { offset: number; length: number };
			}[] = [];
		let encodedLength = 0,
			decodedLength = 0;
		// Exact sources and glyph strings selected by Rust, not reimplemented here.
		for (const resource of requests.images) {
			check();
			const borrowed = await loadBytes(resource);
			check();
			if (borrowed.byteLength !== resource.byteLength)
				throw Error("Memories encoded source length mismatch before snapshot");
			const bytes = new Uint8Array(borrowed);
			if (bytes.byteLength !== resource.byteLength)
				throw Error("Memories source snapshot length mismatch");
			const size = json.parse({
				input: statics.sourceAdmissionJson(
					argsJson,
					JSON.stringify(resource),
					bytes,
				),
				guard: json.dimensions,
			});
			if (
				encodedLength +
					bytes.byteLength +
					(decodedLength + size.width * size.height * 4) * 3 >
				ceilingBytes
			)
				throw Error("Memories native decode exceeds reserved lease");
			const rgba = await native.image({
				resource,
				bytes,
				width: size.width,
				height: size.height,
			});
			check();
			const rgbaSha256 = await digest(rgba);
			check();
			images.push({
				resource,
				width: size.width,
				height: size.height,
				rgbaSha256,
				encoded: { offset: encodedLength, length: bytes.byteLength },
				decoded: { offset: decodedLength, length: rgba.byteLength },
				decoder: DECODER,
			});
			encodedParts.push(bytes);
			decodedParts.push(rgba);
			encodedLength += bytes.byteLength;
			decodedLength += rgba.byteLength;
		}
		for (const resource of requests.fonts) {
			check();
			const borrowed = await loadBytes(resource);
			check();
			if (borrowed.byteLength !== resource.byteLength)
				throw Error("Memories encoded font length mismatch before snapshot");
			const bytes = new Uint8Array(borrowed);
			statics.sourceAdmissionJson(argsJson, JSON.stringify(resource), bytes);
			if (encodedLength + bytes.byteLength + decodedLength * 3 > ceilingBytes)
				throw Error("Memories native font exceeds reserved lease");
			await native.font({ resource, bytes });
			check();
			fontRanges.push({
				resource,
				encoded: { offset: encodedLength, length: bytes.byteLength },
			});
			encodedParts.push(bytes);
			encodedLength += bytes.byteLength;
		}
		const measurements = native.measure(requests.measurements);
		const fonts = fontRanges.map((f) => {
			const metric = measurements.find((m) => m.font === f.resource.id);
			if (!metric) throw Error("Memories requested font metric missing");
			return {
				...f,
				fontSize: metric.fontSize,
				weight: metric.weight,
				widths: metric.widths,
			};
		});
		const encoded = new Uint8Array(encodedLength),
			rgba = new Uint8Array(decodedLength);
		let offset = 0;
		for (const bytes of encodedParts) {
			encoded.set(bytes, offset);
			offset += bytes.byteLength;
		}
		offset = 0;
		for (const bytes of decodedParts) {
			rgba.set(bytes, offset);
			offset += bytes.byteLength;
		}
		encodedParts.length = decodedParts.length = 0;
		check();
		const consumed = ticket!;
		ticket = undefined;
		session = owner.prepareReserved(
			consumed,
			JSON.stringify({
				args: authored,
				resources: descriptors,
				images,
				fonts,
				ceilingBytes,
			}),
			encoded,
			rgba,
		);
		await prepareStage({ kind: "lut" });
		for (let slot = 0; slot < requests.photos; slot++) {
			await prepareStage({ kind: "composite", slot });
			await prepareStage({ kind: "print", slot });
		}
		await prepareStage({ kind: "desk" });
		const prepared = json.parse({
			input: owner.preparedJson(session),
			guard: json.prepared,
		});
		if (
			prepared.identity.ownerId !== identity.ownerId ||
			prepared.identity.sessionId !== session
		)
			throw Error("Memories prepared source identity mismatch");
		for (const [index, r] of prepared.rasters.entries()) {
			check();
			await native.upload({ r, bytes: owner.preparedBytes(session, index) });
			check();
		}
	} catch (error) {
		closed = true;
		release();
		throw error;
	}
	return {
		assets: native.assets,
		/** One publication in flight; readback and native uploads are drained even
		 * when abort arrives mid-digest or createImageBitmap. */
		async frame({
			input,
			draw,
		}: {
			input: unknown;
			draw: (plan: MvMemoriesPlan) => void;
		}) {
			check();
			if (active) throw Error("Memories frame already in flight");
			const run = async () => {
				let output: MemoriesOutput | undefined = owner.frame(
					session!,
					JSON.stringify(input),
				);
				let data: Publication | undefined;
				try {
					data = publication(output);
					for (const [index, r] of data.rasters.entries()) {
						check();
						await native.upload({ r, bytes: output.bytes(index) });
						check();
					}
					check();
					draw(data.plan);
					const consumed = output;
					output = undefined;
					owner.finishFrame(session!, consumed);
				} finally {
					for (const r of data?.rasters ?? []) native.release(r);
					output?.free();
				}
			};
			active = run();
			try {
				await active;
			} catch (error) {
				closed = true;
				release();
				throw error;
			} finally {
				active = undefined;
			}
		},
		async dispose() {
			closed = true;
			try {
				await active;
			} catch {
				// The frame caller receives its original error; disposal still drains.
			} finally {
				release();
			}
		},
	};
}
