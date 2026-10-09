import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { withHyperframesAudioAnalyzer } from "../../apps/cli/src/programmatic/hyperframes-audio-analysis";
import { CURRENT_PROJECT_VERSION } from "../../packages/editor-classic/src/services/storage/migrations/version";

const artifact = process.argv[2];
if (!artifact || !isAbsolute(artifact))
	throw Error("Provide this fixture's retained absolute artifact directory");
const input = JSON.parse(
	await readFile(join(artifact, "host/sources.json"), "utf8"),
);
const source = input.sources.hyperframes as ProgrammaticSource;
const require = createRequire(
	new URL("../../apps/vite-example/package.json", import.meta.url),
);
const { chromium } = await import(
	pathToFileURL(require.resolve("@playwright/test")).href
);
const resourceStore = {
	store: new FileProjectStore({
		root: join(artifact, "host/project"),
		schemaVersion: CURRENT_PROJECT_VERSION,
	}),
	projectId: "multishot-mv",
};
const timing = (frame: number) => ({
	source,
	clipStart: 0,
	clipDuration: 720000,
	trimStart: 0,
	timelineTime: frame * 4800,
});
const records: Array<Record<string, unknown>> = [];
const all = process.argv.includes("--all");
const selected = process.argv
	.find((value) => value.startsWith("--frames="))
	?.slice("--frames=".length);
if (selected && (all || !/^\d+(,\d+)*$/.test(selected)))
	throw Error("Choose --all or a comma-separated frame list");
const frames = selected
	? selected.split(",").map(Number)
	: all
		? Array.from({ length: 150 }, (_, i) => i)
		: [0, 1, 4, 5, 25, 49, 50, 75, 99, 100, 125, 144, 145, 149];
if (
	frames.length > 150 ||
	frames.some((frame) => !Number.isInteger(frame) || frame < 0 || frame >= 150)
)
	throw Error("Diagnostic frames must be within this 150-frame fixture");
const report = join(
	artifact,
	selected
		? `audio-diagnostic-frames-${Date.now()}.json`
		: all
			? "audio-diagnostic-all.json"
			: "audio-diagnostic.json",
);
let activeFrame = -1;
try {
	await withHyperframesAudioAnalyzer(
		{
			executable: chromium.executablePath(),
			resourceStore,
			request: timing(0),
			// Overall fixture ceiling scales with short vs continuous observations. The
			// production analyzer's own 15-second per-frame watchdog is unchanged.
			signal: AbortSignal.timeout(frames.length > 14 ? 900000 : 180000),
		},
		async (analyzer) => {
			for (const frame of frames) {
				activeFrame = frame;
				const started = performance.now();
				console.log(JSON.stringify({ state: "observing", frame }));
				const observed = await analyzer.frame(timing(frame));
				const record = {
					frame,
					elapsedMs: performance.now() - started,
					assets: observed.assets.length,
					observationSha256: createHash("sha256")
						.update(JSON.stringify(observed))
						.digest("hex"),
				};
				records.push(record);
				console.log(JSON.stringify(record));
			}
		},
	);
	await writeFile(report, JSON.stringify({ passed: true, records }, null, 2));
} catch (error) {
	await writeFile(
		report,
		JSON.stringify(
			{ passed: false, activeFrame, records, error: String(error) },
			null,
			2,
		),
	);
	console.error(JSON.stringify({ activeFrame, error: String(error) }));
	process.exitCode = 1;
}
