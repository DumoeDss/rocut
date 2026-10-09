import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { HYPERFRAMES_AUDIO_GRAPH_PATCH } from "../programmatic/engines/hyperframes-audio-graph-patch";
import { HYPERFRAMES_COMPILER_CHILD } from "../programmatic/engines/hyperframes-compiler-child";
import { runCompilerChild } from "../programmatic/engines/compiler-process";
import { nativeAudioWav } from "../../../../script/fixtures/native-audio-fixture";

const hook =
	"let{el:r}=n;if(!r.isConnected)continue;let i=n.rate??n.playbackRate,";
function patch(input: string): string {
	const context = { patched: input };
	runInNewContext(HYPERFRAMES_AUDIO_GRAPH_PATCH, context);
	return context.patched;
}

test("graph capture hook fails closed on missing or ambiguous pinned sync points", () => {
	for (const code of ["", hook.replace("n.rate", "n.speed"), hook + hook]) {
		expect(() => patch(code)).toThrow("graph observation hook changed");
	}
});

test("compiler child embeds the capture hook in its archived adapter identity", () => {
	expect(HYPERFRAMES_COMPILER_CHILD).toContain(HYPERFRAMES_AUDIO_GRAPH_PATCH);
	expect(
		HYPERFRAMES_COMPILER_CHILD.indexOf(HYPERFRAMES_AUDIO_GRAPH_PATCH),
	).toBeGreaterThan(
		HYPERFRAMES_COMPILER_CHILD.indexOf("if (config.nativeAudio)"),
	);
});

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
test.skipIf(!toolchain)(
	"actual pinned runtime captures all connected native clips before activity filtering",
	async () => {
		const core = join(toolchain!, "node_modules/@hyperframes/core");
		const manifest = JSON.parse(
			await readFile(join(core, "package.json"), "utf8"),
		);
		expect(manifest.version).toBe("0.8.139");
		const { getHyperframeRuntimeScript } = await import(
			pathToFileURL(join(core, "dist/generated/runtime-inline.js")).href
		);
		const original: string = getHyperframeRuntimeScript();
		const result = patch(original);
		const addition =
			"window.rocutHyperframesAudioGraph?.collectTrack(r,n,e.timeSeconds);";
		expect(result.split(addition)).toHaveLength(2);
		const gainAddition =
			/window\.rocutHyperframesAudioGraph\?\.collectResolvedAuthorGain\(r,n,e\.timeSeconds,[\s\S]*?(?=let I=n\.fades\?\?bm;)/g;
		expect([...result.matchAll(gainAddition)]).toHaveLength(1);
		expect(
			result
				.replace(addition, "")
				.replace(gainAddition, "")
				.replace("H,rocutGraphRouted=null,F=", "H,F=")
				.replace(
					"else (rocutGraphRouted=!!e.isWebAudioRouted?.(r))?H=E:",
					"else e.isWebAudioRouted?.(r)?H=E:",
				),
		).toBe(original);
		const gainIndex = result.indexOf(
			"window.rocutHyperframesAudioGraph?.collectResolvedAuthorGain(",
		);
		expect(result.indexOf("let I=n.fades??bm;", gainIndex)).toBeGreaterThan(
			gainIndex,
		);
		for (const shape of [
			"C=js.get(r),D=$s(r.volume),H,F=rf(r,e.timeSeconds-n.start);",
			"else e.isWebAudioRouted?.(r)?H=E:",
			"let I=n.fades??bm;",
			"function _s(e,t=Dn)",
		]) {
			expect(() => patch(original.replace(shape, "changed-shape"))).toThrow(
				"resolved author-gain hook changed",
			);
			expect(() => patch(original + shape)).toThrow(
				"resolved author-gain hook changed",
			);
		}
		const capture = result.indexOf(addition);
		expect(
			result.slice(capture - "if(!r.isConnected)continue;".length, capture),
		).toBe("if(!r.isConnected)continue;");
		expect(
			result.indexOf("a=jt(e.timeSeconds,n.start,n.end)", capture),
		).toBeGreaterThan(capture);
		expect(() => patch(result)).toThrow("graph observation hook changed");
	},
);

test.skipIf(!toolchain)(
	"real isolated compiler retains stamped media and both observation bridges",
	async () => {
		const parent = resolve(tmpdir());
		const project = await mkdtemp(join(parent, "rocut-hf-graph-compile-"));
		try {
			const core = join(toolchain!, "node_modules/@hyperframes/core/dist");
			await copyFile(
				resolve(
					import.meta.dir,
					"../../../../script/fixtures/hyperframes-audio-editor-source.html",
				),
				join(project, "source.html"),
			);
			await copyFile(
				join(toolchain!, "node_modules/gsap/dist/gsap.min.js"),
				join(project, "gsap.js"),
			);
			await writeFile(
				join(project, "loop.wav"),
				nativeAudioWav({ sampleRate: 48000, seconds: 0.12, sample: () => 0 }),
			);
			const outputFile = join(project, "compiled.html");
			const config = {
				project,
				files: ["source.html", "gsap.js", "loop.wav"],
				entryFile: "source.html",
				outputFile,
				compilerEntry: pathToFileURL(join(core, "compiler/index.js")).href,
				parserEntry: pathToFileURL(join(core, "compiler/htmlDocument.js")).href,
				width: 64,
				height: 64,
				durationFrames: 6,
				frameRate: { numerator: 25, denominator: 1 },
				nativeAudio: true,
				driver: "",
			};
			await runCompilerChild(config, AbortSignal.timeout(20000));
			const html = await readFile(outputFile, "utf8");
			expect(html.includes('data-hf-render-id="loop"')).toBe(true);
			expect(
				html.includes(
					"window.rocutHyperframesAudioGraph?.collectTrack(r,n,e.timeSeconds)",
				),
			).toBe(true);
			expect(html.includes("window.rocutHyperframesAudio?.observe(r,")).toBe(
				true,
			);
			expect(
				html.includes(
					"window.rocutHyperframesAudioGraph?.collectResolvedAuthorGain(r,n,e.timeSeconds,{gainBeforeFades:H,",
				),
			).toBe(true);
			expect(html.includes("let rocutAudioBaseGain=H,I=n.fades??bm;")).toBe(
				true,
			);
			expect(html.includes('"__rocutHyperframesAudioAdapter",{value:1}')).toBe(
				true,
			);
			// Two inlined instances may legally retain identical author IDs. Only the
			// upstream render-identity pass may resolve their clip and bus identities.
			const scene =
				'<div data-composition-id="scene" data-start="0" data-duration="0.24">' +
				'<hf-audio-group id="voice"></hf-audio-group>' +
				'<audio id="track" src="loop.wav" data-audio-group="voice" data-start="0" data-duration="0.12"></audio></div>';
			await writeFile(
				join(project, "repeated.html"),
				'<div id="root" data-composition-id="root" data-start="0" data-duration="0.24" data-width="64" data-height="64">' +
					scene +
					scene +
					"</div>",
				"utf8",
			);
			const repeatedOutput = join(project, "repeated-compiled.html");
			await runCompilerChild(
				{
					...config,
					files: ["repeated.html", "loop.wav"],
					entryFile: "repeated.html",
					outputFile: repeatedOutput,
				},
				AbortSignal.timeout(20000),
			);
			const { parseHTMLContent } = await import(
				pathToFileURL(join(core, "compiler/htmlDocument.js")).href
			);
			const repeated = parseHTMLContent(await readFile(repeatedOutput, "utf8"));
			const tracks = [...repeated.querySelectorAll("audio")];
			const buses = [...repeated.querySelectorAll("hf-audio-group")];
			expect(tracks.map((track) => track.getAttribute("id"))).toEqual([
				"track",
				"track",
			]);
			expect(buses.map((bus) => bus.getAttribute("id"))).toEqual([
				"voice",
				"voice",
			]);
			const trackIds = tracks.map((track) =>
				track.getAttribute("data-hf-render-id"),
			);
			const busIds = buses.map((bus) => bus.getAttribute("data-hf-render-id"));
			expect(new Set([...trackIds, ...busIds]).size).toBe(4);
			expect(
				tracks.map((track) => track.getAttribute("data-hf-group-render-id")),
			).toEqual(busIds);
		} finally {
			if (
				dirname(project) !== parent ||
				!basename(project).startsWith("rocut-hf-graph-compile-")
			)
				throw Error("Unsafe isolated graph compiler fixture cleanup");
			await rm(project, { recursive: true, force: true });
		}
	},
	25000,
);
