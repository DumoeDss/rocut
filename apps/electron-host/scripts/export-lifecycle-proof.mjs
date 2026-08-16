/**
 * sdk-export-capability (D2 v2) — progress / cancel / recovery through the
 * real app, at a density this machine survives.
 *
 * v1 (dense-2000) measured ~5s/frame (3-frame batches every ~15s under
 * swiftshader) — a ~25-minute render — and the interactive page died
 * mid-render; the machine itself froze later under a PARALLEL perf run. v2
 * therefore runs ONE app instance at a time (each phase its own process, app
 * closed between phases), never starts playback in the interactive window
 * (the crash trigger surface), seeds dense-800 (≈263 frames ≈ 8.8s timeline,
 * every frame composites all 800 elements; measured ~18.9s/frame on the
 * post-freeze machine ≈ 83min full render — see the budgets block), and
 * samples progress from TWO sources: the panel DOM (dies with
 * the page) and the job record file `<exportsRoot>/jobs/<jobId>.json` (the
 * manager persists it after every transition — phase + frames — so it is the
 * durable fallback the brief asks for).
 *
 * Legs (each a separate `--phase` invocation unless `all`):
 *
 *   progress  — start export; sample BOTH sources; assert ≥3 strictly
 *               increasing rendering samples (DOM if alive, record file as
 *               the stated fallback), ≥1 encoding sample, monotonic within
 *               phase, completion, then ffprobe the deliverable (1 video
 *               1280x720, duration ≈ totalFrames/30 ±0.3s, -count_frames in
 *               band), sha256+bytes, clean. Doubles as the completed-render
 *               reference.
 *   cancel    — fresh seed+boot; cancel at rendering progress > 0.05
 *               (DOM-or-record); assert cancelled ≤15s, no ffmpeg.exe
 *               before/after, exports root keeps ONLY the cancelled record
 *               .json; re-cancel idempotent (second click if the affordance
 *               survives the settle window — button withdrawn is the
 *               contract-level idempotence).
 *   recovery  — fresh seed+boot; at progress ∈ (--kill-at-min,
 *               --kill-at-max) HARD-KILL the process tree (taskkill /F /T
 *               /PID <main>); verify raw size ≈ acceptedFrames×1280×720×3
 *               ±10% (acceptedFrames from the record at rest); relaunch
 *               SAME roots; panel lists the job interrupted (screenshot);
 *               Resume; complete; ffprobe as leg 1; fingerprint; clean. Run
 *               twice (kill/restart stability is the point).
 *   probe-rate — console-only: seed at --clips, start one export, sample
 *               the record until --probe-frames frames are accepted, print
 *               s/frame + ready-to-paste budget flags. Writes no evidence
 *               section.
 *   sweep     — after all legs: no electron/ffmpeg processes tied to this
 *               worktree remain (tasklist + CIM command-line check); any
 *               stray MY run left is killed and the re-check must be clean.
 *
 * Tiered density (lead ruling 2026-08-16): the progress leg stays at
 * dense-800 — one completed 800-dense export doubles as the E2c baseline
 * reference data point (2000 never completed inside its budget). The cancel
 * and recovery legs run at a smaller --clips (100): their lifecycle
 * semantics (progress monotonicity, cancel-stops-and-cleans, interrupted
 * discovery + resume + complete output) are density-independent, and D1
 * already proved the small-project end-to-end path. Their budgets come from
 * a probe-rate measurement (measured s/frame × frames × 1.5 + boot
 * allowances) passed via --full/--resume/--kill-window-budget-ms; kill
 * window fractions via --kill-at-min/--kill-at-max (small densities use
 * 0.2/0.4 so the window is not over in seconds).
 *
 * Density step-down rule (brief): on an app-level crash (wasm `unreachable`
 * signature, GPU process death, producer death mid-render), the leg is
 * marked RED honestly and re-run ONCE at --clips 400; if 400 also crashes,
 * stop and report.
 *
 * Frame math (derived, not assumed): the generator's dense layout at N clips
 * spans (ceil(N/16)-1)×1920 + 960000 ticks; the producer floors
 * duration/4000 — N=800 → 1054080 ticks → 263 frames → 8.7667s. The brief's
 * "≈240 frames / ≈10s" parenthetical is superseded by this formula; the seed
 * command itself is exactly as briefed.
 *
 * Usage:
 *   node apps/electron-host/scripts/export-lifecycle-proof.mjs
 *     [--phase progress|cancel|recovery|probe-rate|sweep|all]  (default all)
 *     [--recovery-runs 2] [--clips 800] [--append] [--out-dir <dir>]
 *     [--run-dir <dir>] [--keep] [--probe-frames 10]
 *     [--full-budget-ms N] [--resume-budget-ms N] [--kill-window-budget-ms N]
 *     [--kill-at-min 0.1] [--kill-at-max 0.6] [--cancel-at-min 0.05]
 *     [--resume-mode complete|continuity] [--gpu swiftshader|real]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	FFMPEG,
	appRoot,
	cmd,
	crashSignatureIn,
	evidenceCollector,
	ensureDir,
	existsSync,
	ffprobeJson,
	fileSize,
	killStrayPids,
	launchEnv,
	launchHost,
	listDir,
	makeGates,
	openProjectFromPicker,
	pollProgressDual,
	readJobRecord,
	readPanelOrDead,
	removeDir,
	sampleDualUntilSettled,
	screenshotPanel,
	sha256File,
	sleep,
	startExportFromPanel,
	strayProcessSweep,
	tasklistFfmpeg,
	tasklistImage,
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
const GENERATOR = join(appRoot, "scripts", "generate-clip-project.mjs");
const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_BYTES = WIDTH * HEIGHT * 3;
const WORKTREE_FRAGMENT = "rocut-wt-export";
/**
 * Budgets, MEASURED on this machine (attempt 2 of the progress leg, live
 * record timestamps): dense-800 renders at ~18.9 s/frame under swiftshader
 * once the post-freeze machine is also carrying the user's other Electron
 * apps — one full 263-frame render is ~83 min, NOT the brief's ~2 s/frame
 * estimate (which extrapolated linearly from the pre-freeze 2000-element
 * 5 s/frame). Same class of deviation v1 recorded (600s→2400s): the seed
 * stays exactly as briefed; the await budgets carry ~1.5x margin.
 */
const FULL_EXPORT_TIMEOUT_MS = 7_500_000;
const RESUME_TIMEOUT_MS = 6_600_000;
/** Kill window (0.1–0.6 of 263 frames) worst case ≈ 3000s at the measured rate. */
const KILL_WINDOW_TIMEOUT_MS = 3_600_000;
const CANCEL_SETTLE_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
	const out = {
		phase: "all",
		recoveryRuns: 2,
		clips: 800,
		outDir: DEFAULT_EVIDENCE,
		runDir: null,
		keep: false,
		append: false,
		probeFrames: 10,
		fullBudgetMs: 0,
		resumeBudgetMs: 0,
		killWindowBudgetMs: 0,
		killAtMin: 0.1,
		killAtMax: 0.6,
		cancelAtMin: 0.05,
		resumeMode: "complete",
		gpu: "swiftshader",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--phase") {
			index += 1;
			out.phase = argv[index];
		} else if (flag === "--recovery-runs") {
			index += 1;
			out.recoveryRuns = Number.parseInt(argv[index], 10);
		} else if (flag === "--clips") {
			index += 1;
			out.clips = Number.parseInt(argv[index], 10);
		} else if (flag === "--out-dir") {
			index += 1;
			out.outDir = argv[index];
		} else if (flag === "--run-dir") {
			index += 1;
			out.runDir = argv[index];
		} else if (flag === "--keep") {
			out.keep = true;
		} else if (flag === "--append") {
			out.append = true;
		} else if (flag === "--probe-frames") {
			index += 1;
			out.probeFrames = Number.parseInt(argv[index], 10);
		} else if (flag === "--full-budget-ms") {
			index += 1;
			out.fullBudgetMs = Number.parseInt(argv[index], 10);
		} else if (flag === "--resume-budget-ms") {
			index += 1;
			out.resumeBudgetMs = Number.parseInt(argv[index], 10);
		} else if (flag === "--kill-window-budget-ms") {
			index += 1;
			out.killWindowBudgetMs = Number.parseInt(argv[index], 10);
		} else if (flag === "--kill-at-min") {
			index += 1;
			out.killAtMin = Number.parseFloat(argv[index]);
		} else if (flag === "--kill-at-max") {
			index += 1;
			out.killAtMax = Number.parseFloat(argv[index]);
		} else if (flag === "--cancel-at-min") {
			index += 1;
			out.cancelAtMin = Number.parseFloat(argv[index]);
		} else if (flag === "--resume-mode") {
			index += 1;
			out.resumeMode = argv[index];
		} else if (flag === "--gpu") {
			index += 1;
			out.gpu = argv[index];
		} else {
			throw new Error(`unknown argument ${flag}`);
		}
	}
	if (!Number.isInteger(out.clips) || out.clips < 1) {
		throw new Error(`--clips must be a positive integer, got ${out.clips}`);
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
const runDir =
	args.runDir ?? join(SCRATCH_BASE, `e2e-d2-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const ev = evidenceCollector(args.outDir);
const gates = makeGates();
const PROJECT_NAME = `D2 ${args.clips}`;
const DENSITY = `${args.clips}`;
/**
 * Tiered budgets (lead ruling, 2026-08-16): the constants above are the
 * dense-800 ceilings measured at 18.9 s/frame; the cancel/recovery legs run
 * at a smaller density whose budgets come from a probe-rate measurement
 * (measured s/frame x frames x 1.5), passed via --full/resume/kill-window
 * -budget-ms. 0 keeps the 800-scale default.
 */
const SETTLE_BUDGET_MS = args.fullBudgetMs > 0 ? args.fullBudgetMs : FULL_EXPORT_TIMEOUT_MS;
const RESUME_BUDGET_MS = args.resumeBudgetMs > 0 ? args.resumeBudgetMs : RESUME_TIMEOUT_MS;
const KILL_WINDOW_BUDGET_MS =
	args.killWindowBudgetMs > 0 ? args.killWindowBudgetMs : KILL_WINDOW_TIMEOUT_MS;

/** The live app handle — closed on every exit path (v1 leaked it on abort). */
let liveApp = null;
let liveAppPid = null;

async function closeLiveApp(reason) {
	if (liveApp === null) return;
	const app = liveApp;
	liveApp = null;
	try {
		await app.close();
		console.log(`app closed (${reason})`);
	} catch (error) {
		console.log(`app close (${reason}) failed: ${String(error?.message ?? error)} — taskkill fallback`);
		if (liveAppPid !== null) {
			cmd(`d2-app-cleanup-${reason}`, "taskkill", ["/F", "/T", "/PID", String(liveAppPid)]);
		}
	}
}

/** Seed one fresh store root via the generator; returns the project facts. */
function seedProject(storeRoot, step) {
	ensureDir(storeRoot);
	const generated = cmd(step, process.execPath, [
		GENERATOR,
		"--root",
		storeRoot,
		"--clips",
		DENSITY,
		"--name",
		PROJECT_NAME,
		"--layout",
		"dense",
		"--width",
		String(WIDTH),
		"--height",
		String(HEIGHT),
		"--self-log",
	]);
	const projectId = /^PROJECT id: (.+)$/m.exec(generated.stdout)?.[1] ?? null;
	const timelineTicks = /totals: timeline = (\d+) ticks/.exec(generated.stdout)?.[1] ?? null;
	gates.gate(
		`seed/${step}`,
		generated.ok && projectId !== null,
		`generator exit ${generated.code}, project ${projectId}, timeline ${timelineTicks} ticks`,
	);
	// The producer floors duration/ticksPerFrame (export-renderer/main.ts) —
	// same math here so expected totals are derived, not hardcoded.
	const totalFrames =
		timelineTicks === null ? null : Math.floor(Number(timelineTicks) / 4000);
	return {
		projectId,
		totalFrames,
		expectedSec: totalFrames === null ? null : totalFrames / 30,
	};
}

/**
 * Wait out the open-path save so Start's guard snapshot is fresh.
 *
 * Diagnosis (attempt 3, named error in the record): a thumbnail-less project
 * (EVERY fresh seed — generator writes `thumbnail: undefined`) makes the
 * editor render a thumbnail from the timeline and save the project MID-OPEN
 * (project-manager.ts loadProject), bumping summary.updatedAt — and the panel
 * is already interactive before that save lands (`this.active = project` +
 * notify precede the thumbnail block). startJob snapshots its
 * content-digest guard (projectContentGuard) from the store record at click time; the producer
 * window re-reads the record at beginExport seconds later and fails the job
 * `project-updated-mid-job` when the save landed in between (measured:
 * thumbnail save ~8s after open on this loaded machine at 800 elements).
 * Waiting for record.json's summary.updatedAt to go quiet before the caller
 * can click Start/Resume closes that window from the harness side.
 */
async function waitForOpenSaveSettled(storeRoot, projectId) {
	const recordPath = join(storeRoot, "projects", projectId, "record.json");
	const readUpdatedAt = () => {
		try {
			const envelope = JSON.parse(readFileSync(recordPath, "utf8"));
			return envelope?.summary?.updatedAt ?? null;
		} catch {
			return null;
		}
	};
	const quietWindowMs = 12_000; // covers the measured ~8s thumbnail render
	const stepMs = 3_000;
	const timeoutMs = 150_000;
	const seedUpdatedAt = readUpdatedAt();
	let latest = seedUpdatedAt;
	let quietSinceMs = Date.now();
	const startedMs = Date.now();
	while (Date.now() - startedMs < timeoutMs) {
		await sleep(stepMs);
		const value = readUpdatedAt();
		if (value !== latest) {
			latest = value;
			quietSinceMs = Date.now();
		} else if (Date.now() - quietSinceMs >= quietWindowMs) {
			break;
		}
	}
	return {
		stable: Date.now() - quietSinceMs >= quietWindowMs,
		waitedMs: Date.now() - startedMs,
		sawBump: latest !== seedUpdatedAt,
		seedUpdatedAt,
		finalUpdatedAt: latest,
	};
}

/** Launch + open the seeded project; returns the live handle. */
async function launchOpenProject(storeRoot, exportsRoot, projectId) {
	ensureDir(exportsRoot);
	const launched = await launchHost(
		launchEnv({ storeRoot, exportsRoot, ffmpegPath: FFMPEG }),
		{ gpu: args.gpu },
	);
	liveApp = launched.app;
	liveAppPid = launched.app.process().pid;
	const onboarding = await openProjectFromPicker(launched.page, PROJECT_NAME);
	await launched.page
		.locator('[data-testid="export-panel"]')
		.waitFor({ timeout: 60_000 });
	// A fresh store shows the start form; a relaunched store with an
	// interrupted job may paint the interrupted list first — accept either.
	await launched.page
		.locator('[data-testid="export-start"], [data-testid="export-interrupted"]')
		.first()
		.waitFor({ timeout: 60_000 });
	const openSaveSettled = await waitForOpenSaveSettled(storeRoot, projectId);
	console.log(
		`open-save-settled: stable=${openSaveSettled.stable} waited=${(openSaveSettled.waitedMs / 1000).toFixed(1)}s sawThumbnailSaveBump=${openSaveSettled.sawBump} finalUpdatedAt=${openSaveSettled.finalUpdatedAt}`,
	);
	return { ...launched, onboarding, openSaveSettled };
}

/** Record a page death (if any) with its crash-signature reading. */
function notePageDeath(outcome, consoleErrors) {
	if (!outcome.domDead) return;
	const signature = crashSignatureIn(consoleErrors);
	ev.line(
		`- INTERACTIVE PAGE DIED at T+${outcome.domDiedAtS ?? "?"}s — ${signature.length > 0 ? "known crash signature present" : "no known crash signature"} in captured console lines`,
	);
	if (signature.length > 0) {
		ev.code(signature.slice(0, 5).join("\n"));
	} else if (consoleErrors.length > 0) {
		ev.code(consoleErrors.slice(0, 5).join("\n"));
	}
}

/** Print a DOM/record series compactly (first 8, last 8, every 10th between). */
function seriesLines(entries, format) {
	if (entries.length === 0) return "(no samples)";
	const lines = entries.map(format);
	const picked = lines.filter(
		(_, index, all) => index < 8 || index > all.length - 9 || index % 10 === 0,
	);
	return `${picked.join("\n")}\n(${entries.length} transitions total)`;
}

/**
 * Full forensic dump for a failed settle: every job record JSON verbatim
 * (the named `error` reason lives there) plus the main-process output tail
 * (the manager's log lines, producer-window and ffmpeg spawn errors). The
 * D2 v2 forensic patch — attempt 1's failure escaped through both gaps.
 */
function dumpForensics(exportsRoot, mainOutput, tail = 40) {
	const jobsDir = join(exportsRoot, "jobs");
	const names = (listDir(jobsDir) ?? []).filter(
		(name) => name.endsWith(".json") && !name.includes(".tmp-"),
	);
	for (const name of names) {
		ev.line(`- record ${name} (verbatim):`);
		try {
			ev.code(readFileSync(join(jobsDir, name), "utf8"));
		} catch (error) {
			ev.line(`  (unreadable: ${String(error)})`);
		}
	}
	if (names.length === 0) ev.line(`- no record files present under ${jobsDir}`);
	ev.line(`- main-process output tail (${mainOutput.length} lines captured):`);
	ev.code(mainOutput.slice(-tail).join("\n") || "(nothing captured — stream absent or silent)");
}

// -- leg 1: progress ----------------------------------------------------------------

async function phaseProgress() {
	ev.heading(`Leg 1 — PROGRESS (dense-${DENSITY}): both sources, monotonic, completes, verifies`);
	const storeRoot = join(runDir, "store-progress");
	const exportsRoot = join(runDir, "exports-progress");
	const seed = seedProject(storeRoot, "d2-generate-progress");
	ev.line(
		`- project ${seed.projectId}: ${seed.totalFrames} frames expected (${seed.expectedSec?.toFixed(4)}s — producer floors timeline/4000)`,
	);

	const session = await launchOpenProject(storeRoot, exportsRoot, seed.projectId);
	ev.line(`- editor + panel ready (onboarding: ${session.onboarding ?? "none"})`);
	ev.line(
		`- open-path save settled before Start: waited ${(session.openSaveSettled.waitedMs / 1000).toFixed(1)}s, thumbnail-save bump observed: ${session.openSaveSettled.sawBump ? "yes" : "no"}, final record updatedAt ${session.openSaveSettled.finalUpdatedAt}${session.openSaveSettled.stable ? "" : " (TIMEOUT — proceeded anyway)"}`,
	);
	const windowsBefore = session.app.windows().length;

	await startExportFromPanel(session.page, { format: "mp4", quality: "high" });
	ev.line(
		`- export started (mp4 / high / audio default ON — no audio content; extractTimelineAudio degrades to a silent WAV, recorded honestly); NO playback started in the interactive window (crash-trigger surface, avoided)`,
	);

	let runningShotTaken = false;
	const outcome = await sampleDualUntilSettled(
		session.page,
		session.app,
		exportsRoot,
		{
			intervalMs: 500,
			timeoutMs: SETTLE_BUDGET_MS,
			onSample: async ({ domSample, elapsedS }) => {
				if (
					!runningShotTaken &&
					domSample !== null &&
					domSample.status.startsWith("Rendering") &&
					domSample.progress > 0
				) {
					runningShotTaken = true;
					await screenshotPanel(
						session.page,
						session.app,
						join(args.outDir, "screenshots", "d2-progress-rendering.png"),
					).catch(() => {});
				}
			},
		},
	);

	const firstRendering = outcome.domSeries.find((entry) =>
		entry.status.startsWith("Rendering"),
	);
	const firstEncoding = outcome.domSeries.find((entry) =>
		entry.status.startsWith("Encoding"),
	);
	const renderSeconds =
		firstRendering && firstEncoding
			? (firstEncoding.t - firstRendering.t).toFixed(1)
			: null;
	const recordRendering = outcome.recordSeries.filter(
		(entry) => entry.phase === "rendering" && entry.accepted !== null,
	);
	const recordEncoding = outcome.recordSeries.filter(
		(entry) => entry.phase === "encoding",
	);
	const perFrameMs =
		renderSeconds === null || seed.totalFrames === null
			? null
			: (Number(renderSeconds) * 1000) / seed.totalFrames;
	ev.line(
		`- render phase (DOM): T+${firstRendering?.t ?? "?"}s -> T+${firstEncoding?.t ?? "?"}s = ${renderSeconds ?? "?"}s${perFrameMs === null ? "" : ` (${(perFrameMs / 1000).toFixed(2)}s/frame over ${seed.totalFrames} frames)`}; total to settled ${outcome.elapsedS.toFixed(1)}s`,
	);
	ev.line(
		`- record-file series: ${recordRendering.length} rendering transitions, ${recordEncoding.length} encoding transitions; DOM ${outcome.domDead ? "DIED" : "alive"} at settle`,
	);
	notePageDeath(outcome, session.consoleErrors);

	// ≥3 strictly increasing rendering samples — DOM is the primary source;
	// the record file is the fallback the brief adds against page death.
	const domAccepted = [
		...new Set(
			outcome.domSeries
				.filter((entry) => entry.status.startsWith("Rendering") && entry.accepted !== null)
				.map((entry) => entry.accepted),
		),
	];
	const recordAccepted = [...new Set(recordRendering.map((entry) => entry.accepted))];
	const provenByDom = !outcome.domDead && domAccepted.length >= 3;
	const provenByRecord = recordAccepted.length >= 3;
	const strictlyIncreasingDom =
		domAccepted.length >= 3 &&
		domAccepted.slice(1).every((value, index) => value > domAccepted[index]);
	const strictlyIncreasingRecord =
		recordAccepted.length >= 3 &&
		recordAccepted.slice(1).every((value, index) => value > recordAccepted[index]);
	gates.gate(
		"progress/three-increasing-render-samples",
		provenByDom ? strictlyIncreasingDom : provenByRecord && strictlyIncreasingRecord,
		provenByDom
			? `DOM source: distinct accepted values ${domAccepted.length}: [${domAccepted.slice(0, 6).join(", ")}${domAccepted.length > 6 ? ", ..." : ""}]`
			: provenByRecord
				? `DOM ${outcome.domDead ? "died" : "gave <3 samples"} — proven by RECORD-FILE source: distinct accepted values ${recordAccepted.length}: [${recordAccepted.slice(0, 6).join(", ")}${recordAccepted.length > 6 ? ", ..." : ""}]`
				: `neither source yielded 3 samples (DOM ${domAccepted.length}, record ${recordAccepted.length})`,
	);
	const monotoneSource = provenByDom ? domAccepted : recordAccepted;
	gates.gate(
		"progress/render-monotonic",
		monotoneSource.length >= 2 &&
			monotoneSource.slice(1).every((value, index) => value > monotoneSource[index],
		),
		`${provenByDom ? "DOM" : "record"} accepted counts strictly increasing across every recorded transition`,
	);
	gates.gate(
		"progress/encoding-sample-present",
		outcome.domSeries.some((entry) => entry.status.startsWith("Encoding")) ||
			recordEncoding.length >= 1,
		`DOM encoding samples ${outcome.domSeries.filter((entry) => entry.status.startsWith("Encoding")).length}; record encoding transitions ${recordEncoding.length}`,
	);
	const encodingProgress = (
		outcome.domDead ? recordEncoding.map((entry) => entry.progress) : []
	).concat(
		outcome.domSeries
			.filter((entry) => entry.status.startsWith("Encoding"))
			.map((entry) => entry.progress),
	);
	gates.gate(
		"progress/encoding-monotonic",
		(() => {
			// The manager-persisted record series is the semantic authority:
			// the store refuses progress decreases (unit-proven, mutation-
			// verified in group-b evidence). The DOM series is REPORTED for
			// observation but not gated here — the poll reads status and
			// progress as two DOM reads, and across a phase flip the pair can
			// tear (status already "Encoding…", number still the render
			// phase's last value; observed on the real-GPU legs as [100, 52]
			// where the encode finished in under a second). Asserting the
			// torn pair would gate the browser's repaint scheduling, not the
			// export's semantics.
			const recordEncodingProgress = recordEncoding.map(
				(entry) => entry.progress,
			);
			return recordEncodingProgress.every(
				(value, index) =>
					index === 0 || value >= recordEncodingProgress[index - 1],
			);
		})(),
		`record encoding series [${recordEncoding.map((entry) => entry.progress.toFixed(2)).slice(0, 8).join(", ")}] non-decreasing (authoritative); DOM series [${encodingProgress.slice(0, 8).map((v) => v.toFixed(2)).join(", ")}] reported, ungated for read-pair tearing`,
	);
	gates.gate(
		"progress/completed",
		outcome.recordSettled?.phase === "completed" &&
			(outcome.domSettled !== null || outcome.domDead),
		`record phase ${outcome.recordSettled?.phase ?? "UNSETTLED (timeout)"}${outcome.recordSettled?.error ? ` error: ${JSON.stringify(outcome.recordSettled.error)}` : ""}; DOM settled ${outcome.domSettled !== null ? `"${outcome.domSettled.status}"` : outcome.domDead ? "(page dead — record is the witness)" : "no"}`,
	);
	if (
		outcome.recordSettled?.phase === "failed" ||
		(outcome.domSettled !== null && outcome.domSettled.status.startsWith("Export failed"))
	) {
		const panelNow = await readPanelOrDead(session.page).catch(() => ({ sample: null }));
		ev.line(
			`- LEG RED — record error: ${JSON.stringify(outcome.recordSettled?.error ?? "(record unreadable)")}; panel text at settle: ${JSON.stringify(panelNow.sample?.rawText ?? "(page gone)")}`,
		);
		dumpForensics(exportsRoot, session.mainOutput);
	}
	gates.gate(
		"progress/final-total-matches",
		outcome.recordSettled !== null &&
			seed.totalFrames !== null &&
			outcome.recordSettled.acceptedFrames === seed.totalFrames &&
			outcome.recordSettled.totalFrames === seed.totalFrames,
		`record frames ${outcome.recordSettled?.acceptedFrames ?? "?"}/${outcome.recordSettled?.totalFrames ?? "?"} vs expected ${seed.totalFrames}`,
	);
	const signature = crashSignatureIn(session.consoleErrors);
	gates.gate(
		"progress/no-console-errors",
		session.consoleErrors.length === 0,
		session.consoleErrors.length === 0
			? "0 console errors captured"
			: `${session.consoleErrors.length} captured${signature.length > 0 ? " — KNOWN CRASH SIGNATURE PRESENT" : ""}: ${session.consoleErrors.slice(0, 3).join(" | ")}`,
	);

	ev.line("");
	ev.line("DOM series (recorded on change; full run):");
	ev.code(
		seriesLines(
			outcome.domSeries,
			(entry) =>
				`T+${String(entry.t).padStart(8)}s  ${entry.status}  ${entry.progress >= 0 ? entry.progress + "%" : ""}${entry.accepted !== null ? ` (${entry.accepted}/${entry.total})` : ""}`,
		),
	);
	ev.line("Record-file series (persisted by the manager after every transition):");
	ev.code(
		seriesLines(
			outcome.recordSeries,
			(entry) =>
				`T+${String(entry.t).padStart(8)}s  ${entry.phase}  ${(entry.progress * 100).toFixed(0)}%${entry.accepted !== null ? ` (${entry.accepted}/${entry.total ?? "?"})` : ""}`,
		),
	);
	ev.line(
		`- windows: ${windowsBefore} before start; console errors: ${JSON.stringify(session.consoleErrors.slice(0, 5))}`,
	);
	ev.line(`- main-process output tail (last 8 lines of ${session.mainOutput.length}):`);
	ev.code(session.mainOutput.slice(-8).join("\n") || "(silent)");

	// The deliverable: ffprobe + fingerprint, then clean.
	const outputName = outcome.recordSettled?.outputName ?? outcome.domSettled?.outputName ?? "";
	const outputPath = join(exportsRoot, outputName);
	gates.gate("progress/output-exists", outputName !== "" && existsSync(outputPath), outputName);
	if (existsSync(outputPath)) {
		const probe = ffprobeJson("d2-progress-ffprobe", outputPath, ["-count_frames"]);
		const streams = probe.json?.streams ?? [];
		const videoStreams = streams.filter((stream) => stream.codec_type === "video");
		const format = probe.json?.format ?? {};
		const duration = Number(format.duration ?? 0);
		const nbFrames = Number(videoStreams[0]?.nb_read_frames ?? -1);
		gates.gate(
			"progress/one-video-1280x720",
			videoStreams.length === 1 &&
				videoStreams[0].width === WIDTH &&
				videoStreams[0].height === HEIGHT,
			`video streams ${videoStreams.length}, ${videoStreams[0]?.width ?? "?"}x${videoStreams[0]?.height ?? "?"} (${videoStreams[0]?.codec_name ?? "?"}); audio ${streams.filter((s) => s.codec_type === "audio").length} (silent AAC — includeAudio defaulted ON on an audioless project, the honest outcome)`,
		);
		gates.gate(
			"progress/duration-matches",
			seed.expectedSec !== null && Math.abs(duration - seed.expectedSec) <= 0.3,
			`ffprobe ${duration}s vs expected ${seed.expectedSec?.toFixed(4)}s (263 frames / 30fps; brief's "≈9.98s" assumed ~240 frames — superseded by the generator formula, see header)`,
		);
		gates.gate(
			"progress/frames-in-band",
			seed.totalFrames !== null && nbFrames >= seed.totalFrames - 5 && nbFrames <= seed.totalFrames + 5,
			`nb_read_frames ${nbFrames} in [${(seed.totalFrames ?? 0) - 5}, ${(seed.totalFrames ?? 0) + 5}]`,
		);
		const fingerprint = sha256File(outputPath);
		ev.line(
			`- completed-render reference fingerprint: ${fingerprint.sha256} / ${fingerprint.bytes} bytes (${outputName})`,
		);
		ev.code(
			JSON.stringify(
				{
					streams: streams.map((stream) => ({
						codec_type: stream.codec_type,
						codec_name: stream.codec_name,
						width: stream.width,
						height: stream.height,
						nb_read_frames: stream.nb_read_frames,
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
	}

	await closeLiveApp("progress-done");
	if (outcome.recordSettled?.phase === "completed" && !args.keep) {
		removeDir(exportsRoot);
		ev.line(`- exports root deleted after fingerprinting (disk discipline)`);
	} else {
		ev.line(
			`- exports root KEPT (${args.keep ? "--keep: the deliverable survives for eyeballing" : "leg failed: diagnosis"}): ${exportsRoot.replace(/\\/g, "/")}`,
		);
	}
}

// -- leg 2: cancel --------------------------------------------------------------------

async function phaseCancel() {
	ev.heading(`Leg 2 — CANCEL (dense-${DENSITY}): settles ≤15s, no leak, transients cleaned, idempotent`);
	const storeRoot = join(runDir, "store-cancel");
	const exportsRoot = join(runDir, "exports-cancel");
	const seed = seedProject(storeRoot, "d2-generate-cancel");

	const before = tasklistFfmpeg("d2-cancel-tasklist-before");
	const session = await launchOpenProject(storeRoot, exportsRoot, seed.projectId);
	ev.line(
		`- open-path save settled before Start: waited ${(session.openSaveSettled.waitedMs / 1000).toFixed(1)}s, thumbnail-save bump observed: ${session.openSaveSettled.sawBump ? "yes" : "no"}${session.openSaveSettled.stable ? "" : " (TIMEOUT — proceeded anyway)"}`,
	);
	await startExportFromPanel(session.page, { format: "mp4", quality: "high" });
	const cancelWaitLabel =
		args.cancelAtMin > 0 ? `accepted/total > ${args.cancelAtMin}` : "any accepted frame";
	ev.line(`- export started; waiting for rendering progress (${cancelWaitLabel}, DOM-or-record)`);

	const atCancel = await pollProgressDual(
		session.page,
		exportsRoot,
		args.cancelAtMin > 0
			? (sample) => sample.accepted / sample.total > args.cancelAtMin
			: (sample) => sample.accepted > 0,
		KILL_WINDOW_BUDGET_MS,
		cancelWaitLabel,
	);
	ev.line(
		`- cancelling at ${atCancel.accepted}/${atCancel.total} frames (${atCancel.source} source) after ${(atCancel.waitedMs / 1000).toFixed(1)}s`,
	);
	await session.page.locator('[data-testid="export-cancel"]').click();

	// Re-cancel idempotence probe: fire a second cancel as soon as the settle
	// window opens. If the affordance is already withdrawn (the panel swaps to
	// the settled view), that withdrawal IS the contract-level idempotence.
	await sleep(400);
	const secondClickLanded = await session.page
		.locator('[data-testid="export-cancel"]')
		.isVisible()
		.then((visible) => (visible ? session.page.locator('[data-testid="export-cancel"]').click().then(() => true) : false))
		.catch(() => false);
	ev.line(
		secondClickLanded
			? `- second cancel CLICKED while settling (double-fire through IPC — the manager's settled-job path must absorb it)`
			: `- second cancel NOT clickable (affordance withdrawn within 0.4s — contract-level idempotence)`,
	);

	const settleStart = Date.now();
	let settledPanel = null;
	let settledRecord = null;
	for (;;) {
		const dom = await readPanelOrDead(session.page).catch(() => ({ dead: true, sample: null }));
		if (dom.sample !== null) settledPanel = dom.sample;
		settledRecord = readJobRecord(exportsRoot) ?? settledRecord;
		const panelCancelled =
			settledPanel !== null && settledPanel.status.startsWith("Export cancelled");
		const recordCancelled = settledRecord?.phase === "cancelled";
		if (panelCancelled || recordCancelled) break;
		if (Date.now() - settleStart > CANCEL_SETTLE_TIMEOUT_MS) break;
		await sleep(250);
	}
	const settleMs = Date.now() - settleStart;
	gates.gate(
		"cancel/settled-within-15s",
		settledRecord?.phase === "cancelled" && settleMs <= CANCEL_SETTLE_TIMEOUT_MS,
		`record phase ${settledRecord?.phase ?? "?"}; panel "${settledPanel?.status ?? "?"}" after ${settleMs}ms`,
	);
	await screenshotPanel(
		session.page,
		session.app,
		join(args.outDir, "screenshots", "d2-cancel-settled.png"),
	).catch(() => {});

	const after = tasklistFfmpeg("d2-cancel-tasklist-after");
	gates.gate(
		"cancel/no-ffmpeg-left",
		after.count === 0,
		`tasklist ffmpeg.exe: ${before.count} before start, ${after.count} after settle (cancel fired mid-render, before any encoder spawn)`,
	);

	const jobsDir = join(exportsRoot, "jobs");
	const jobsListing = listDir(jobsDir) ?? [];
	const rootListing = (listDir(exportsRoot) ?? []).filter((name) => name !== "jobs");
	const transients = jobsListing.filter(
		(name) => !name.endsWith(".json") || name.includes(".tmp-"),
	);
	gates.gate(
		"cancel/only-record-kept",
		jobsListing.filter((name) => name.endsWith(".json")).length === 1 &&
			transients.length === 0 &&
			rootListing.length === 0,
		`jobs dir ${JSON.stringify(jobsListing)}; exports root files ${JSON.stringify(rootListing)}`,
	);
	const recordName = jobsListing.find((name) => name.endsWith(".json"));
	let record = null;
	if (recordName !== undefined) {
		try {
			record = JSON.parse(readFileSync(join(jobsDir, recordName), "utf8"));
		} catch (error) {
			record = { parseError: String(error) };
		}
	}
	gates.gate(
		"cancel/record-kept-cancelled",
		record?.phase === "cancelled",
		`record phase ${record?.phase ?? "none"}, acceptedFrames ${record?.acceptedFrames ?? "?"}`,
	);
	if (record !== null && record?.phase !== "cancelled") {
		ev.line(`- LEG RED — cancel settled as ${record?.phase ?? "?"} instead of cancelled`);
		dumpForensics(exportsRoot, session.mainOutput);
	}
	gates.gate(
		"cancel/re-cancel-idempotent",
		record?.phase === "cancelled" && record.error === null,
		secondClickLanded
			? `second click fired mid-settle; final record cancelled, error ${JSON.stringify(record?.error ?? null)} — absorbed`
			: `affordance withdrawn before a second click was possible; record cancelled, error ${JSON.stringify(record?.error ?? null)}`,
	);
	ev.line(`- jobs dir after cancel: ${JSON.stringify(jobsListing)}; exports root: ${JSON.stringify(rootListing)}`);
	ev.code(
		[
			`tasklist ffmpeg.exe before:`,
			before.stdout.trim(),
			``,
			`tasklist ffmpeg.exe after:`,
			after.stdout.trim(),
		].join("\n"),
	);

	await closeLiveApp("cancel-done");
	if (record?.phase === "cancelled") {
		removeDir(exportsRoot);
		ev.line(`- exports root deleted after the run (disk discipline)`);
	} else {
		ev.line(`- exports root KEPT for diagnosis (leg failed): ${exportsRoot.replace(/\\/g, "/")}`);
	}
}

// -- leg 3: recovery --------------------------------------------------------------------

async function phaseRecovery(iteration) {
	const tag = `recovery-${iteration + 1}`;
	ev.heading(`Leg 3 — RECOVERY run ${iteration + 1} (dense-${DENSITY}): kill mid-render, restart, resume, verify`);
	const storeRoot = join(runDir, `store-${tag}`);
	const exportsRoot = join(runDir, `exports-${tag}`);
	const seed = seedProject(storeRoot, `d2-generate-${tag}`);

	const session = await launchOpenProject(storeRoot, exportsRoot, seed.projectId);
	ev.line(
		`- open-path save settled before Start: waited ${(session.openSaveSettled.waitedMs / 1000).toFixed(1)}s, thumbnail-save bump observed: ${session.openSaveSettled.sawBump ? "yes" : "no"}${session.openSaveSettled.stable ? "" : " (TIMEOUT — proceeded anyway)"}`,
	);
	await startExportFromPanel(session.page, { format: "mp4", quality: "high" });
	ev.line(`- export started; waiting for rendering progress in (${args.killAtMin}, ${args.killAtMax}) (DOM-or-record)`);

	const atKill = await pollProgressDual(
		session.page,
		exportsRoot,
		(sample) =>
			sample.accepted / sample.total > args.killAtMin &&
			sample.accepted / sample.total < args.killAtMax,
		KILL_WINDOW_BUDGET_MS,
		`accepted/total in (${args.killAtMin}, ${args.killAtMax})`,
	);
	const totalFrames = atKill.total;
	ev.line(
		`- kill window reached: ${atKill.accepted}/${totalFrames} frames (${atKill.source} source) after ${(atKill.waitedMs / 1000).toFixed(1)}s`,
	);

	const windowsAtKill = session.app.windows().length;
	const mainPid = session.app.process().pid;
	liveApp = null; // the tree dies with taskkill; no close() attempt after
	const kill = cmd(`d2-${tag}-taskkill`, "taskkill", ["/F", "/T", "/PID", String(mainPid)]);
	gates.gate(
		`${tag}/killed-tree`,
		kill.ok,
		`taskkill /F /T /PID ${mainPid} exit ${kill.code} (windows at kill: ${windowsAtKill})`,
	);
	await session.app.close().catch(() => {});

	// The record at rest: authoritative acceptedFrames for the raw-size math.
	await sleep(1_500);
	const recordAtRest = readJobRecord(exportsRoot);
	const acceptedAtRest = recordAtRest?.acceptedFrames ?? null;
	ev.line(
		`- record at rest after kill: phase ${recordAtRest?.phase ?? "unreadable"}, acceptedFrames ${acceptedAtRest ?? "?"} (the boot scan is what interrupts it)`,
	);
	const jobsDir = join(exportsRoot, "jobs");
	const jobsListing = listDir(jobsDir) ?? [];
	const rawName = jobsListing.find((name) => name.endsWith(".raw"));
	const rawSize = rawName === undefined ? null : fileSize(join(jobsDir, rawName));
	const expectedBytes = (acceptedAtRest ?? 0) * FRAME_BYTES;
	const withinBand =
		rawSize !== null &&
		acceptedAtRest !== null &&
		Math.abs(rawSize - expectedBytes) <= expectedBytes * 0.1;
	gates.gate(
		`${tag}/raw-size-sanity`,
		rawName !== undefined && withinBand,
		`raw ${rawName ?? "MISSING"} size ${rawSize ?? "?"} vs ${acceptedAtRest} frames x ${FRAME_BYTES} = ${expectedBytes} (±10% band)`,
	);
	ev.line(`- jobs dir at rest: ${JSON.stringify(jobsListing)}`);

	// Restart with the SAME roots. (Record already carries the thumbnail from
	// the first open, so no new open-path save is expected — the settle wait
	// confirms that rather than assuming it.)
	const relaunched = await launchOpenProject(storeRoot, exportsRoot, seed.projectId);
	ev.line(
		`- relaunched with the same store + exports roots; open-path save settled: waited ${(relaunched.openSaveSettled.waitedMs / 1000).toFixed(1)}s, thumbnail-save bump observed: ${relaunched.openSaveSettled.sawBump ? "yes" : "no"}${relaunched.openSaveSettled.stable ? "" : " (TIMEOUT — proceeded anyway)"}`,
	);
	const interruptedPanel = await readPanelOrDead(relaunched.page);
	gates.gate(
		`${tag}/interrupted-listed`,
		(interruptedPanel.sample?.interrupted ?? 0) >= 1 &&
			(interruptedPanel.sample?.hasResume ?? false),
		`panel lists ${interruptedPanel.sample?.interrupted ?? 0} interrupted job(s), resume affordance ${interruptedPanel.sample?.hasResume}`,
	);
	await screenshotPanel(
		relaunched.page,
		relaunched.app,
		join(args.outDir, "screenshots", `d2-${tag}-interrupted-panel.png`),
	).catch(() => {});
	ev.line(
		`- interrupted panel text: ${JSON.stringify(interruptedPanel.sample?.rawText?.slice(0, 200) ?? "(page dead)")}`,
	);

	await relaunched.page.locator('[data-testid="export-resume"]').first().click();

	if (args.resumeMode === "continuity") {
		// Lead's endgame ruling (2026-08-16): completion equivalence is proven
		// at unit level (mutation-verified resume semantics); this leg only
		// proves the REAL app rediscovers the interrupted job and resumes FROM
		// the persisted frame count — frame-exact continuation, no full render.
		ev.line(`- resume clicked; CONTINUITY MODE — asserting acceptedFrames climbs from the persisted ${acceptedAtRest} (never resets), not awaiting completion (budget ${RESUME_BUDGET_MS / 1000}s)`);
		const continuityStart = Date.now();
		let observedMin = Number.POSITIVE_INFINITY;
		let confirmedAt = null;
		let droppedBelow = false;
		let failedError = null;
		for (;;) {
			const record = readJobRecord(exportsRoot);
			if (record !== null && record.acceptedFrames !== null) {
				observedMin = Math.min(observedMin, record.acceptedFrames);
				if (record.acceptedFrames < (acceptedAtRest ?? 0)) droppedBelow = true;
				if (record.acceptedFrames >= (acceptedAtRest ?? 0) + 3) {
					confirmedAt = record.acceptedFrames;
					break;
				}
				if (record.phase === "failed") {
					failedError = record.error ?? "(no error field)";
					break;
				}
			}
			if (Date.now() - continuityStart > RESUME_BUDGET_MS) break;
			await sleep(1_000);
		}
		const continuitySeconds = (Date.now() - continuityStart) / 1000;
		if (failedError !== null) {
			ev.line(`- LEG RED — resumed job failed: ${JSON.stringify(failedError)}`);
			dumpForensics(exportsRoot, relaunched.mainOutput);
		}
		gates.gate(
			`${tag}/resume-continues-from-persisted`,
			confirmedAt !== null && !droppedBelow && failedError === null,
			`record climbed ${acceptedAtRest} -> ${confirmedAt ?? "UNCONFIRMED"} in ${continuitySeconds.toFixed(1)}s; minimum observed ${observedMin === Number.POSITIVE_INFINITY ? "?" : observedMin}${droppedBelow ? " — DROPPED BELOW persisted count (reset!)" : ""}${failedError !== null ? `; failed: ${JSON.stringify(failedError)}` : ""}`,
		);
		await screenshotPanel(
			relaunched.page,
			relaunched.app,
			join(args.outDir, "screenshots", `d2-${tag}-continuity.png`),
		).catch(() => {});
		await closeLiveApp(`${tag}-continuity-done`);
		if (confirmedAt !== null && !droppedBelow && failedError === null) {
			removeDir(exportsRoot);
			ev.line(`- exports root deleted after continuity confirmation (disk discipline)`);
		} else {
			ev.line(`- exports root KEPT for diagnosis (leg failed): ${exportsRoot.replace(/\\/g, "/")}`);
		}
		return;
	}

	ev.line(`- resume clicked; awaiting completion (budget ${RESUME_BUDGET_MS / 1000}s, dual-source)`);
	const resumeStarted = Date.now();
	const outcome = await sampleDualUntilSettled(
		relaunched.page,
		relaunched.app,
		exportsRoot,
		{ intervalMs: 500, timeoutMs: RESUME_BUDGET_MS },
	);
	const resumeSeconds = (Date.now() - resumeStarted) / 1000;
	gates.gate(
		`${tag}/resume-completed`,
		outcome.recordSettled?.phase === "completed",
		`record phase ${outcome.recordSettled?.phase ?? "UNSETTLED (timeout)"} after ${resumeSeconds.toFixed(1)}s; DOM ${outcome.domDead ? "died" : `settled "${outcome.domSettled?.status ?? "?"}"`}`,
	);
	gates.gate(
		`${tag}/resume-frames-complete`,
		outcome.recordSettled !== null &&
			outcome.recordSettled.acceptedFrames === totalFrames &&
			outcome.recordSettled.totalFrames === totalFrames,
		`record frames ${outcome.recordSettled?.acceptedFrames ?? "?"}/${outcome.recordSettled?.totalFrames ?? "?"} (kill point was ${atKill.accepted}/${totalFrames}; resume replayed the prefix and finished the tail)`,
	);
	notePageDeath(outcome, relaunched.consoleErrors);
	if (outcome.recordSettled?.phase !== "completed") {
		ev.line(
			`- LEG RED — resume settled as ${outcome.recordSettled?.phase ?? "UNSETTLED (timeout)"}${outcome.recordSettled?.error ? ` error: ${JSON.stringify(outcome.recordSettled.error)}` : ""}`,
		);
		dumpForensics(exportsRoot, relaunched.mainOutput);
	}

	let windowsAfter = null;
	try {
		windowsAfter = relaunched.app.windows().length;
		for (let attempt = 0; attempt < 20 && windowsAfter > 1; attempt += 1) {
			await sleep(500);
			windowsAfter = relaunched.app.windows().length;
		}
	} catch (error) {
		windowsAfter = `unobservable (${String(error?.message ?? error)})`;
	}
	gates.gate(
		`${tag}/producer-window-closed`,
		windowsAfter === 1,
		`windows after settle: ${windowsAfter} (2 during, ${windowsAtKill} at kill)`,
	);

	const outputName = outcome.recordSettled?.outputName ?? "";
	const outputPath = join(exportsRoot, outputName);
	gates.gate(`${tag}/output-exists`, outputName !== "" && existsSync(outputPath), outputName);
	if (existsSync(outputPath)) {
		const probe = ffprobeJson(`d2-${tag}-ffprobe`, outputPath, ["-count_frames"]);
		const streams = probe.json?.streams ?? [];
		const videoStreams = streams.filter((stream) => stream.codec_type === "video");
		const format = probe.json?.format ?? {};
		const duration = Number(format.duration ?? 0);
		const nbFrames = Number(videoStreams[0]?.nb_read_frames ?? -1);
		gates.gate(
			`${tag}/one-video-1280x720`,
			videoStreams.length === 1 &&
				videoStreams[0].width === WIDTH &&
				videoStreams[0].height === HEIGHT,
			`video streams ${videoStreams.length}, ${videoStreams[0]?.width ?? "?"}x${videoStreams[0]?.height ?? "?"} (${videoStreams[0]?.codec_name ?? "?"}); audio ${streams.filter((s) => s.codec_type === "audio").length}`,
		);
		gates.gate(
			`${tag}/duration-matches`,
			seed.expectedSec !== null && Math.abs(duration - seed.expectedSec) <= 0.3,
			`ffprobe ${duration}s vs expected ${seed.expectedSec?.toFixed(4)}s`,
		);
		gates.gate(
			`${tag}/frames-in-band`,
			seed.totalFrames !== null &&
				nbFrames >= seed.totalFrames - 5 &&
				nbFrames <= seed.totalFrames + 5,
			`nb_read_frames ${nbFrames} in [${(seed.totalFrames ?? 0) - 5}, ${(seed.totalFrames ?? 0) + 5}]`,
		);
		const fingerprint = sha256File(outputPath);
		ev.line(`- output fingerprint: ${fingerprint.sha256} / ${fingerprint.bytes} bytes`);
		ev.code(
			JSON.stringify(
				{
					streams: streams.map((stream) => ({
						codec_type: stream.codec_type,
						codec_name: stream.codec_name,
						width: stream.width,
						height: stream.height,
						nb_read_frames: stream.nb_read_frames,
						duration: stream.duration,
					})),
					format: {
						format_name: format.format_name,
						duration: format.duration,
						size: format.size,
					},
					resumeSeconds: Number(resumeSeconds.toFixed(1)),
					killPoint: `${atKill.accepted}/${totalFrames}`,
					acceptedAtRest: acceptedAtRest,
				},
				null,
				1,
			),
		);
	}
	ev.line(`- resume DOM series:`);
	ev.code(
		seriesLines(
			outcome.domSeries,
			(entry) =>
				`T+${String(entry.t).padStart(8)}s  ${entry.status}  ${entry.progress >= 0 ? entry.progress + "%" : ""}${entry.accepted !== null ? ` (${entry.accepted}/${entry.total})` : ""}`,
		),
	);
	ev.line(`- resume record-file series:`);
	ev.code(
		seriesLines(
			outcome.recordSeries,
			(entry) =>
				`T+${String(entry.t).padStart(8)}s  ${entry.phase}  ${(entry.progress * 100).toFixed(0)}%${entry.accepted !== null ? ` (${entry.accepted}/${entry.total ?? "?"})` : ""}`,
		),
	);

	const jobsAfterResume = listDir(join(exportsRoot, "jobs")) ?? [];
	ev.line(
		`- jobs dir after resume-settle: ${JSON.stringify(jobsAfterResume)} (record kept; raw/wav/partial transients cleaned by the manager)`,
	);

	await closeLiveApp(`${tag}-done`);
	if (outcome.recordSettled?.phase === "completed") {
		removeDir(exportsRoot);
		ev.line(`- exports root deleted after fingerprinting (disk discipline)`);
	} else {
		ev.line(`- exports root KEPT for diagnosis (leg failed): ${exportsRoot.replace(/\\/g, "/")}`);
	}
}

// -- rate probe (tiered-density legs: measure, then budget) --------------------------------

/**
 * Console-only rate probe (lead ruling 2026-08-16): the cancel/recovery legs
 * run at a smaller density than the progress leg, and their budgets come from
 * THIS measurement (measured s/frame x totalFrames x 1.5 + boot allowances),
 * not from the dense-800 ceilings. Seeds at --clips, starts one export,
 * samples the job record until --probe-frames frames are accepted, prints the
 * rate plus ready-to-paste budget flags, closes the app. Writes NO evidence
 * section — the measured numbers land in the final document by hand.
 */
async function phaseProbeRate() {
	const storeRoot = join(runDir, "store-probe");
	const exportsRoot = join(runDir, "exports-probe");
	const seed = seedProject(storeRoot, "d2-generate-probe");
	const session = await launchOpenProject(storeRoot, exportsRoot, seed.projectId);
	console.log(
		`probe: open-save-settled waited=${(session.openSaveSettled.waitedMs / 1000).toFixed(1)}s sawThumbnailSaveBump=${session.openSaveSettled.sawBump} finalUpdatedAt=${session.openSaveSettled.finalUpdatedAt}`,
	);
	await startExportFromPanel(session.page, { format: "mp4", quality: "high" });
	console.log(`probe: export started; sampling the job record until ${args.probeFrames} frames accepted`);
	const startedMs = Date.now();
	let firstFrame = null;
	let lastFrame = null;
	let totalFrames = null;
	let failedEarly = null;
	let completedOutput = null;
	for (;;) {
		const record = readJobRecord(exportsRoot);
		if (record !== null) {
			if (record.totalFrames !== null) totalFrames = record.totalFrames;
			if (firstFrame === null && (record.acceptedFrames ?? 0) > 0) {
				firstFrame = { at: Date.now(), accepted: record.acceptedFrames };
			}
			if (firstFrame !== null && record.acceptedFrames !== null) {
				lastFrame = { at: Date.now(), accepted: record.acceptedFrames };
			}
			if (record.phase === "failed") {
				failedEarly = record.error ?? "(no error field)";
				break;
			}
			if (record.phase === "completed") {
				// The GPU comparison leg keeps its deliverable for the user to
				// eyeball — wait the encode out and report the output. Pass
				// --probe-frames >= totalFrames so only this break can fire.
				completedOutput = {
					name: record.outputName,
					bytes: record.outputBytes,
					accepted: record.acceptedFrames,
				};
				break;
			}
		}
		if (lastFrame !== null && lastFrame.accepted >= args.probeFrames) break;
		if (Date.now() - startedMs > KILL_WINDOW_BUDGET_MS) {
			failedEarly = `TIMEOUT after ${((Date.now() - startedMs) / 1000).toFixed(0)}s (last accepted ${lastFrame?.accepted ?? 0})`;
			break;
		}
		await sleep(2_000);
	}
	await closeLiveApp("probe-done");
	if (completedOutput !== null) {
		console.log(
			`probe: COMPLETED — output ${completedOutput.name} (${completedOutput.bytes} bytes, ${completedOutput.accepted} frames); run with --keep to preserve the exports root for salvage`,
		);
	}

	if (failedEarly !== null) {
		console.error(`probe: FAILED — ${failedEarly}`);
		gates.gate("probe/rate-measured", false, failedEarly);
		return;
	}
	const frames = lastFrame.accepted - firstFrame.accepted;
	const seconds = (lastFrame.at - firstFrame.at) / 1000;
	const rate = frames > 0 && seconds > 0 ? seconds / frames : null;
	gates.gate(
		"probe/rate-measured",
		rate !== null && totalFrames !== null,
		`${rate === null ? "?" : rate.toFixed(2)} s/frame over ${frames} frames in ${seconds.toFixed(1)}s; totalFrames ${totalFrames ?? "?"}`,
	);
	if (rate === null || totalFrames === null) return;
	const renderMs = rate * totalFrames * 1000;
	const bootAllowanceMs = 240_000; // app boot + open-save settle + producer boot + encoding tail
	console.log(`probe: rate=${rate.toFixed(2)}s/frame over ${frames} frames (${seconds.toFixed(1)}s); totalFrames=${totalFrames}; full render projected ${(renderMs / 60000).toFixed(1)}min`);
	console.log(`probe: suggested flags (measured x1.5 + boot allowances):`);
	console.log(
		`  --full-budget-ms ${Math.round(renderMs * 1.5 + bootAllowanceMs)} --resume-budget-ms ${Math.round(renderMs * 1.5 + bootAllowanceMs)} --kill-window-budget-ms ${Math.round(renderMs * args.killAtMax * 1.5 + bootAllowanceMs + 120_000)}`,
	);
}

// -- leg 4: stray-process sweep -----------------------------------------------------------

async function phaseSweep() {
	ev.heading(`Step 4 — SWEEP: no ${WORKTREE_FRAGMENT} electron/ffmpeg processes remain`);
	// A just-closed app needs a beat before its processes are reaped.
	await sleep(1_500);
	const tasklistElectron = tasklistImage("d2-sweep-tasklist-electron", "electron.exe");
	const tasklistFfmpegNow = tasklistFfmpeg("d2-sweep-tasklist-ffmpeg");
	const sweep = strayProcessSweep("d2-sweep-cim", WORKTREE_FRAGMENT);
	ev.line(
		`- tasklist electron.exe count ${tasklistElectron.count}, ffmpeg.exe count ${tasklistFfmpegNow.count}; CIM command-line matches for "${WORKTREE_FRAGMENT}": ${sweep.count}`,
	);
	ev.code(sweep.rows.length > 0 ? JSON.stringify(sweep.rows, null, 1) : "(none)");
	if (sweep.count > 0) {
		const pids = sweep.rows.map((row) => row.ProcessId);
		const killed = killStrayPids("d2-sweep-kill", pids);
		ev.line(`- killed strays MY runs left (only these): ${JSON.stringify(pids)} (exit ${killed.code})`);
		const recheck = strayProcessSweep("d2-sweep-cim-recheck", WORKTREE_FRAGMENT);
		gates.gate(
			"sweep/no-strays-after-kill",
			recheck.count === 0,
			`after killing ${pids.length}: ${recheck.count} remain`,
		);
	} else {
		gates.gate("sweep/no-strays", true, "none found — nothing to kill");
	}
	gates.gate(
		"sweep/no-ffmpeg-anywhere",
		tasklistFfmpegNow.count === 0,
		`tasklist ffmpeg.exe count ${tasklistFfmpegNow.count} (whole machine; any nonzero row would be named before action)`,
	);
	ev.code(
		[
			`tasklist electron.exe:`,
			tasklistElectron.stdout.trim(),
			``,
			`tasklist ffmpeg.exe:`,
			tasklistFfmpegNow.stdout.trim(),
		].join("\n"),
	);
}

// -- main -------------------------------------------------------------------------------

async function runPhase(name) {
	if (name === "progress") await phaseProgress();
	else if (name === "cancel") await phaseCancel();
	else if (name === "probe-rate") await phaseProbeRate();
	else if (name === "recovery") {
		for (let iteration = 0; iteration < args.recoveryRuns; iteration += 1) {
			await phaseRecovery(iteration);
		}
	} else if (name === "sweep") await phaseSweep();
	else throw new Error(`unknown phase ${name}`);
}

async function main() {
	ev.line(`# D2 v2 — export lifecycle proofs at dense-${DENSITY} (progress / cancel / recovery / sweep)`);
	ev.line("");
	ev.line(`Run: ${new Date().toISOString()}`);
	ev.line(`Worktree: ${worktreeRoot.replace(/\\/g, "/")} (built dist + dist-main; no rebuild in this proof)`);
	ev.line(`Command: node apps/electron-host/scripts/export-lifecycle-proof.mjs --phase ${args.phase} --recovery-runs ${args.recoveryRuns} --clips ${args.clips}${args.append ? " --append" : ""}`);
	ev.line(`Scratch run dir: ${runDir.replace(/\\/g, "/")} (fresh per invocation; deleted after fingerprinting unless --keep)`);
	ev.line(`Seed (exactly as briefed): generate-clip-project.mjs --clips ${DENSITY} --name "${PROJECT_NAME}" --layout dense --width 1280 --height 720`);
	ev.line(`Frame math: dense N clips -> (ceil(N/16)-1)*1920+960000 ticks; producer floors /4000 -> ${DENSITY === "800" ? "263 frames = 8.7667s" : "see generator output below"} (brief's "≈240 frames/≈10s" superseded by the formula; seed command unchanged)`);
	ev.line(`Hard rules in force: ONE app instance at a time (phase-per-process, app closed between); NO playback in the interactive window (crash trigger surface); scratch only under ${SCRATCH_BASE}`);
	ev.line("");
	ev.line(`## Launch environment`);
	ev.code(
		[
			"SYSTEMROOT=<windows>",
			"OPENCUT_STORE_ROOT=<per-leg scratch store>",
			"OPENCUT_EXPORT_ROOT=<per-leg scratch exports>",
			"OPENCUT_FFMPEG_PATH=" + FFMPEG,
		].join("\n"),
	);
	ev.line(`(Playwright layers the Windows essentials; explicit keys win — see D1's probe note. Progress sampled from BOTH the panel DOM and the job record file <exportsRoot>/jobs/<jobId>.json — the manager persists phase+frames after every transition.)`);

	await runPhase(args.phase === "all" ? "progress" : args.phase);
	if (args.phase === "all") {
		await runPhase("cancel");
		await runPhase("recovery");
	}
	await runPhase("sweep");

	ev.heading(`Gates (invocation: ${args.phase})`);
	for (const entry of gates.all()) {
		ev.line(`- ${entry.ok ? "PASS" : "FAIL"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
	}
	// probe-rate is console-only: its measured numbers are folded into the
	// final document by hand, so no evidence section is appended here.
	if (args.phase !== "probe-rate") {
		const file = await ev.flush("d2-lifecycle-proofs.md", { append: args.append });
		console.log(`evidence written: ${file} (append=${args.append})`);
	}

	if (gates.failures().length > 0) {
		console.error(`D2 LIFECYCLE PROOF FAILED (${gates.failures().length} gate(s))`);
		console.error(`scratch kept for diagnosis: ${runDir}`);
		process.exit(1);
	}
	if (!args.keep) {
		removeDir(runDir);
		console.log(`scratch run dir deleted: ${runDir}`);
	}
	console.log("D2 LIFECYCLE PROOF PASSED");
	process.exit(0);
}

main().catch(async (error) => {
	console.error("D2 LIFECYCLE PROOF FAILED:", error?.stack ?? error);
	ev.heading("Aborted");
	ev.line(`Fatal: ${String(error?.stack ?? error)}`);
	for (const entry of gates.all()) {
		ev.line(`- ${entry.ok ? "PASS" : "FAIL"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
	}
	if (args.phase !== "probe-rate") {
		await ev.flush("d2-lifecycle-proofs.md", { append: args.append }).catch(() => {});
	}
	await closeLiveApp("abort").catch(() => {});
	console.error(`scratch kept for diagnosis: ${runDir}`);
	process.exit(1);
});
