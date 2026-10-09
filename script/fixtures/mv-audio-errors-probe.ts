import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvAudioFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-audio-frame";
import { audioResource } from "./mv-audio-fixture";
import { assertPost as assert } from "./mv-post-fixture";

export async function checkAudioAttachmentFailures({
	source,
	resources,
	analysis,
	rejects,
}: {
	source: ProgrammaticSource;
	resources: ResolvedProgrammaticResource[];
	analysis: ResolvedProgrammaticResource;
	rejects: (
		source: ProgrammaticSource,
		pattern: RegExp,
		resources?: ResolvedProgrammaticResource[],
	) => Promise<void>;
}) {
	await rejects(
		source,
		/attachment is missing/,
		resources.filter((r) => r !== analysis),
	);
	const corrupt = analysis.body.slice(0);
	new Uint8Array(corrupt)[0] ^= 1;
	await rejects(
		source,
		/digest mismatch/,
		resources.map((r) => (r === analysis ? { ...r, body: corrupt } : r)),
	);
	const malformed = await audioResource(new Uint8Array([255]).buffer);
	await rejects(
		{
			...source,
			resources: resources.map((r) =>
				r === analysis ? malformed.resource : r.resource,
			),
		},
		/encoded data was not valid/,
		resources.map((r) => (r === analysis ? malformed : r)),
	);
	const foreign = {
		...source,
		recipe: {
			...source.recipe!,
			audio: { ...source.recipe!.audio!, inputSha256: "b".repeat(64) },
		},
	};
	await rejects(foreign, /different song digest/);
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 60000,
		clipDuration: 30000,
		trimStart: 5000,
		timelineTime: 65000,
	})!;
	const hydrated = await resolveMvAudioFrame({ source, frame, resources });
	assert(
		hydrated.timelineTime === 65000 &&
			hydrated.sourceTime === 10000 &&
			hydrated.index === 2,
		"Hydration changed timeline/trim mapping",
	);
	const abort = new AbortController();
	abort.abort(new Error("audio-probe-abort"));
	let aborted = false;
	try {
		const unexpected = await renderProgrammaticCanvas({
			source,
			frame,
			resources,
			signal: abort.signal,
		});
		unexpected.close();
	} catch (e) {
		aborted = String(e).includes("audio-probe-abort");
	}
	assert(
		aborted && document.querySelectorAll("iframe").length === 0,
		"Aborted audio hydration leaked or rendered",
	);
}
