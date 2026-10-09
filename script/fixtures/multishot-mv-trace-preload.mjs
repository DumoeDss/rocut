import { mock } from "bun:test";
import { appendFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { traceAudioCollector } from "./multishot-mv-trace.mjs";
import { instrumentAudioExpression } from "./multishot-mv-trace-inner.mjs";

const destination = process.env.ROCUT_TEST_MULTISHOT_AUDIO_TRACE;
if (
	!destination ||
	!isAbsolute(destination) ||
	basename(destination) !== "audio-trace.jsonl" ||
	resolve(dirname(destination)) !== resolve(tmpdir())
)
	throw Error(
		"Audio trace must be inside this invocation's private TEMP directory",
	);

const moduleUrl = new URL(
	"../../apps/cli/src/programmatic/hyperframes-audio-analysis-frame.ts",
	import.meta.url,
);
const actual = await import(moduleUrl.href);
const original = actual.collectHyperframesAudioSnapshot;
const traced = traceAudioCollector(
	original,
	(record) => {
		appendFileSync(destination, JSON.stringify(record) + "\n", {
			encoding: "utf8",
		});
	},
	process.env.ROCUT_TEST_MULTISHOT_TRACE_INNER === "1"
		? { instrumentExpression: instrumentAudioExpression }
		: {},
);
mock.module(moduleUrl.href, () => ({
	collectHyperframesAudioSnapshot: traced,
}));
