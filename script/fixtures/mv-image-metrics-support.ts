import type {
	ProgrammaticResource,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	resolveProgrammaticFrame,
	type ProgrammaticFrame,
} from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

export function check(value: unknown, message: string): asserts value {
	if (!value) throw Error(message);
}
export async function rejects(action: () => Promise<unknown>, pattern: RegExp) {
	try {
		await action();
	} catch (error) {
		check(pattern.test(String(error)), `Wrong rejection: ${String(error)}`);
		return;
	}
	throw Error(`Expected rejection: ${pattern}`);
}
export async function resource(
	id: string,
	mimeType: string,
	body: ArrayBuffer,
): Promise<ResolvedProgrammaticResource> {
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	return {
		body,
		resource: {
			id,
			kind: "image",
			mimeType,
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}
export function orientedJpeg(jpeg: ArrayBuffer) {
	const exif = new Uint8Array([
		0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1,
		3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
	]);
	const result = new Uint8Array(jpeg.byteLength + exif.length + 4);
	result.set([0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2]);
	result.set(exif, 6);
	result.set(new Uint8Array(jpeg).subarray(2), 6 + exif.length);
	return result.buffer;
}
export function source(
	resources: readonly ProgrammaticResource[],
	code = "throw Error('Measurement executed author code')",
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code,
		resources,
		width: 32,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 0,
	};
}
export function frame(s: ProgrammaticSource): ProgrammaticFrame {
	const resolved = resolveProgrammaticFrame({
		source: s,
		clipStart: 0,
		clipDuration: 1,
		trimStart: 17,
		timelineTime: 0,
	});
	check(resolved, "Missing public frame");
	check(
		!resolved.imageDimensionRequests,
		"Old code-only node unexpectedly requests image facts",
	);
	// Private bridge fixture only, not a pretend Ember author field or consumer.
	return {
		...resolved,
		imageDimensionRequests: s.resources
			?.filter((r) => r.kind === "image")
			.map((r) => ({ resource: r })),
	};
}
export async function insertedIframe(count: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const observer = new MutationObserver(() => {
			if (document.querySelectorAll("iframe").length > count) {
				clearTimeout(timer);
				observer.disconnect();
				resolve();
			}
		});
		const timer = setTimeout(() => {
			observer.disconnect();
			reject(Error("Sandbox did not become in-flight"));
		}, 3000);
		observer.observe(document.body, { childList: true });
	});
}
