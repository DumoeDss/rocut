import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { readNativeVideoFrame } from "./remotion-video-browser-probe";
import { hyperframesMediaCases, hyperframesMediaAdmissionNegatives, expectHyperframesMediaAdmissionRejection } from "./hyperframes-media-cases";

export let hyperframesVideoSource: ProgrammaticSource | undefined;

export async function runHyperframesVideoProbe(spec: Record<string, unknown>) {
	const provider = createHttpProgrammaticFrames({ base: "/api" });
	const post = async (path: string, body: unknown) => {
		const response = await fetch(`/api/programmatic/${path}`, { method: "POST", body: JSON.stringify(body) });
		if (!response.ok) throw Error(await response.text());
		return response.json();
	};
	const { resource } = await post("resources/import", {
		filePath: `${spec.sourceDirectory}/assets/fast.webm`, id: "video/fast.webm", kind: "video", mimeType: "video/webm",
	});
	const compile = async (entryFile: string, extra = {}) => (await post("build/compile", {
		...spec, entryFile, frameRate: { numerator: 100, denominator: 1 }, durationFrames: 200, ...extra,
	})).source as ProgrammaticSource;
	const render = (source: ProgrammaticSource, index: number) => provider.renderPng({
		request: { source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: index * 1200 },
		signal: new AbortController().signal,
	});
	const check = async (source: ProgrammaticSource, index: number, bottom: number | null) => {
		const bitmap = await createImageBitmap(await render(source, index));
		try {
			const top = index >= 17 && index < 37 ? 6 + (index - 17) * 2 : null;
			for (const [offset, expected] of [[0, top], [32, bottom]] as const) {
				if (expected === null) {
					const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
					ctx.drawImage(bitmap, 0, 0);
					if (ctx.getImageData(4, offset + 8, 1, 1).data[3] !== 0) throw Error(`HyperFrames half-open visibility at ${index}, row ${offset}`);
				} else {
					const actual = readNativeVideoFrame(bitmap, offset);
					if (actual !== expected) throw Error(`HyperFrames source frame at ${index}, row ${offset}: expected ${expected}, got ${actual}`);
				}
			}
		} finally { bitmap.close(); }
	};
	let attachmentSource: ProgrammaticSource | undefined;
	for (const [entryFile, cases] of Object.entries(hyperframesMediaCases)) {
		const source = await compile(entryFile, entryFile === "media-resource.html" ? { resources: [resource] } : {});
		for (const [index, bottom] of cases) {
			console.log(`HTML probe: HyperFrames decoded-frame attempt ${JSON.stringify({ entryFile, index, bottom })}`);
			await check(source, index, bottom);
		}
		if (entryFile === "media.html") hyperframesVideoSource = source;
		if (entryFile === "media-resource.html") attachmentSource = source;
		console.log(`HTML probe: HyperFrames ${entryFile} decoded-frame checks passed`);
	}
	const rejected = async (run: () => Promise<unknown>, match: RegExp) => {
		try { await run(); } catch (error) { if (match.test(String(error))) return; throw error; }
		throw Error(`HyperFrames expected failure: ${match}`);
	};
	for (const { entryFile, reason } of hyperframesMediaAdmissionNegatives)
		await expectHyperframesMediaAdmissionRejection(() => compile(entryFile), reason);
	await rejected(() => compile("media.html", { files: (spec.files as string[]).filter(f => f !== "assets/fast.webm") }), /undeclared|Undeclared/);
	const corrupt = await compile("media-corrupt.html");
	await rejected(() => render(corrupt, 1), /decode failed/);
	await rejected(() => render({ ...attachmentSource!, resources: attachmentSource!.resources!.filter(r => r.id !== resource.id) }, 1), /Unknown.*resource|Missing.*resource|not declared/i);
	console.log(`HTML probe: HyperFrames decoded-frame attempt ${JSON.stringify({ entryFile: "media.html", index: 18, bottom: 18 })}`);
	await check(hyperframesVideoSource!, 18, 18);
	console.log("HTML probe: HyperFrames media admission, missing/corrupt inputs and capture recovery passed");
}
