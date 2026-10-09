/** Runs in a blank private Chromium page; no application or renderer code is replaced. */
export async function runMasterEncoderCase({ config, frames }) {
	const bounded = async (operation) => {
		let timer;
		try {
			return await Promise.race([
				operation,
				new Promise((resolve, reject) => {
					timer = setTimeout(
						() =>
							reject(
								Error(
									"Private encoder diagnostic operation exceeded 30 seconds",
								),
							),
						30000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	const support = await bounded(VideoEncoder.isConfigSupported(config));
	if (!support.supported)
		return { supported: false, requestedConfig: config, support };
	const packets = [],
		decoded = [];
	let encoderError, decoderError, decoderConfig;
	const encoder = new VideoEncoder({
		error: (error) => {
			encoderError = String(error?.stack ?? error);
		},
		output: (chunk, metadata) => {
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			packets.push({
				type: chunk.type,
				timestamp: chunk.timestamp,
				duration: chunk.duration,
				bytes: [...bytes],
			});
			if (metadata?.decoderConfig)
				decoderConfig = structuredClone(metadata.decoderConfig);
		},
	});
	let decoder;
	try {
		// These are exactly the arguments actually submitted, not only a capability query.
		const actualConfigure = structuredClone(config);
		encoder.configure(actualConfigure);
		for (const source of frames) {
			const frame = new VideoFrame(new Uint8Array(source.bytes), {
				format: source.format,
				layout: source.layout,
				codedWidth: source.codedWidth,
				codedHeight: source.codedHeight,
				displayWidth: source.displayWidth,
				displayHeight: source.displayHeight,
				timestamp: source.timestamp,
				duration: source.duration,
				colorSpace: source.colorSpace,
			});
			try {
				encoder.encode(frame, source.options);
			} finally {
				frame.close();
			}
			if (encoder.encodeQueueSize >= 4)
				await bounded(
					new Promise((resolve) =>
						encoder.addEventListener("dequeue", resolve, { once: true }),
					),
				);
			if (encoderError) throw Error(encoderError);
		}
		await bounded(encoder.flush());
		if (encoderError) throw Error(encoderError);
		if (!decoderConfig)
			throw Error("Encoder did not publish its decoder configuration");
		const surface = new OffscreenCanvas(config.width, config.height);
		const context = surface.getContext("2d", { colorSpace: "srgb" });
		decoder = new VideoDecoder({
			error: (error) => {
				decoderError = String(error?.stack ?? error);
			},
			output: (frame) => {
				try {
					context.globalCompositeOperation = "copy";
					context.drawImage(frame, 0, 0);
					decoded.push({
						timestamp: frame.timestamp,
						duration: frame.duration,
						format: frame.format,
						colorSpace: frame.colorSpace.toJSON(),
						rgba: [
							...context.getImageData(0, 0, config.width, config.height).data,
						],
					});
				} finally {
					frame.close();
				}
			},
		});
		decoder.configure(decoderConfig);
		for (const packet of packets)
			decoder.decode(
				new EncodedVideoChunk({
					...packet,
					data: new Uint8Array(packet.bytes),
				}),
			);
		await bounded(decoder.flush());
		if (decoderError) throw Error(decoderError);
		return {
			supported: true,
			actualConfigure,
			support,
			decoderConfig: {
				...decoderConfig,
				...(decoderConfig.description
					? { description: [...new Uint8Array(decoderConfig.description)] }
					: {}),
			},
			packets,
			decoded,
			decodeReadback:
				"Chromium VideoDecoder -> sRGB OffscreenCanvas 2D drawImage/getImageData; not direct raw YUV planes",
		};
	} finally {
		if (decoder && decoder.state !== "closed") decoder.close();
		if (encoder.state !== "closed") encoder.close();
	}
}
