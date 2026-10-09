import {
	ALL_FORMATS,
	BufferSource,
	EncodedPacketSink,
	Input,
	VideoSampleSink,
} from "mediabunny";

/** Decode the finalized container, including its demuxed packet timing. */
export async function decodeContainer(bytes) {
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	try {
		const video = await input.getPrimaryVideoTrack();
		const audio = await input.getPrimaryAudioTrack();
		if (!video || !audio)
			throw Error(
				"Finalized adapter container must have video and audio tracks",
			);
		const demuxed = [];
		for await (const packet of new EncodedPacketSink(video).packets())
			demuxed.push({
				timestamp: packet.timestamp,
				duration: packet.duration,
				type: packet.type,
				bytes: [...packet.data],
			});
		const canvas = new OffscreenCanvas(96, 64);
		const context = canvas.getContext("2d", { colorSpace: "srgb" });
		const decoded = [];
		for await (const sample of new VideoSampleSink(video).samples()) {
			try {
				context.globalCompositeOperation = "copy";
				sample.draw(context, 0, 0);
				decoded.push({
					containerTimestamp: sample.timestamp,
					containerDuration: sample.duration,
					rgba: [...context.getImageData(0, 0, 96, 64).data],
				});
			} finally {
				sample.close();
			}
		}
		return {
			decoded,
			demuxed,
			audioCodec: audio.codec,
			decoderConfig: await video.getDecoderConfig(),
			decodeReadback:
				"Finalized WebM -> Mediabunny demux -> Chromium VideoDecoder -> sRGB canvas readback",
		};
	} finally {
		input.dispose();
	}
}
