import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HYPERFRAMES_COMPILER_CHILD } from "../../apps/cli/src/programmatic/engines/hyperframes-compiler-child";
import {
	hyperframesMediaAdmissionNegatives,
	hyperframesMediaVariants,
	expectHyperframesMediaAdmissionRejection,
} from "./hyperframes-media-cases";

// Execute the actual production admission statements only, without compiling
// assets/runtime or launching a browser. The fake DOM models authored attributes.
const start = HYPERFRAMES_COMPILER_CHILD.indexOf(
	"  if (doc.querySelector('audio') && !config.nativeAudio)",
);
const end = HYPERFRAMES_COMPILER_CHILD.indexOf(
	"  if (videos.length || doc.querySelector('audio'))",
	start,
);
if (start < 0 || end <= start)
	throw Error(
		"Production HyperFrames admission gate moved; review the CPU contract test",
	);
const admit = new Function(
	"doc",
	"config",
	HYPERFRAMES_COMPILER_CHILD.slice(start, end),
);
function document(html: string) {
	const videos = [...html.matchAll(/<video\b([^>]*)>/g)].map((match) => ({
		hasAttribute: (name: string) =>
			new RegExp(`(?:^|\\s)${name}(?:\\s|=|$)`).test(match[1]),
	}));
	return {
		querySelector: (selector: string) =>
			selector === "audio"
				? /<audio\b/.test(html)
				: selector === "audio[autoplay]"
					? /<audio\b[^>]*\bautoplay(?:\s|=|>)/.test(html)
					: false,
		querySelectorAll: (selector: string) =>
			selector === "video" ? videos : [],
	};
}
test("media negative inputs hit their precise current production native-soundtrack admission reason", async () => {
	const html = readFileSync(
			new URL("./hyperframes/media.html", import.meta.url),
			"utf8",
		),
		variants = hyperframesMediaVariants(html);
	for (const { entryFile, reason } of hyperframesMediaAdmissionNegatives) {
		expect(() =>
			admit(document(variants[entryFile]), { nativeAudio: false }),
		).toThrow(reason);
		await expectHyperframesMediaAdmissionRejection(
			async () => admit(document(variants[entryFile]), { nativeAudio: false }),
			reason,
		);
	}
	expect(() =>
		admit(document(variants["media-audio.html"]), { nativeAudio: true }),
	).not.toThrow();
	expect(() =>
		admit(document(variants["media-audible.html"]), { nativeAudio: true }),
	).not.toThrow();
	expect(() =>
		admit(document(variants["media-autoplay.html"]), { nativeAudio: true }),
	).toThrow(hyperframesMediaAdmissionNegatives[1].reason);
	expect(() =>
		admit(document('<audio autoplay src="local.wav"></audio>'), {
			nativeAudio: true,
		}),
	).toThrow("HyperFrames audio must not autoplay");
});
test("a different production failure or unexpected success cannot pass any media negative", async () => {
	for (const { reason } of hyperframesMediaAdmissionNegatives) {
		const wrong = Error("Undeclared HyperFrames media asset");
		await expect(
			expectHyperframesMediaAdmissionRejection(async () => {
				throw wrong;
			}, reason),
		).rejects.toBe(wrong);
		await expect(
			expectHyperframesMediaAdmissionRejection(async () => {}, reason),
		).rejects.toThrow(`HyperFrames expected failure: ${reason}`);
	}
});
