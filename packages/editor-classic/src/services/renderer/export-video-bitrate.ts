import { resolveVideoExportJson, type FrameRate } from "opencut-wasm";
import type { ExportOptions, ExportQuality } from "../../export";
import {
	readNativeVp9Plan,
	type NativeVp9ExportPlan,
} from "./export-video-native-plan";

type VideoExportRequest = {
	codec: "avc" | "vp9";
	quality: ExportQuality;
	width: number;
	height: number;
	frameRate: FrameRate;
	videoChroma?: ExportOptions["videoChroma"];
	videoQuantizer?: ExportOptions["videoQuantizer"];
	format?: ExportOptions["format"];
};

export interface ExportVideoPlan {
	bitrate: number;
	fullCodecString?: string;
	native?: NativeVp9ExportPlan;
}

export function resolveExportVideoPlan(
	request: VideoExportRequest,
): ExportVideoPlan {
	const result: unknown = JSON.parse(
		resolveVideoExportJson(JSON.stringify(request)),
	);
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new Error("Invalid video export policy response");
	if ("error" in result && typeof result.error === "string")
		throw new Error(result.error);
	if (!("bitrate" in result) || typeof result.bitrate !== "number")
		throw new Error("Missing video export bitrate");
	if (request.videoQuantizer !== undefined) {
		if (!("kind" in result) || result.kind !== "vp9Quantizer")
			throw Error(
				"The Rust policy does not provide the requested VP9 quantizer plan",
			);
		const native = readNativeVp9Plan(result);
		return {
			bitrate: result.bitrate,
			fullCodecString: native.config.codec,
			native,
		};
	}
	if ("default" in result && result.default === true) {
		// The Rust policy routes the default 4:2:0 WebM very-high preset onto
		// the quantizer path; the average-bitrate default measurably starved
		// detail frames (see flame-wrap 4:2:0 evidence).
		if (!("kind" in result) || result.kind !== "vp9Quantizer")
			throw new Error(
				"The default video export policy returned an unsupported native plan",
			);
		const native = readNativeVp9Plan(result);
		return {
			bitrate: result.bitrate,
			fullCodecString: native.config.codec,
			native,
		};
	}
	if (request.videoChroma === "444") {
		if (
			!("fullCodecString" in result) ||
			typeof result.fullCodecString !== "string" ||
			!/^vp09\.01\.\d{2}\.08\.03\.01\.13\.01\.01$/.test(result.fullCodecString)
		)
			throw new Error(
				"The video export policy does not provide a 4:4:4 codec plan",
			);
		return { bitrate: result.bitrate, fullCodecString: result.fullCodecString };
	}
	return { bitrate: result.bitrate };
}

export function resolveExportVideoBitrate(request: VideoExportRequest): number {
	return resolveExportVideoPlan(request).bitrate;
}
