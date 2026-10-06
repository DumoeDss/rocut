/** @opencutSurface provider — Node-safe media I/O; no codec, canvas or session required. */
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";

export async function probeMediaImport(bytes: Uint8Array) {
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	try {
		const video = await input.getPrimaryVideoTrack();
		const audio = await input.getPrimaryAudioTrack();
		const duration = await input.computeDuration();
		if ((!video && !audio) || !Number.isFinite(duration) || duration <= 0)
			throw new Error("Media has no finite playable audio/video duration");
		return {
			type: video ? ("video" as const) : ("audio" as const),
			mimeType: (await input.getFormat()).mimeType,
			duration,
			hasAudio: audio !== null,
			...(video && { width: video.displayWidth, height: video.displayHeight }),
		};
	} finally {
		input.dispose();
	}
}
