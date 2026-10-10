import { expect } from "bun:test";
import { createHash } from "node:crypto";
import type {
	HeartOwnerApi,
	HeartNativePixels,
} from "./mv-heart-owner-provider";
import type {
	MvHeartBinding,
	MvHeartPreparedImage,
} from "@opencut/editor-contracts";
export const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
export const capabilityJson = () =>
	JSON.stringify({ maxOwnerBytes: 256 * 1024 * 1024 });
export function source(): HeartNativePixels {
	const bytes = new Uint8Array([1, 2, 3]);
	const digest = sha(bytes);
	return {
		resource: {
			id: "heart",
			kind: "image",
			mimeType: "image/png",
			byteLength: 3,
			sha256: digest,
			attachmentKey: `programmatic-sha256-${digest}`,
		},
		encoded: bytes.buffer,
		width: 1,
		height: 1,
		rgba: new Uint8Array([255, 255, 255, 255]),
	};
}
export interface Record {
	identity: {
		ownerId: number;
		sessionId: number;
		binding: MvHeartBinding;
		background: unknown;
		character?: unknown;
		imagesManifestSha256: string;
	};
	images: { index: number; byteLength: number; image: MvHeartPreparedImage }[];
	reservedBytes: number;
	bytes: Uint8Array;
}
/** Synthetic protocol owner. Actual Rust/header/segmentation gates are separate;
 * these tests prove only snapshot, full-identity, upload and cancellation seams. */
export class FakeOwner implements HeartOwnerApi {
	diagnosticJson() {
		return JSON.stringify({ ownerId: 99, disposed: false });
	}
	next = 1;
	entries = new Map<number, Record>();
	extractions = 0;
	cancelled: number[] = [];
	badManifest = false;
	badFrame = false;
	badBytes = false;
	rejectPrepare = false;
	manifestMutation?: (value: Omit<Record, "bytes">) => void;
	// eslint-disable-next-line opencut/prefer-object-params -- Preserve actual WASM class binary boundary.
	prepare(metadata: string, encoded: Uint8Array, rgba: Uint8Array) {
		if (this.rejectPrepare)
			throw Error("Heart joint preparation ceiling exceeded");
		const input: {
			binding: MvHeartBinding;
			background?: unknown;
			character?: unknown;
			ceilingBytes: number;
			encodedLayout: { source: { offset: number; length: number } };
			decodedLayout: { source: { offset: number; length: number } };
		} = JSON.parse(metadata);
		const sourceEncoded = encoded.subarray(
			input.encodedLayout.source.offset,
			input.encodedLayout.source.offset + input.encodedLayout.source.length,
		);
		const sourceRgba = rgba.subarray(
			input.decodedLayout.source.offset,
			input.decodedLayout.source.offset + input.decodedLayout.source.length,
		);
		expect(sha(sourceEncoded)).toBe(input.binding.source.sha256);
		expect(sha(sourceRgba)).toBe(input.binding.decodedRgbaSha256);
		const session = this.next++;
		const image: MvHeartPreparedImage = {
			binding: input.binding,
			part: { kind: "body" },
			width: 1,
			height: 1,
			rgbaSha256: sha(sourceRgba),
		};
		const images = [{ index: 0, byteLength: 4, image }];
		this.entries.set(session, {
			identity: {
				ownerId: 99,
				sessionId: session,
				binding: input.binding,
				background: input.background ?? null,
				...(input.character === undefined
					? {}
					: { character: input.character }),
				imagesManifestSha256: sha(
					new TextEncoder().encode(JSON.stringify(images)),
				),
			},
			images,
			reservedBytes: input.ceilingBytes,
			bytes: sourceRgba.slice(),
		});
		return session;
	}
	manifestJson(session: number) {
		const record = this.entries.get(session);
		if (!record) throw Error("stale");
		const value = {
			images: structuredClone(record.images),
			reservedBytes: record.reservedBytes,
			identity: { ...record.identity, ownerId: this.badManifest ? 0 : 99 },
		};
		this.manifestMutation?.(value);
		return JSON.stringify(value);
	}
	imageBytes(session: number) {
		this.extractions++;
		const bytes = this.entries.get(session)!.bytes.slice();
		if (this.badBytes) bytes[0] ^= 1;
		return bytes;
	}
	frameJson(session: number) {
		const record = this.entries.get(session)!;
		return JSON.stringify({
			identity: {
				...record.identity,
				sessionId: this.badFrame ? 999 : session,
			},
			plan: {
				rasterBudgetBytes: 4096,
				commands: [
					{
						kind: "preparedImage",
						image: record.images[0]!.image,
						transform: [1, 0, 0, 1, 0, 0],
						operations: [],
						clip: null,
						sourceRect: null,
						destinationRect: [0, 0, 1, 1],
						composite: "source-over",
						opacity: 1,
						smoothing: true,
						smoothingQuality: "low",
					},
				],
			},
		});
	}
	cancel(session: number) {
		this.cancelled.push(session);
		return this.entries.delete(session);
	}
}
export function bitmap() {
	return {
		width: 1,
		height: 1,
		closed: 0,
		close() {
			this.closed++;
		},
	};
}
