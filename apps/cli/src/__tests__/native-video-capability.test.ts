import { expect, test } from "bun:test";
import { createProgrammaticFrameService } from "../programmatic/frame-service";

test("native video configuration is distinct from health and never overrides Electron selection", async () => {
	const decoder = { ffmpeg: process.execPath, ffprobe: process.execPath };
	// Existing files intentionally are not valid media decoders: merely having
	// absolute files must never advertise a successful decode health check.
	const standalone = createProgrammaticFrameService(process.execPath, "", undefined, decoder);
	try {
		expect(standalone.nativeVideoCapability).toMatchObject({ configured: true, availability: "configured-not-health-probed",
			backend: "standalone-chromium-native-decoder", hdr: "pq-hlg-hable-to-bt709-sdr; requires-zscale-tonemap",
			hdrOutput: "unsupported-sdr-only", colorMetadata: "explicit-supported-hdr-tags-required",
			toneMapped: "native-default-true; false-disables-tone-mapping", audio: "separate-rocut-tracks" });
	} finally { await standalone.dispose(); }
	for (const [browser, connection, native] of [
		[process.execPath, process.execPath, decoder], // Any configured Electron service owns selection.
		["", "", decoder],
		[process.execPath, "", { ffmpeg: "relative", ffprobe: process.execPath }],
		[process.execPath, "", { ffmpeg: `${process.execPath}.missing`, ffprobe: process.execPath }],
	] as const) {
		const service = createProgrammaticFrameService(browser, connection, undefined, native);
		try { expect(service.nativeVideoCapability).toMatchObject({ configured: false, availability: "unavailable", electron: "requires-media-request-transport" }); }
		finally { await service.dispose(); }
	}
});
