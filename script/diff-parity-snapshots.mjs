#!/usr/bin/env node
/**
 * Task 9.8 — diff the two normalized parity snapshots and classify every
 * difference as **semantic** or **incidental**.
 *
 *   node script/diff-parity-snapshots.mjs \
 *     apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json \
 *     apps/vite-example/tests/parity-artifacts/next/snapshot-next.json
 *
 * The classification rules below are an explicit, reviewable allowlist, and the
 * default is **semantic**. That direction matters: an unclassified difference
 * shows up as a Slice finding rather than being quietly absorbed, so forgetting
 * a rule cannot manufacture a pass. A semantic difference is a finding to
 * report, never something to normalize away in `snapshot.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [viteFile, nextFile, outFile] = process.argv.slice(2);
if (!viteFile || !nextFile) {
	console.error(
		"usage: diff-parity-snapshots.mjs <vite-snapshot.json> <next-snapshot.json> [out.md]",
	);
	process.exit(2);
}

/**
 * One video frame in wasm `MediaTime` ticks at the project's default 30 fps
 * (120,000 ticks per second). Placement values are quantized to frames, so this
 * is the smallest difference two runs can express — see the one-frame rule below.
 */
const FRAME_TICKS = 4000;
const PLACEMENT_PATH =
	/(startTime|duration|trimStart|trimEnd)$/;

/**
 * path pattern -> why this difference carries no editing meaning.
 * Patterns are matched against the dotted path with array indices as `[n]`.
 * A rule may also inspect the two values.
 */
const INCIDENTAL = [
	// Order matters, and only here: `find` returns the first match, and the
	// general placement rule below also matches `project.metadata.duration`
	// (its regex ends `…|duration)$`). Both rules gate on the same exact
	// `=== FRAME_TICKS` test and both yield `incidental`, so the order cannot
	// change a classification — it decides only which explanation is printed,
	// and this one is the accurate one for this path. Keep it first.
	{
		test: (path, a, b) =>
			path === "project.metadata.duration" &&
			typeof a === "number" &&
			typeof b === "number" &&
			Math.abs(a - b) === FRAME_TICKS,
		why: "Project duration is the end of the last clip, so it inherits the one-frame difference on the placement values rather than being an independent deviation.",
	},
	{
		test: (path, a, b) =>
			PLACEMENT_PATH.test(path) &&
			typeof a === "number" &&
			typeof b === "number" &&
			Math.abs(a - b) === FRAME_TICKS,
		why: "Exactly one frame (4,000 ticks at 30 fps). The scenario's drag and trim are **pixel**-denominated gestures, and the two hosts hand the timeline different widths on purpose — the Vite example embeds the editor in a bounded box rather than the viewport — so their zoom differs (7.13 vs 7.31, 2.5%). Both hosts *request* the same pixel distance, but neither the achieved distance nor the ticks it converts to are the same: a gesture is measured in pixels and stored in ticks at that host's own zoom, then quantized to a frame. **Only an exact one-frame difference is classified here; anything larger stays semantic** — but the rule matches on value, not on cause; see \"Limits of this classification\".",
	},
	{
		test: (path) => path === "project.metadata.name",
		why: "The project name is chosen by the host's own create call (`Untitled Project` in the Vite example, `New project` in apps/web), not by the editor.",
	},
	{
		test: (path) => path.startsWith("project.timelineViewState"),
		why: "Timeline zoom/scroll state is derived from the timeline's pixel width. The Vite example deliberately embeds the editor in a bounded box rather than the whole viewport, so the two hosts give it different widths.",
	},
	{
		test: (path) => /^media\[\d+\]\.lastModified$/.test(path),
		why: "The file's own mtime as the browser reported it at import time.",
	},
	{
		test: (path) => path.startsWith("normalizationLedger"),
		why: "Bookkeeping about what normalization replaced (id counts, thumbnail byte lengths). Not project content.",
	},
];

function flatten(value, path, out) {
	if (value === null || typeof value !== "object") {
		out.set(path, value);
		return out;
	}
	if (Array.isArray(value)) {
		out.set(`${path}.length`, value.length);
		value.forEach((entry, index) => flatten(entry, `${path}[${index}]`, out));
		return out;
	}
	for (const [key, entry] of Object.entries(value)) {
		flatten(entry, path ? `${path}.${key}` : key, out);
	}
	return out;
}

const vite = JSON.parse(readFileSync(viteFile, "utf8"));
const next = JSON.parse(readFileSync(nextFile, "utf8"));

const viteFlat = flatten(vite, "", new Map());
const nextFlat = flatten(next, "", new Map());

const paths = [...new Set([...viteFlat.keys(), ...nextFlat.keys()])].sort();
const differences = [];
for (const path of paths) {
	// `trackSummary` is a derived, human-readable view of `project.scenes`. Its
	// values are already compared field by field above, so diffing it too would
	// report every difference twice. It is printed side by side at the end
	// instead, where it is useful.
	if (path.startsWith("trackSummary")) continue;
	const a = viteFlat.get(path);
	const b = nextFlat.get(path);
	if (Object.is(a, b)) continue;
	const rule = INCIDENTAL.find((entry) => entry.test(path, a, b));
	differences.push({
		path,
		vite: viteFlat.has(path) ? a : "<absent>",
		next: nextFlat.has(path) ? b : "<absent>",
		classification: rule ? "incidental" : "semantic",
		why: rule?.why ?? "",
	});
}

const semantic = differences.filter((d) => d.classification === "semantic");
const incidental = differences.filter((d) => d.classification === "incidental");

const short = (value) => {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text !== undefined && text.length > 70
		? `${text.slice(0, 67)}…`
		: (text ?? "undefined");
};

const lines = [];
lines.push("# Parity deviation report");
lines.push("");
lines.push(
	"One Playwright scenario — create a project, import an image, a video and two audio files, place " +
		"clips on two visual and two audio tracks, drag, trim, split, snap, scrub, play, save, reload the " +
		"page fully, reopen — driven against **two production builds of the same editor source**: the " +
		"Vite example with no Next.js runtime, and `apps/web` under `next build` + `next start`. After " +
		"the scenario each run reads the persisted project out of IndexedDB through the storage " +
		"service's own database and store names and normalizes it.",
);
lines.push("");
lines.push(
	"Normalization replaces ids with ordinals by first appearance, timestamps with placeholders and " +
		"data-URL payloads with a mime placeholder. It never touches track membership, clip ordering, " +
		"`startTime`, `duration`, `trimStart` or `trimEnd` — those are what the diff exists to compare.",
);
lines.push("");
lines.push(
	"This report is evidence, not a verdict: it does not decide whether the Slice passed.",
);
lines.push("");
lines.push(
	"Generated by `script/diff-parity-snapshots.mjs` from the two normalized snapshots:",
);
lines.push("");
lines.push(`- Vite host: \`${viteFile}\``);
lines.push(`- Next host: \`${nextFile}\``);
lines.push("");
lines.push(
	`**${differences.length} difference(s): ${semantic.length} semantic, ${incidental.length} incidental.** ` +
		`${viteFlat.size} leaf values compared.`,
);
lines.push("");
lines.push(
	"Classification is fail-safe: anything without an explicit incidental rule is reported as semantic.",
);
lines.push("");

lines.push("## Semantic differences");
lines.push("");
if (semantic.length === 0) {
	lines.push(
		"None. The two hosts persisted the same tracks, carrying the same clips in the same order, " +
			"with every placement, trim and duration value either identical or differing by exactly one " +
			"frame for the reason recorded under incidental differences.",
	);
} else {
	lines.push("| path | vite | next |");
	lines.push("| --- | --- | --- |");
	for (const d of semantic) {
		lines.push(`| \`${d.path}\` | ${short(d.vite)} | ${short(d.next)} |`);
	}
	lines.push("");
	lines.push(
		"**Each row above is a Slice finding.** A semantic difference means the same editing actions produced different persisted state in the two hosts.",
	);
}
lines.push("");

lines.push("## Incidental differences");
lines.push("");
if (incidental.length === 0) {
	lines.push("None.");
} else {
	lines.push("| path | vite | next | why it carries no editing meaning |");
	lines.push("| --- | --- | --- | --- |");
	for (const d of incidental) {
		lines.push(
			`| \`${d.path}\` | ${short(d.vite)} | ${short(d.next)} | ${d.why} |`,
		);
	}
}
lines.push("");

// The classification's own blind spot, stated in the generated report rather
// than only in a review thread, so it travels with the verdict it qualifies.
lines.push("## Limits of this classification");
lines.push("");
lines.push(
	"**The one-frame rule matches on value, not on cause.** A difference is classified incidental " +
		"when the path ends in `startTime`, `duration`, `trimStart` or `trimEnd` and the two values " +
		"differ by exactly 4,000 ticks. The rule states a zoom explanation but never checks it: it " +
		"does not derive the expected delta from each host's recorded pixel distance and zoom. A " +
		"genuine one-frame regression on exactly the values this diff exists to protect would " +
		"therefore be absorbed and reported as a pass.",
);
lines.push("");
lines.push(
	"Everything else is caught. Against deliberately corrupted snapshots, shifting a placement by " +
		"two frames, deleting a clip, reordering clips, moving a clip to another track, deleting a " +
		"whole track, tampering with a trim, injecting a `blob:` URL and removing a media asset all " +
		"report as semantic and exit non-zero. The exact one-frame delta is the single blind spot, " +
		"and it is inherent to the rule rather than incidental to a run.",
);
lines.push("");
lines.push(
	"Closing it means making the rule causation-aware — reconciling each difference against the " +
		"interaction ledger's recorded pixel distance at that host's zoom, and rejecting a " +
		"4,000-tick delta the gesture does not account for. That is a harness change, deliberately " +
		"not made here.",
);
lines.push("");
lines.push(
	"A second, smaller limit: the `why` column is prose written by whoever added the rule. It " +
		"explains a classification; nothing re-derives it at run time.",
);
lines.push("");

lines.push("## Track summary, side by side");
lines.push("");
lines.push("| host | visual tracks | audio tracks | clips (name@start+duration, in track order) |");
lines.push("| --- | --- | --- | --- |");
for (const [name, snapshot] of [
	["vite", vite],
	["next", next],
]) {
	const summary = snapshot.trackSummary ?? {};
	const clips = (summary.tracks ?? [])
		.map((track) => `${track.kind}: ${track.elements.join(", ") || "—"}`)
		.join("<br>");
	lines.push(
		`| ${name} | ${summary.visualTracks ?? "?"} | ${summary.audioTracks ?? "?"} | ${clips} |`,
	);
}
lines.push("");
lines.push(
	"Times are in wasm `MediaTime` ticks (120,000 per second), which is what the editor persists.",
);
lines.push("");

// The interaction ledger, if the runs left one beside each snapshot. Task 9.6:
// an interaction with neither an assertion nor a capture is not evidence, so
// the report states per interaction and per host which it was.
const ledgers = {};
for (const [host, file] of [
	["vite", viteFile],
	["next", nextFile],
]) {
	const path = file.replace(/snapshot-\w+\.json$/, `ledger-${host}.json`);
	try {
		ledgers[host] = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		/* a ledger is optional; its absence is reported below */
	}
}

if (ledgers.vite && ledgers.next) {
	lines.push("## Interaction ledger");
	lines.push("");
	lines.push(
		"Per interaction, per host: **asserted** (a machine-checked claim held), " +
			"**captured** (a screenshot exists but nothing was asserted), or **missing** " +
			"(neither — not evidence, and reported as absent).",
	);
	lines.push("");
	lines.push("| interaction | vite | next | assertions |");
	lines.push("| --- | --- | --- | --- |");
	for (const [index, entry] of ledgers.vite.interactions.entries()) {
		const other = ledgers.next.interactions[index];
		const state = (item) =>
			!item
				? "missing"
				: item.asserted.length > 0
					? `asserted (${item.asserted.length})`
					: item.captured.length > 0
						? "**captured only**"
						: "**missing**";
		lines.push(
			`| \`${entry.id}\` — ${entry.title} | ${state(entry)} | ${state(other)} | ${entry.asserted.join("; ") || "—"} |`,
		);
	}
	lines.push("");
	const blocked = [
		...new Set([
			...ledgers.vite.blockedThirdPartyRequests,
			...ledgers.next.blockedThirdPartyRequests,
		]),
	];
	lines.push(
		`**Third-party requests blocked during the runs: ${blocked.length}.** ` +
			(blocked.length === 0
				? "Every request either host made was first-party, so the scenario doubles as the §3.7 network-blocked evidence."
				: `Blocked: ${blocked.join(", ")}.`),
	);
	const consoleErrors = [
		...ledgers.vite.consoleErrors,
		...ledgers.next.consoleErrors,
	];
	lines.push("");
	lines.push(
		`**Console errors across both runs: ${consoleErrors.length}.**` +
			(consoleErrors.length === 0
				? ""
				: ` ${consoleErrors.slice(0, 5).join(" | ")}`),
	);
	lines.push("");
} else {
	lines.push("## Interaction ledger");
	lines.push("");
	lines.push(
		"**Not available** — no `ledger-<host>.json` was found beside one or both snapshots.",
	);
	lines.push("");
}

const report = `${lines.join("\n")}\n`;
if (outFile) writeFileSync(outFile, report);
else process.stdout.write(report);

console.error(
	`${differences.length} difference(s): ${semantic.length} semantic, ${incidental.length} incidental`,
);
process.exit(semantic.length === 0 ? 0 : 1);
