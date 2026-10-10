import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { nativeAudioWav } from "./native-audio-fixture";

/** Reuse the real fallback-history author fixture and its original GSAP lanes.
 * Extra renderSeek calls run the original native sync twice at the same clock;
 * no synthetic gain/history facts are injected into the collector. */
export function functionalHistoryHtml(template: string) {
	assert.ok(template.includes('id="fractional-loop"'));
	assert.ok(template.includes('id="dynamic-dom"'));
	return template.replace('    <audio id="inert-history"',
		'    <audio id="scalar-fractional" src="scalar.wav" data-start="0.1" data-duration="0.4000052083333333" data-media-start="0.010005208333333334" data-playback-rate="1.5" data-volume="0.35"></audio>\n    <audio id="inert-history"')
		.replace("  </script>", `
    const originalFrame = window.rocut.renderFrame.bind(window.rocut);
    window.rocut.renderFrame = async frame => {
      await originalFrame(frame);
      window.__player.renderSeek(frame.time, {exact:true,suppressEvents:false});
      await window.__hfWaitForSeekCompletion();
    };
  </script>`);
}

export async function prepareFunctionalHistoryProject(directory: string, toolchainDirectory: string, signal: AbortSignal) {
	const sourceDirectory = join(directory, "author");
	await mkdir(sourceDirectory);
	const template = await readFile(new URL("./hyperframes-native-gain-history.html", import.meta.url), "utf8");
	await writeFile(join(sourceDirectory, "source.html"), functionalHistoryHtml(template), {flag:"wx"});
	await copyFile(join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"), join(sourceDirectory, "gsap.js"));
	await writeFile(join(sourceDirectory, "tone.wav"), nativeAudioWav({seconds:0.16,
		sample:(frame,channel)=>Math.sin(frame * 2 * Math.PI * 440 / 48000) * (channel ? 0.15 : 0.25)}), {flag:"wx"});
	// Nonloop scalar duration must not be truncated by the short loop fixture.
	await writeFile(join(sourceDirectory, "scalar.wav"), nativeAudioWav({seconds:1,
		sample:(frame,channel)=>Math.sin(frame * 2 * Math.PI * 660 / 48000) * (channel ? 0.1 : 0.2)}), {flag:"wx"});
	const resourceStore = {store:new FileProjectStore({root:join(directory,"store"),schemaVersion:1}),projectId:"history-functional"};
	const {source} = await compileProgrammaticProject({action:"compile",toolchainDirectory,context:resourceStore,
		signal,enqueue:task=>task(),input:{version:1,engine:"hyperframes",sourceDirectory,entryFile:"source.html",
			files:["source.html","gsap.js","tone.wav","scalar.wav"],width:64,height:64,
			frameRate:{numerator:25,denominator:1},durationFrames:20,seed:7,
			audio:{version:1,mode:"native",profile:"hyperframes-graph-v1"}}});
	return {source,resourceStore};
}
