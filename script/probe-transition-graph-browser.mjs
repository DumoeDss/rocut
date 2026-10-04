// Shared by the installed-binary Elftia probe and the synchronous WASM smoke test.
export function runTransitionGraphProbe(api) {
	const checks = [];
	const assert = (condition, message) => {
		if (!condition) throw Error(message);
	};
	const check = (name, run) => {
		run();
		checks.push({ name, pass: true });
	};
	const fixture = () => ({
		clips: [
			{
				id: "a",
				trackId: "v1",
				start: 0,
				duration: 360000,
				source: {
					type: "video",
					trimStart: 120000,
					sourceDuration: 720000,
					playbackRate: 1,
				},
			},
			{
				id: "b",
				trackId: "v1",
				start: 360000,
				duration: 360000,
				source: {
					type: "video",
					trimStart: 120000,
					sourceDuration: 720000,
					playbackRate: 1,
				},
			},
		],
		links: [{ outgoingClipId: "a", incomingClipId: "b", durationFrames: 30 }],
		frameRate: { numerator: 30, denominator: 1 },
		playhead: 360001,
	});
	check(
		"transition graph quantizes samples and reads both source clocks",
		() => {
			const result = api.evaluateClipTransitions(fixture());
			assert(
				result.rejected.length === 0 && result.accepted.length === 1,
				"valid graph rejected",
			);
			const { window, sample, linkIndex } = result.accepted[0];
			assert(
				linkIndex === 0 &&
					window.start === 300000 &&
					window.cut === 360000 &&
					window.end === 420000,
				"window mismatch",
			);
			assert(
				sample.time === 360000 &&
					sample.progress === 0.5 &&
					sample.outgoingSource === 480000 &&
					sample.incomingSource === 120000,
				"source sample mismatch",
			);
		},
	);
	check(
		"transition graph validation-only and exclusive end have no sample",
		() => {
			for (const time of [undefined, -1, 299999, 420000]) {
				const input = fixture();
				input.playhead = time;
				const result = api.evaluateClipTransitions(input);
				assert(
					result.accepted.length === 1 && result.accepted[0].sample == null,
					"sample outside window",
				);
			}
		},
	);
	check(
		"transition graph rejects missing preroll without implicit freeze",
		() => {
			const input = fixture();
			input.clips[1].source.trimStart = 0;
			const result = api.evaluateClipTransitions(input);
			assert(
				result.accepted.length === 0 &&
					result.rejected[0].error.reason === "missing-incoming-handle",
				"missing preroll not rejected",
			);
		},
	);
	check("transition graph uses explicit frozen sources", () => {
		const input = fixture();
		input.clips[1].source.trimStart = 0;
		input.clips[1].source.freezeFrame = 4000;
		const result = api.evaluateClipTransitions(input);
		assert(
			result.rejected.length === 0 &&
				result.accepted[0].sample.incomingSource === 4000,
			"frozen source mismatch",
		);
	});
	check(
		"transition graph rejects deleted moved and cross-track relations",
		() => {
			for (const mutate of [
				(input) => input.clips.shift(),
				(input) => {
					input.clips[0].start = 4000;
				},
				(input) => {
					input.clips[0].trackId = "other";
				},
			]) {
				const input = fixture();
				mutate(input);
				const result = api.evaluateClipTransitions(input);
				assert(
					result.accepted.length === 0 && result.rejected.length === 1,
					"stale relation retained",
				);
			}
		},
	);
	check(
		"transition graph rejects all participants in overlapping windows",
		() => {
			const input = fixture();
			input.clips = [
				{
					id: "a",
					trackId: "v1",
					start: 0,
					duration: 120000,
					source: { type: "image" },
				},
				{
					id: "b",
					trackId: "v1",
					start: 120000,
					duration: 40000,
					source: { type: "image" },
				},
				{
					id: "c",
					trackId: "v1",
					start: 160000,
					duration: 120000,
					source: { type: "image" },
				},
			];
			input.links = [
				{ outgoingClipId: "a", incomingClipId: "b", durationFrames: 16 },
				{ outgoingClipId: "b", incomingClipId: "c", durationFrames: 16 },
			];
			for (let i = 0; i < 2; i++) {
				input.links.reverse();
				const result = api.evaluateClipTransitions(input);
				assert(
					result.accepted.length === 0 &&
						result.rejected.length === 2 &&
						result.rejected.every(
							(r) => r.error.code === "overlapping-windows",
						),
					"overlap selected an arbitrary winner",
				);
			}
		},
	);
	check(
		"transition graph rejects malformed wire values and unknown fields",
		() => {
			for (const mutate of [
				(input) => {
					input.links[0].durationFrames = 2.5;
				},
				(input) => {
					input.links[0].durationFrames = -1;
				},
				(input) => {
					input.links[0].durationFrames = 4294967296;
				},
				(input) => {
					input.clips[0].start = 0.1;
				},
				(input) => {
					input.clips[0].source.type = "audio";
				},
				(input) => {
					input.silentlyIgnoredTypo = true;
				},
				(input) => {
					input.clips[0].silentlyIgnoredTypo = true;
				},
				(input) => {
					input.clips[0].source.silentlyIgnoredTypo = true;
				},
				(input) => {
					input.links[0].silentlyIgnoredTypo = true;
				},
			]) {
				const input = fixture();
				mutate(input);
				let rejected = false;
				try {
					api.evaluateClipTransitions(input);
				} catch {
					rejected = true;
				}
				assert(rejected, "malformed input accepted: " + JSON.stringify(input));
			}
		},
	);
	check("transition graph rejects unsafe and invalid source metadata", () => {
		for (const rate of [NaN, Infinity, 0, -1, 6]) {
			const input = fixture();
			input.clips[1].source.playbackRate = rate;
			assert(
				api.evaluateClipTransitions(input).rejected[0].error.reason ===
					"invalid-source",
				"invalid source rate accepted",
			);
		}
		const input = fixture();
		input.clips[0].start = Number.MAX_SAFE_INTEGER;
		assert(
			api.evaluateClipTransitions(input).rejected[0].error.reason ===
				"invalid-clip",
			"unsafe end accepted",
		);
	});
	check("transition graph remains usable after malformed calls", () => {
		assert(
			api.evaluateClipTransitions(fixture()).accepted.length === 1,
			"WASM did not recover",
		);
	});
	return checks;
}
