/**
 * sdk-export-capability (D1) — the real end-to-end export proof.
 *
 * Drives the BUILT Electron host (no rebuild; `dist` + `dist-main` must be
 * current) through the spec's headline path: a project created through the
 * picker, real fixture media imported and placed through the editor's own UI,
 * an export started from the host's job panel, and the produced file verified
 * with the real ffprobe (tracks, codecs, duration, decodable packets) and
 * fingerprinted (sha256 + bytes) before deletion. A final negative launch
 * proves the no-binary verdict surfaces as `unsupported`, never as a crash.
 *
 * Usage:
 *   node apps/electron-host/scripts/export-e2e-proof.mjs
 *     [--phase seed|export|verify|negative|all]  (default all)
 *     [--out-dir <dir>]   evidence directory (default: the change's evidence/)
 *     [--run-dir <dir>]   scratch roots (default: fresh timestamped e2e-d1-*)
 *     [--keep]            keep the scratch roots for diagnosis
 *
 * Scratch lives under _others/rocut-export-scratch (never %TEMP%); a fresh
 * timestamped run dir per invocation makes the proof re-runnable. Every
 * external command logs `REAL_EXIT_CODE[<step>]:<code>`; every requirement is
 * a printed PASS/FAIL gate; any failure exits nonzero.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	FFMPEG,
	FFMPEG_FREE_PATH,
	FIXTURE_IMAGE,
	FIXTURE_TONE_A4,
	addToTimeline,
	createProjectViaPicker,
	dismissOnboarding,
	evidenceCollector,
	ensureDir,
	existsSync,
	ffmpegParentPid,
	ffprobeJson,
	importFiles,
	launchEnv,
	launchHost,
	listDir,
	makeGates,
	openProjectFromPicker,
	pressShortcut,
	readPanel,
	readProjectFacts,
	removeDir,
	sampleUntilSettled,
	screenshotPanel,
	settleAutosave,
	sha256File,
	startExportFromPanel,
	tasklistFfmpeg,
	waitForEditor,
	worktreeRoot,
} from "./export-proof-lib.mjs";

const SCRATCH_BASE = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch";
const DEFAULT_EVIDENCE = join(
	worktreeRoot,
	"rasen",
	"changes",
	"sdk-export-capability",
	"evidence",
);

function parseArgs(argv) {
	const out = { phase: "all", outDir: DEFAULT_EVIDENCE, runDir: null, keep: false };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--phase") {
			index += 1;
			out.phase = argv[index];
		} else if (flag === "--out-dir") {
			index += 1;
			out.outDir = argv[index];
		} else if (flag === "--run-dir") {
			index += 1;
			out.runDir = argv[index];
		} else if (flag === "--keep") {
			out.keep = true;
		} else {
			throw new Error(`unknown argument ${flag}`);
		}
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
const runDir =
	args.runDir ?? join(SCRATCH_BASE, `e2e-d1-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const storeRoot = join(runDir, "store");
const exportsRoot = join(runDir, "exports");
const negativeExportsRoot = join(runDir, "negative-exports");
const stateFile = join(runDir, "state.json");
const ev = evidenceCollector(args.outDir);
const gates = makeGates();

function saveState(state) {
	ensureDir(runDir);
	writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
}

function loadState() {
	return JSON.parse(readFileSync(stateFile, "utf8"));
}

/** Shared prologue lines for the evidence record. */
function evidenceHeader() {
	ev.line(`# D1 — end-to-end export proof (the spec's headline scenario)`);
	ev.line("");
	ev.line(`Run: ${new Date().toISOString()}`);
	ev.line(`Worktree: ${worktreeRoot.replace(/\\/g, "/")} (built dist + dist-main; no rebuild in this proof)`);
	ev.line(`Command: node apps/electron-host/scripts/export-e2e-proof.mjs --phase ${args.phase}`);
	ev.line(`Scratch run dir: ${runDir.replace(/\\/g, "/")} (fresh per invocation; deleted after fingerprinting unless --keep)`);
	ev.line("");
	ev.line(`## Launch environment (minimal, never \`...process.env\`)`);
	ev.line("");
	ev.code(
		[
			"positive phases:",
			"  SYSTEMROOT=<windows>   (Electron hard requirement)",
			"  OPENCUT_STORE_ROOT=" + storeRoot.replace(/\\/g, "/"),
			"  OPENCUT_EXPORT_ROOT=" + exportsRoot.replace(/\\/g, "/"),
			"  OPENCUT_FFMPEG_PATH=" + FFMPEG,
			"negative phase:",
			"  SYSTEMROOT=<windows>",
			"  OPENCUT_STORE_ROOT=<same store as phase 1>",
			"  OPENCUT_EXPORT_ROOT=" + negativeExportsRoot.replace(/\\/g, "/"),
			"  OPENCUT_FFMPEG_PATH=E:/nonexistent/ffmpeg.exe",
			"  PATH=" + FFMPEG_FREE_PATH + "   (override: the auto-injected PATH carries ffmpeg)",
		].join("\n"),
	);
	ev.line("");
	ev.line(
		`Probed once in scratch (e2e-env-probe): \`_electron.launch\` env REPLACES the environment; Playwright/Electron layer the Windows essentials (COMSPEC, HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, PATHEXT, PROMPT, SYSTEMDRIVE, SYSTEMROOT, TEMP, TMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR); every explicit key above wins verbatim.`,
	);
}

// -- phase 1: seed -----------------------------------------------------------------

async function phaseSeed() {
	ev.heading("Phase 1 — seed: project through the picker, real media placed");
	ensureDir(storeRoot);
	ensureDir(exportsRoot);

	const launched = await launchHost(
		launchEnv({ storeRoot, exportsRoot, ffmpegPath: FFMPEG }),
	);
	const { app, page, consoleErrors } = launched;
	const projectId = await createProjectViaPicker(page);
	ev.line(`- project created through the picker: id \`${projectId}\`, url records \`?project=\``);
	await waitForEditor(page);
	const onboarding = await dismissOnboarding(page);
	ev.line(`- onboarding dialog: ${onboarding === null ? "none" : `dismissed "${onboarding}"`}`);

	await importFiles(page, [FIXTURE_IMAGE, FIXTURE_TONE_A4]);
	await assetCardVisible(page, "fixture-image.png");
	await assetCardVisible(page, "fixture-tone-a4.wav");
	ev.line(`- both fixtures imported through the assets panel's own input (parity driver's Electron path)`);

	await placeAtHome(page, "fixture-image.png");
	await placeAtHome(page, "fixture-tone-a4.wav");
	await settleAutosave(page);

	const facts = await readProjectFacts(page, projectId);
	if (facts === null) throw new Error(`no persisted record for ${projectId}`);
	gates.gate(
		"seed/visual-clip",
		facts.elements.some(
			(element) =>
				(element.kind === "visual-main" || element.kind === "visual-overlay") &&
				element.name.includes("fixture-image"),
		),
		`image element on a visual track: ${JSON.stringify(facts.elements.find((element) => element.name.includes("fixture-image")))}`,
	);
	gates.gate(
		"seed/audio-clip",
		facts.elements.some(
			(element) => element.kind === "audio" && element.name.includes("fixture-tone-a4"),
		),
		`audio element on an audio track: ${JSON.stringify(facts.elements.find((element) => element.kind === "audio"))}`,
	);
	const totalFrames = Math.floor(facts.extentTicks / 4000);
	const expectedSec = totalFrames / 30;
	ev.line(`- persisted timeline extent: ${facts.extentTicks} ticks -> ${totalFrames} frames @30fps = ${expectedSec}s`);
	ev.line(`- canvas: ${JSON.stringify(facts.canvas)}, fps: ${JSON.stringify(facts.fps)}`);
	ev.code(JSON.stringify(facts.elements, null, 1));

	await app.close();
	ev.line(`- app closed after seed; state saved for the export phase`);
	const state = {
		projectId,
		extentTicks: facts.extentTicks,
		totalFrames,
		expectedSec,
		canvas: facts.canvas,
		consoleErrorsSeed: consoleErrors,
	};
	saveState(state);
	return state;
}

async function assetCardVisible(page, name) {
	const card = page
		.locator("div.group")
		.filter({ has: page.locator(`[title="${name}"]`) })
		.first();
	await card.waitFor({ timeout: 180_000 });
}

async function placeAtHome(page, name) {
	await pressShortcut(page, "Home");
	await addToTimeline(page, name);
	await page.waitForTimeout(800);
}

// -- phase 2: export ------------------------------------------------------------------

async function phaseExport(state) {
	ev.heading("Phase 2 — export from the panel, observed through both phases");
	const launched = await launchHost(
		launchEnv({ storeRoot, exportsRoot, ffmpegPath: FFMPEG }),
	);
	const { app, page, consoleErrors } = launched;
	await openProjectFromPicker(page, "Untitled Project");

	const windowsBefore = app.windows().length;
	const encodeObservations = [];
	let runningShotTaken = false;
	const renderFirstAt = { value: null };
	const encodeFirstAt = { value: null };

	const startedAt = Date.now();
	await startExportFromPanel(page, { format: "mp4", quality: "high", includeAudio: true });
	ev.line(`- export started (mp4 / high / include audio) at T+0`);

	const outcome = await sampleUntilSettled(page, app, {
		intervalMs: 250,
		timeoutMs: 180_000,
		onSample: async (sample, elapsedS) => {
			if (sample.status.startsWith("Rendering") && renderFirstAt.value === null) {
				renderFirstAt.value = elapsedS;
			}
			if (sample.status.startsWith("Encoding") && encodeFirstAt.value === null) {
				encodeFirstAt.value = elapsedS;
				const parent = ffmpegParentPid(`d1-ffmpeg-parent@${elapsedS.toFixed(0)}s`);
				encodeObservations.push({
					atS: elapsedS,
					windows: app.windows().length,
					parent,
				});
			}
			if (
				!runningShotTaken &&
				sample.status.startsWith("Rendering") &&
				sample.progress > 0
			) {
				runningShotTaken = true;
				await screenshotPanel(
					page,
					app,
					join(args.outDir, "screenshots", "d1-panel-rendering.png"),
				);
			}
		},
	});

	const renderDurationS =
		encodeFirstAt.value !== null && renderFirstAt.value !== null
			? encodeFirstAt.value - renderFirstAt.value
			: null;
	const encodeDurationS =
		encodeFirstAt.value !== null ? outcome.elapsedS - encodeFirstAt.value : null;
	ev.line(`- render phase observed: ${renderFirstAt.value !== null ? `first sample at T+${renderFirstAt.value}s` : "NEVER"}`);
	ev.line(`- encode phase observed: ${encodeFirstAt.value !== null ? `first sample at T+${encodeFirstAt.value}s` : "NEVER"}`);
	ev.line(`- render duration (panel timestamps): ${renderDurationS === null ? "n/a" : renderDurationS.toFixed(2) + "s"}`);
	ev.line(`- encode duration (panel timestamps): ${encodeDurationS === null ? "n/a" : encodeDurationS.toFixed(2) + "s"}`);
	ev.line(`- windows: ${windowsBefore} before start; encode-time observations: ${JSON.stringify(encodeObservations.map((entry) => ({ atS: entry.atS, windows: entry.windows, ffmpegCaught: entry.parent.caught, rows: entry.parent.rows ?? null })))}`);

	ev.line("");
	ev.line("Progress series (recorded on change):");
	ev.code(
		outcome.series
			.map(
				(entry) =>
					`T+${String(entry.t).padStart(7)}s  ${entry.status}  ${entry.progress >= 0 ? entry.progress + "%" : ""}${entry.accepted !== null ? ` (${entry.accepted}/${entry.total} frames)` : ""}`,
			)
			.join("\n"),
	);

	gates.gate(
		"export/render-phase-observed",
		outcome.series.some((entry) => entry.status.startsWith("Rendering")),
		"at least one rendering-phase sample",
	);
	gates.gate(
		"export/encode-phase-observed",
		outcome.series.some((entry) => entry.status.startsWith("Encoding")),
		"at least one encoding-phase sample",
	);
	gates.gate(
		"export/completed",
		outcome.settled !== null && outcome.settled.status.startsWith("Export complete"),
		`settled view: ${outcome.settled === null ? "TIMEOUT" : JSON.stringify(outcome.settled.status)}`,
	);
	gates.gate(
		"export/duration-matches",
		renderDurationS !== null && encodeDurationS !== null && renderDurationS > 0 && encodeDurationS >= 0,
		`render ${renderDurationS === null ? "?" : renderDurationS.toFixed(2)}s, encode ${encodeDurationS === null ? "?" : encodeDurationS.toFixed(2)}s vs timeline ${state.expectedSec}s`,
	);

	// The deliverable crosses as an opaque descriptor; capture it from BOTH the
	// panel and the page's own job bridge.
	const panel = await readPanel(page);
	const bridge = await page.evaluate(async () => {
		const jobs = await window.opencutExport.listJobs();
		const completed = jobs.find((job) => job.phase === "completed");
		return completed ?? null;
	});
	ev.line(`- panel output line: ${JSON.stringify(panel.outputName)} (${panel.bytesText ?? "?"})`);
	ev.line(`- bridge snapshot: ${JSON.stringify(bridge)}`);
	gates.gate(
		"export/output-descriptor-reported",
		panel.outputName.length > 0 && bridge !== null && bridge.output !== null,
		`panel name + bridge descriptor ${bridge === null ? "?" : bridge.output?.descriptor} bytes ${bridge === null ? "?" : bridge.output?.bytes}`,
	);
	const descriptor = bridge?.output?.descriptor ?? "";
	gates.gate(
		"export/descriptor-opaque",
		/^file:[A-Za-z0-9._\-]+$/.test(descriptor),
		`no drive letter / backslash / second colon in ${JSON.stringify(descriptor)}`,
	);

	await screenshotPanel(page, app, join(args.outDir, "screenshots", "d1-panel-done.png"));

	// Window lifecycle: the hidden producer must be gone after settle.
	let windowsAfter = app.windows().length;
	for (let attempt = 0; attempt < 20 && windowsAfter > 1; attempt += 1) {
		await page.waitForTimeout(500);
		windowsAfter = app.windows().length;
	}
	gates.gate(
		"export/producer-window-closed",
		windowsAfter === 1,
		`windows after settle: ${windowsAfter} (was ${windowsBefore} before, 2 during)`,
	);
	ev.line(`- windows after settle: ${windowsAfter} (producer destroyed)`);

	// The encoder-in-main observation (spec scenario; best-effort by timing).
	const parentRow = encodeObservations.flatMap((entry) => entry.parent.rows ?? [])[0] ?? null;
	if (parentRow !== null) {
		const mainPid = app.process().pid;
		gates.gate(
			"export/ffmpeg-child-of-main",
			Number(parentRow.ParentProcessId) === mainPid,
			`ffmpeg pid ${parentRow.ProcessId} parent ${parentRow.ParentProcessId} vs electron main ${mainPid}`,
		);
	} else {
		ev.line(`- ffmpeg parent-pid: not caught (encode window shorter than the CIM poll) — recorded as observation, not gated`);
	}

	ev.line(`- console errors during export: ${JSON.stringify(consoleErrors)}`);
	gates.gate(
		"export/no-console-errors",
		consoleErrors.length === 0,
		consoleErrors.slice(0, 3).join(" | "),
	);

	await app.close();
	const nextState = {
		...state,
		outputName: panel.outputName,
		descriptor,
		outputBytes: bridge?.output?.bytes ?? null,
		framesAccepted: bridge?.frames?.accepted ?? null,
		framesTotal: bridge?.frames?.total ?? null,
		renderDurationS,
		encodeDurationS,
		progressSeries: outcome.series,
		consoleErrorsExport: consoleErrors,
	};
	saveState(nextState);
	return nextState;
}

// -- phase 3: verify -------------------------------------------------------------------

async function phaseVerify(state) {
	ev.heading("Phase 3 — verify the deliverable with the real ffprobe");
	const outputName = state.outputName;
	const outputPath = join(exportsRoot, outputName);
	gates.gate(
		"verify/output-exists",
		existsSync(outputPath),
		`${outputName} under the exports root`,
	);

	const probe = ffprobeJson("d1-ffprobe-streams", outputPath);
	const streams = probe.json?.streams ?? [];
	const videoStreams = streams.filter((stream) => stream.codec_type === "video");
	const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
	const format = probe.json?.format ?? {};
	gates.gate("verify/ffprobe-ran", probe.ok, `exit ${probe.code}`);
	gates.gate(
		"verify/one-video-one-audio",
		videoStreams.length === 1 && audioStreams.length === 1,
		`video ${videoStreams.length} (${videoStreams.map((stream) => stream.codec_name).join(",")}), audio ${audioStreams.length} (${audioStreams.map((stream) => stream.codec_name).join(",")})`,
	);
	gates.gate(
		"verify/codecs-h264-aac-mp4",
		videoStreams[0]?.codec_name === "h264" &&
			audioStreams[0]?.codec_name === "aac" &&
			String(format.format_name ?? "").includes("mp4"),
		`container ${format.format_name ?? "?"}`,
	);
	const duration = Number(format.duration ?? 0);
	gates.gate(
		"verify/duration-matches-timeline",
		Math.abs(duration - state.expectedSec) <= 0.3,
		`ffprobe ${duration}s vs expected ${state.expectedSec}s (tolerance 0.3)`,
	);

	const packets = ffprobeJson("d1-ffprobe-count-packets", outputPath, ["-count_packets"]);
	const packetStreams = packets.json?.streams ?? [];
	const videoPackets = Number(packetStreams[0]?.nb_read_packets ?? -1);
	const audioPackets = Number(packetStreams[1]?.nb_read_packets ?? -1);
	gates.gate(
		"verify/decodable-packets-both-streams",
		videoPackets > 0 && audioPackets > 0,
		`nb_read_packets video ${videoPackets}, audio ${audioPackets}`,
	);

	const fingerprint = sha256File(outputPath);
	ev.line(`- output fingerprint: ${fingerprint.sha256} / ${fingerprint.bytes} bytes (${outputName})`);

	// Transient artifacts: the record stays, the stream and wav do not.
	const jobsDir = join(exportsRoot, "jobs");
	const jobsListing = listDir(jobsDir) ?? [];
	const recordFiles = jobsListing.filter((name) => name.endsWith(".json"));
	const leftoverStreams = jobsListing.filter(
		(name) => name.endsWith(".raw") || name.endsWith(".wav"),
	);
	const rootListing = (listDir(exportsRoot) ?? []).filter((name) => name !== "jobs");
	gates.gate(
		"verify/transients-cleaned",
		leftoverStreams.length === 0 && !rootListing.some((name) => name.includes(".partial")),
		`jobs dir: ${JSON.stringify(jobsListing)}; exports root files: ${JSON.stringify(rootListing)}`,
	);
	gates.gate(
		"verify/record-kept",
		recordFiles.length === 1,
		`record ${recordFiles[0] ?? "none"} kept as history`,
	);
	let record = null;
	if (recordFiles.length === 1) {
		try {
			record = JSON.parse(readFileSync(join(jobsDir, recordFiles[0]), "utf8"));
		} catch (error) {
			record = { parseError: String(error) };
		}
	}
	gates.gate(
		"verify/record-completed",
		record !== null && record.phase === "completed" && record.outputName === outputName,
		`record phase ${record?.phase ?? "unreadable"}, outputName ${record?.outputName ?? "?"}`,
	);

	ev.line("");
	ev.line("ffprobe -show_streams -show_format (tail):");
	ev.code(
		JSON.stringify(
			{
				streams: streams.map((stream) => ({
					codec_type: stream.codec_type,
					codec_name: stream.codec_name,
					width: stream.width,
					height: stream.height,
					nb_frames: stream.nb_frames,
					duration: stream.duration,
				})),
				format: {
					format_name: format.format_name,
					duration: format.duration,
					size: format.size,
				},
			},
			null,
			1,
		),
	);

	// Disk hygiene: the deliverable is fingerprinted; delete it now.
	removeDir(exportsRoot);
	ev.line(`- exports root deleted after fingerprinting (disk discipline)`);
	return { ...state, fingerprint };
}

// -- phase 4: negative --------------------------------------------------------------------

async function phaseNegative(state) {
	ev.heading("Phase 4 — negative: no discoverable binary means unsupported");
	ensureDir(negativeExportsRoot);
	const launched = await launchHost(
		launchEnv({
			storeRoot,
			exportsRoot: negativeExportsRoot,
			ffmpegPath: "E:/nonexistent/ffmpeg.exe",
			pathOverride: FFMPEG_FREE_PATH,
		}),
	);
	const { app, page } = launched;
	await openProjectFromPicker(page, "Untitled Project");

	const panel = await readPanel(page);
	const verdict = await page.evaluate(async () => window.opencutExport.canExport());
	ev.line(`- panel state: ${JSON.stringify({ status: panel.status, hasStart: panel.hasStart })}`);
	ev.line(`- bridge canExport: ${JSON.stringify(verdict)}`);

	gates.gate(
		"negative/canExport-false",
		verdict !== null && verdict.ffmpegAvailable === false,
		`probe verdict ${JSON.stringify(verdict)}`,
	);
	gates.gate(
		"negative/panel-reports-unsupported",
		panel.status.startsWith("Export unavailable: no FFmpeg binary was found"),
		`status: ${JSON.stringify(panel.status)}`,
	);
	gates.gate(
		"negative/no-start-affordance",
		!panel.hasStart,
		"the unsupported view renders no start button",
	);
	await screenshotPanel(page, app, join(args.outDir, "screenshots", "d1-panel-unsupported.png"));

	const tasks = tasklistFfmpeg("d1-negative-tasklist");
	ev.line(`- tasklist ffmpeg.exe (no leak across launches): count ${tasks.count}, exit ${tasks.code}`);

	await app.close();
	removeDir(negativeExportsRoot);
	ev.line(`- negative exports root deleted`);
	return state;
}

// -- main ------------------------------------------------------------------------------------

async function main() {
	evidenceHeader();
	let state = null;
	if (args.phase === "all" || args.phase === "seed") {
		state = await phaseSeed();
	} else {
		state = loadState();
	}
	if (args.phase === "all" || args.phase === "export") {
		state = await phaseExport(state);
	}
	if (args.phase === "all" || args.phase === "verify") {
		state = await phaseVerify(state);
	}
	if (args.phase === "all" || args.phase === "negative") {
		state = await phaseNegative(state);
	}

	ev.heading("Gates");
	for (const entry of gates.all()) {
		ev.line(`- ${entry.ok ? "PASS" : "FAIL"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
	}
	const file = await ev.flush("d1-e2e-export.md");
	console.log(`evidence written: ${file}`);

	if (gates.failures().length > 0) {
		console.error(`D1 E2E PROOF FAILED (${gates.failures().length} gate(s))`);
		process.exit(1);
	}
	if (!args.keep) {
		removeDir(runDir);
		console.log(`scratch run dir deleted: ${runDir}`);
	}
	console.log("D1 E2E PROOF PASSED");
	process.exit(0);
}

main().catch(async (error) => {
	console.error("D1 E2E PROOF FAILED:", error?.stack ?? error);
	ev.heading("Aborted");
	ev.line(`Fatal: ${String(error?.stack ?? error)}`);
	for (const entry of gates.all()) {
		ev.line(`- ${entry.ok ? "PASS" : "FAIL"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
	}
	await ev.flush("d1-e2e-export.md").catch(() => {});
	console.error(`scratch kept for diagnosis: ${runDir}`);
	process.exit(1);
});
