/** Native decoding adapter, not a new project color model or HDR output format.
 * Keep this description in the Remotion archive fingerprint when changing its
 * interpretation. Host FFmpeg binaries still require independent verification.
 */
export const NATIVE_VIDEO_COLOR_ADAPTER = Object.freeze({
	id: "pq-hlg-hable-bt709-v1",
	transfers: ["smpte2084", "arib-std-b67"],
	primaries: ["bt2020", "bt709", "smpte170m", "smpte240m", "bt470bg", "bt470m", "film", "smpte431", "smpte432"],
	matrices: ["bt2020nc", "bt2020c", "bt709", "smpte170m", "bt470bg", "gbr"],
	ranges: ["tv", "pc"],
	linear: "zscale=t=linear:npl=100",
	gamut: "zscale=primaries=709",
	toneMap: "tonemap=tonemap=hable:desat=0",
	output: "zscale=transfer=709:matrix=bt709:range=pc",
	alpha: "extract-before-tone-mapping-restore-after",
	// FFmpeg calls transfer characteristic 4 (gamma 2.2) 'bt470m'; the primaries
	// remain BT.709, not BT.470M.
	transparentPng: "setparams=color_primaries=bt709:color_trc=bt470m:colorspace=gbr:range=full",
	opaquePng: "setparams=color_primaries=unknown:color_trc=unknown:colorspace=unknown:range=full",
});

export interface NativeVideoColorMetadata {
	color_transfer?: string;
	color_primaries?: string;
	color_space?: string;
	color_range?: string;
}

export function nativeVideoColorFilters(metadata: NativeVideoColorMetadata, toneMapped: boolean): string[] {
	const adapter = NATIVE_VIDEO_COLOR_ADAPTER;
	if (!toneMapped || !adapter.transfers.includes(metadata.color_transfer ?? "")) return [];
	// Unlike an ordinary matrix conversion, HDR needs tagged source primaries,
	// transfer, matrix and range. Do not invent missing metadata to make it render.
	if (!adapter.primaries.includes(metadata.color_primaries ?? "") || !adapter.matrices.includes(metadata.color_space ?? "")
		|| !adapter.ranges.includes(metadata.color_range ?? ""))
		throw Error("Native HDR tone mapping requires explicit supported primaries, matrix and range metadata");
	// The native Remotion Hable chain uses float linear light. The caller must
	// extract/rejoin alpha separately: zscale can apply the YUV range to alpha.
	return [adapter.linear, "format=gbrpf32le", adapter.gamut, adapter.toneMap, adapter.output];
}

/** Native Remotion's transparent PNG encoder tags BT.709 chromaticities and
 * gamma 1/2.2; its opaque BMP has no profile. Do not leak source HDR/ICC tags
 * onto decoded RGB and let Chromium apply a second, different conversion.
 */
export function nativeVideoPngFilters(transparent: boolean): string[] {
	return ["sidedata=mode=delete:type=ICC_PROFILE",
		transparent ? NATIVE_VIDEO_COLOR_ADAPTER.transparentPng : NATIVE_VIDEO_COLOR_ADAPTER.opaquePng];
}
