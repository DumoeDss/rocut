import {
	isProgrammaticResource,
	type MvHeartBinding,
	type MvHeartPreparedImage,
} from "@opencut/editor-contracts";
import type {
	MvHeartOwnerIdentity as Identity,
	MvHeartBackgroundBinding,
	MvHeartSkyOwnerIdentity,
} from "../../../../../editor-contracts/src/mv-heart-plan";
interface Image {
	readonly index: number;
	readonly byteLength: number;
	readonly image: MvHeartPreparedImage;
}
interface Manifest {
	readonly identity: Identity;
	readonly images: readonly Image[];
	readonly reservedBytes: number;
}
function object(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
function keys({
	value,
	expected,
}: {
	value: Record<string, unknown>;
	expected: readonly string[];
}) {
	return (
		Object.keys(value).length === expected.length &&
		expected.every((k) => Object.prototype.hasOwnProperty.call(value, k))
	);
}
function integer(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
function sha(v: unknown): v is string {
	return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
function nativeBinding(v: unknown): v is MvHeartBackgroundBinding {
	return (
		object(v) &&
		keys({
			value: v,
			expected: [
				"source",
				"decodedWidth",
				"decodedHeight",
				"decodedRgbaSha256",
				"decoder",
			],
		}) &&
		isProgrammaticResource(v.source) &&
		v.source.kind === "image" &&
		integer(v.decodedWidth) &&
		integer(v.decodedHeight) &&
		sha(v.decodedRgbaSha256) &&
		v.decoder === "canvas2d-srgb-unpremultiplied-rgba8-v1"
	);
}
function binding(v: unknown): v is MvHeartBinding {
	return (
		object(v) &&
		isProgrammaticResource(v.source) &&
		v.source.kind === "image" &&
		keys({
			value: v,
			expected: [
				"source",
				"decodedWidth",
				"decodedHeight",
				"decodedRgbaSha256",
				"decoder",
				"algorithm",
			],
		}) &&
		integer(v.decodedWidth) &&
		integer(v.decodedHeight) &&
		sha(v.decodedRgbaSha256) &&
		v.decoder === "canvas2d-srgb-unpremultiplied-rgba8-v1" &&
		v.algorithm === "heart-components-v1"
	);
}
function image(v: unknown): v is MvHeartPreparedImage {
	return (
		object(v) &&
		keys({
			value: v,
			expected: ["binding", "part", "width", "height", "rgbaSha256"],
		}) &&
		binding(v.binding) &&
		integer(v.width) &&
		integer(v.height) &&
		sha(v.rgbaSha256) &&
		object(v.part) &&
		((v.part.kind === "body" && keys({ value: v.part, expected: ["kind"] })) ||
			(v.part.kind === "chip" &&
				keys({ value: v.part, expected: ["kind", "label"] }) &&
				typeof v.part.label === "number" &&
				Number.isSafeInteger(v.part.label) &&
				v.part.label >= 0))
	);
}
function manifest(v: unknown): v is Manifest {
	return (
		object(v) &&
		keys({ value: v, expected: ["identity", "images", "reservedBytes"] }) &&
		object(v.identity) &&
		keys({
			value: v.identity,
			expected: [
				"ownerId",
				"sessionId",
				"binding",
				"background",
				"imagesManifestSha256",
				...(v.identity.character === undefined ? [] : ["character"]),
			],
		}) &&
		integer(v.identity.ownerId) &&
		integer(v.identity.sessionId) &&
		binding(v.identity.binding) &&
		(v.identity.background === null || nativeBinding(v.identity.background)) &&
		(v.identity.character === undefined ||
			nativeBinding(v.identity.character)) &&
		sha(v.identity.imagesManifestSha256) &&
		integer(v.reservedBytes) &&
		Array.isArray(v.images) &&
		v.images.length > 0 &&
		v.images.every(
			(i: unknown) =>
				object(i) &&
				keys({ value: i, expected: ["index", "byteLength", "image"] }) &&
				typeof i.index === "number" &&
				Number.isSafeInteger(i.index) &&
				i.index >= 0 &&
				integer(i.byteLength) &&
				image(i.image),
		)
	);
}
interface SkyManifest {
	readonly kind: "skyShatter";
	readonly identity: MvHeartSkyOwnerIdentity;
	readonly images: readonly [];
	readonly reservedBytes: number;
}
function skyManifest(v: unknown): v is SkyManifest {
	return (
		object(v) &&
		keys({
			value: v,
			expected: ["kind", "identity", "images", "reservedBytes"],
		}) &&
		v.kind === "skyShatter" &&
		object(v.identity) &&
		keys({
			value: v.identity,
			expected: [
				"ownerId",
				"sessionId",
				"binding",
				"character",
				"settings",
				"imagesManifestSha256",
			],
		}) &&
		integer(v.identity.ownerId) &&
		integer(v.identity.sessionId) &&
		nativeBinding(v.identity.binding) &&
		nativeBinding(v.identity.character) &&
		object(v.identity.settings) &&
		typeof v.identity.settings.bg === "string" &&
		typeof v.identity.settings.char === "string" &&
		sha(v.identity.imagesManifestSha256) &&
		integer(v.reservedBytes) &&
		Array.isArray(v.images) &&
		v.images.length === 0
	);
}
function canonical(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canonical);
	if (object(v))
		return Object.fromEntries(
			Object.keys(v)
				.sort()
				.map((key) => [key, canonical(v[key])]),
		);
	return v;
}
const key = (v: unknown) => JSON.stringify(canonical(v));

export {
	object,
	keys,
	integer,
	binding,
	nativeBinding,
	image,
	manifest,
	skyManifest,
	key,
};
export type { Identity, Manifest, SkyManifest };
