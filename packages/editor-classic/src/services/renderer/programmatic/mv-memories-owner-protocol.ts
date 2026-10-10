import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type { MvMemories } from "../../../../../editor-contracts/src/mv-memories";
import type {
	MvMemoriesPlan,
	MvMemoriesRaster,
	MvMemoriesFontMeasurementRequest,
} from "../../../../../editor-contracts/src/mv-memories-plan";
export type {
	MvMemories,
	MvMemoriesPlan,
	MvMemoriesRaster,
	MvMemoriesFontMeasurementRequest,
};
export interface Disposable {
	free(): void;
}
export interface MemoriesOutput extends Disposable {
	json(): string;
	bytes(index: number): Uint8Array;
}
export type MemoriesStage = MemoriesOutput;
export interface MemoriesOwnerApi {
	reserve(bytes: number): Disposable;
	diagnosticJson(): string;
	prepareReserved(
		ticket: Disposable,
		metadata: string,
		encoded: Uint8Array,
		rgba: Uint8Array,
	): number;
	beginStage(session: number, kind: string, slot: number): MemoriesStage;
	acceptStage(
		session: number,
		stage: MemoriesStage,
		metadata: string,
		rgba: Uint8Array,
	): MemoriesOutput | undefined;
	cancelStage(session: number, stage: MemoriesStage): void;
	preparedJson(session: number): string;
	preparedBytes(session: number, index: number): Uint8Array;
	frame(session: number, input: string): MemoriesOutput;
	finishFrame(session: number, output: MemoriesOutput): void;
	cancel(session: number): boolean;
}
export interface MemoriesOwnerStatics {
	sourceRequestsJson(args: string, resources: string): string;
	sourceAdmissionJson(
		args: string,
		resource: string,
		bytes: Uint8Array,
	): string;
	capabilityJson(): string;
}
export interface SourceRequests {
	images: ProgrammaticResource[];
	fonts: ProgrammaticResource[];
	measurements: MvMemoriesFontMeasurementRequest[];
	photos: number;
}
export interface Publication {
	identity: { ownerId: number; sessionId: number };
	plan: MvMemoriesPlan;
	rasters: MvMemoriesRaster[];
	retired?: MvMemoriesRaster;
}
export interface StageData {
	output: Publication;
	planJson: string;
	size: readonly [number, number];
	planSha256: string;
}
export const DECODER = "canvas2d-srgb-unpremultiplied-rgba8-v1";
export function rasterKey(r: MvMemoriesRaster) {
	return JSON.stringify([
		r.bindingSha256,
		r.part,
		r.width,
		r.height,
		r.rgbaSha256,
	]);
}
export async function digest(bytes: Uint8Array) {
	if (!(bytes.buffer instanceof ArrayBuffer))
		throw Error("Memories native digest requires private ArrayBuffer");
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			),
		),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");
}
