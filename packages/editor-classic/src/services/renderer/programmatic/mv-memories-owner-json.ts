import { isProgrammaticResource } from "@opencut/editor-contracts";
import type {
	Publication,
	SourceRequests,
	StageData,
	MvMemoriesRaster,
	MvMemoriesFontMeasurementRequest,
	MvMemoriesPlan,
} from "./mv-memories-owner-protocol";
function object(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
function integer(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
function hash(v: unknown): v is string {
	return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
function raster(v: unknown): v is MvMemoriesRaster {
	return (
		object(v) &&
		hash(v.bindingSha256) &&
		hash(v.rgbaSha256) &&
		typeof v.part === "string" &&
		integer(v.width) &&
		integer(v.height)
	);
}
function identity(v: unknown): v is Publication["identity"] {
	return object(v) && integer(v.ownerId) && integer(v.sessionId);
}
function measurement(v: unknown): v is MvMemoriesFontMeasurementRequest {
	return (
		object(v) &&
		typeof v.font === "string" &&
		typeof v.fontSize === "number" &&
		(v.weight === 400 || v.weight === 600) &&
		Array.isArray(v.texts) &&
		v.texts.every((s: unknown) => typeof s === "string")
	);
}
export function plan(v: unknown): v is MvMemoriesPlan {
	return object(v) && Array.isArray(v.commands) && typeof v.rasterBudgetBytes === "number";
}
export function publication(v: unknown): v is Publication {
	return (
		object(v) &&
		identity(v.identity) &&
		plan(v.plan) &&
		Array.isArray(v.rasters) &&
		v.rasters.every(raster) &&
		(v.retired === undefined || raster(v.retired))
	);
}
export function stage(v: unknown): v is StageData {
	return (
		object(v) &&
		publication(v.output) &&
		typeof v.planJson === "string" &&
		hash(v.planSha256) &&
		Array.isArray(v.size) &&
		v.size.length === 2 &&
		v.size.every(integer)
	);
}
export function requests(v: unknown): v is SourceRequests {
	return (
		object(v) &&
		Array.isArray(v.images) &&
		v.images.every(isProgrammaticResource) &&
		Array.isArray(v.fonts) &&
		v.fonts.every(isProgrammaticResource) &&
		Array.isArray(v.measurements) &&
		v.measurements.every(measurement) &&
		integer(v.photos)
	);
}
export function capability(
	v: unknown,
): v is { maxOwnerBytes: number; opaqueStages: boolean } {
	return object(v) && integer(v.maxOwnerBytes) && v.opaqueStages === true;
}
export function diagnostic(
	v: unknown,
): v is { ownerId: number; disposed: boolean } {
	return object(v) && integer(v.ownerId) && typeof v.disposed === "boolean";
}
export function dimensions(v: unknown): v is { width: number; height: number } {
	return object(v) && integer(v.width) && integer(v.height);
}
export function prepared(
	v: unknown,
): v is { identity: Publication["identity"]; rasters: MvMemoriesRaster[] } {
	return (
		object(v) &&
		identity(v.identity) &&
		Array.isArray(v.rasters) &&
		v.rasters.every(raster)
	);
}
export function parse<T>({
	input,
	guard,
}: {
	input: string;
	guard: (v: unknown) => v is T;
}): T {
	const v: unknown = JSON.parse(input);
	if (!guard(v)) throw Error("Memories malformed trusted Rust publication");
	return v;
}
