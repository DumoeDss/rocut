/** Synthetic known analysis, shaped exactly like Creator's analyze outputs.
 * No listening approval or analyzer accuracy is claimed for user material. */
export async function nativeAudioFixture() {
	const digest = async (text: string) =>
		[
			...new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
			),
		]
			.map((v) => v.toString(16).padStart(2, "0"))
			.join("");
	const schema = {
		schema: "creator-mv-audio/1",
		time_coordinate: "source-audio-seconds",
	};
	const music = {
		...schema,
		audio: {
			duration: 2,
			source_sample_rate: 24000,
			sample_rate: 24000,
			channels: 1,
		},
		review: "required",
		beats: [0, 0.5, 1.25],
		beats_source: "manual",
		detected_beats: [],
		downbeats: [0, 1.25],
		downbeat_analysis: { status: "manual" },
	};
	const envelopes = {
		...schema,
		duration: 2,
		fps: 4,
		frame_count: 8,
		channels: {
			mix_rms: [0, 1, 0, 1, 0, 1, 0, 1],
			low_power: [0, 0, 0, 0, 1, 1, 1, 1],
			mid_power: Array(8).fill(0.5),
			high_power: Array(8).fill(1),
		},
		normalization: {
			method: "per-channel p95 (max if p95 is zero), clipped to [0,1]",
			scales: { mix_rms: 0.2, low_power: 5, mid_power: 2, high_power: 1 },
		},
	};
	const musicText = JSON.stringify(music),
		envelopesText = JSON.stringify(envelopes);
	const musicFile = {
		sha256: await digest(musicText),
		byteLength: new TextEncoder().encode(musicText).length,
	};
	const envelopesFile = {
		sha256: await digest(envelopesText),
		byteLength: new TextEncoder().encode(envelopesText).length,
	};
	const expectedAudioSha256 = "a".repeat(64);
	const manifest = {
		...schema,
		command: "analyze",
		status: "complete",
		review: "required",
		inputs: {
			audio: {
				path: "DO-NOT-OPEN-THIS-MANIFEST-PATH",
				bytes: 100,
				sha256: expectedAudioSha256,
			},
		},
		outputs: {
			"music.json": {
				path: "DO-NOT-OPEN",
				bytes: musicFile.byteLength,
				sha256: musicFile.sha256,
			},
			"envelopes.json": {
				path: "DO-NOT-OPEN",
				bytes: envelopesFile.byteLength,
				sha256: envelopesFile.sha256,
			},
		},
	};
	const manifestText = JSON.stringify(manifest),
		manifestFile = {
			sha256: await digest(manifestText),
			byteLength: new TextEncoder().encode(manifestText).length,
		};
	const review = {
		status: "accepted",
		reference: "synthetic fixture ground truth; not a user listening review",
	};
	return {
		files: {
			"manifest.json": manifestText,
			"music.json": musicText,
			"envelopes.json": envelopesText,
		},
		input: {
			manifest,
			music,
			envelopes,
			manifestFile,
			musicFile,
			envelopesFile,
			expectedAudioSha256,
			review,
		},
		expectedAudioSha256,
		review,
	};
}
