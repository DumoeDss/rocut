#!/usr/bin/env node
/**
 * sdk-export-capability (E2) — the export/performance baseline harness.
 *
 * Spec: rasen/changes/sdk-export-capability/specs/export-performance-baseline/
 * One repeatable command over a deterministic clip-heavy project: generates
 * the 2000-clip dense 720p project through E1's generator (real store
 * classes, fresh throwaway root), boots the built Electron host against that
 * root under swiftshader, and records the four metric families — cold open,
 * interaction latency, playback fps, export wall time split by phase — plus
 * memory (renderer heap + main RSS) and the raw-stream peak. The artifact
 * this script writes is the deliverable: every number carries its
 * measurement point and method, the "vs S08 expectation" column states each
 * metric's standing without any pass/fail claim (the 2000-clip gate is S08's
 * to set), and re-runs start from fresh scratch roots that the script itself
 * removes on exit unless --keep is passed.
 *
 * CLI:
 *   node apps/electron-host/scripts/export-perf-baseline.mjs \
 *     [--runs 2] [--out <md path>] [--keep]
 *
 * Method notes that shape the numbers (all restated in the artifact):
 * - Project shape: `--layout dense` — every frame composites all 2000
 *   elements over a ~10s timeline (300 frames @ 30fps), the per-frame render
 *   stress shape whose raw export stream (~830 MB @ 720p) fits the E: disk.
 *   `staggered` (the long sparse timeline-UI stress shape) is the S08
 *   follow-up, not measured here.
 * - Cold open is measured on the harness's monotonic clock from before
 *   `electron.launch()` to "editor interactive", defined concretely as all
 *   of: export-panel present, main-track select button present, and all
 *   2000 timeline element nodes mounted.
 * - Interaction latencies and export phase splits are computed on the
 *   renderer's own performance.now() clock (in-page capture listener for the
 *   event timestamp, MutationObserver for the effect timestamp) so CDP
 *   round-trips never pollute the deltas.
 * - Export progress polling is 250 ms from the driver for the progress
 *   series; phase boundaries use the in-page status-text observer, so phase
 *   deltas are not poll-quantized.
 * - No main-side instrumentation is added: every renderer-side number comes
 *   from the DOM the app already renders.
 *
 * Exit codes: 0 = every run completed with all metric families measured;
 * 1 = a run failed (artifact still written with whatever was measured).
 * Every step logs REAL_EXIT_CODE[<step>]:<code>.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..");
const REPO_ROOT = resolve(APP_ROOT, "..", "..");
const EVIDENCE_DIR = join(
	REPO_ROOT,
	"rasen",
	"changes",
	"sdk-export-capability",
	"evidence",
);
const DEFAULT_OUT = join(EVIDENCE_DIR, "perf-baseline-20260816.md");
const GENERATOR = join(APP_ROOT, "scripts", "generate-clip-project.mjs");
const MAIN_PATH = join(APP_ROOT, "electron", "main.cjs");
const SCRATCH_BASE =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch";
const FFMPEG_PATH = "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe";

const CLIPS = 2000;
const PROJECT_NAME = "Perf 2000 Dense";
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const COLD_OPEN_TIMEOUT_MS = 300_000;
const EXPORT_TIMEOUT_MS = 900_000;
const POLL_MS = 250;

/**
 * The launch env is a documented minimal allowlist, not process.env spread:
 * three OPENCUT_* overrides plus the Windows basics Electron/Chromium and
 * the ffmpeg child need. The artifact records exactly which keys crossed.
 */
const ENV_ALLOWLIST = new Set([
	"SYSTEMROOT",
	"SYSTEMDRIVE",
	"WINDIR",
	"TEMP",
	"TMP",
	"COMSPEC",
	"PATHEXT",
	"PATH",
	"APPDATA",
	"LOCALAPPDATA",
	"USERPROFILE",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"COMMONPROGRAMFILES",
	"NUMBER_OF_PROCESSORS",
	"PROCESSOR_ARCHITECTURE",
	"PROCESSOR_IDENTIFIER",
	"OS",
	"HOMEDRIVE",
	"HOMEPATH",
]);

function parseArgs(argv) {
	const args = { runs: 2, out: DEFAULT_OUT, keep: false };
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		if (flag === "--runs") {
			i += 1;
			const value = Number.parseInt(argv[i] ?? "", 10);
			if (!Number.isInteger(value) || value < 1 || value > 10) {
				throw new Error(`--runs must be an integer in [1, 10], got ${argv[i]}`);
			}
			args.runs = value;
		} else if (flag === "--out") {
			i += 1;
			if (argv[i] === undefined) throw new Error("--out needs a path");
			args.out = resolve(argv[i]);
		} else if (flag === "--keep") {
			args.keep = true;
		} else {
			throw new Error(`unknown argument: ${flag}`);
		}
	}
	return args;
}

function log(line) {
	console.log(line);
}

function logStepCode(step, code) {
	log(`REAL_EXIT_CODE[${step}]:${code}`);
}

async function step(name, fn) {
	try {
		const result = await fn();
		logStepCode(name, 0);
		return result;
	} catch (error) {
		logStepCode(name, 1);
		throw error;
	}
}

function sleep(ms) {
	return new Promise((resolve_) => {
		setTimeout(resolve_, ms);
	});
}

function fmtMs(ms) {
	if (ms === null || ms === undefined || Number.isNaN(ms)) return "n/a";
	if (ms >= 10_000) return `${(ms / 1000).toFixed(2)} s`;
	return `${ms.toFixed(0)} ms`;
}

function fmtBytes(bytes) {
	if (bytes === null || bytes === undefined) return "n/a";
	if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}

async function safeRm(path) {
	const resolved = resolve(path);
	if (!resolved.startsWith(resolve(SCRATCH_BASE))) {
		throw new Error(`refusing to remove outside scratch base: ${resolved}`);
	}
	// Windows: a just-closed Electron process can hold directory handles for
	// a beat — a few short retries instead of failing the run on EBUSY/EPERM.
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			rmSync(resolved, { recursive: true, force: true });
			return;
		} catch (error) {
			if (attempt === 4) throw error;
			await sleep(500);
		}
	}
}

function buildLaunchEnv(storeRoot, exportsRoot) {
	const env = {};
	const passed = [];
	for (const [key, value] of Object.entries(process.env)) {
		if (ENV_ALLOWLIST.has(key.toUpperCase())) {
			env[key] = value;
			passed.push(key);
		}
	}
	env.OPENCUT_STORE_ROOT = storeRoot;
	env.OPENCUT_EXPORT_ROOT = exportsRoot;
	env.OPENCUT_FFMPEG_PATH = FFMPEG_PATH;
	return { env, passedKeys: [...passed, "OPENCUT_STORE_ROOT", "OPENCUT_EXPORT_ROOT", "OPENCUT_FFMPEG_PATH"].sort() };
}

function gatherFacts() {
	const cpus = os.cpus();
	const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" });
	let playwrightVersion = "unknown";
	try {
		const requireFromApp = createRequire(join(APP_ROOT, "package.json"));
		playwrightVersion = requireFromApp("@playwright/test/package.json").version;
	} catch {}
	let electronVersion = "unknown";
	try {
		electronVersion = requireFromApp("electron/package.json").version;
	} catch {}
	let ffmpegVersion = "unknown";
	try {
		ffmpegVersion = (spawnSync(FFMPEG_PATH, ["-version"], { encoding: "utf8" }).stdout ?? "")
			.split("\n")[0]
			.trim();
	} catch {}
	let diskFree = null;
	try {
		diskFree = statfsSync(SCRATCH_BASE).bavail * statfsSync(SCRATCH_BASE).bsize;
	} catch {}
	const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
	return {
		cpuModel: cpus[0]?.model ?? "unknown",
		cpuCount: cpus.length,
		totalMem: os.totalmem(),
		platform: `${os.platform()} ${os.release()} (${os.arch()})`,
		nodeVersion: process.version,
		bunVersion: bunVersion.status === 0 ? (bunVersion.stdout ?? "").trim() : "not on PATH",
		playwrightVersion,
		electronVersion: electronVersion !== "unknown" ? electronVersion : (pkg.devDependencies?.electron ?? "unknown"),
		ffmpegVersion,
		diskFree,
		hostPackageVersion: pkg.version,
	};
}

/** Run E1's generator as a child; parse project id + the METHOD block. */
function runGenerator(stepName, storeRoot) {
	const result = spawnSync(
		process.execPath,
		[
			GENERATOR,
			"--root", storeRoot,
			"--clips", String(CLIPS),
			"--name", PROJECT_NAME,
			"--layout", "dense",
			"--width", String(CANVAS_WIDTH),
			"--height", String(CANVAS_HEIGHT),
			"--self-log",
		],
		{ encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
	);
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	log(stdout.trim());
	if (stderr.trim()) log(`[generator stderr] ${stderr.trim()}`);
	const selfCode = /REAL_EXIT_CODE:(\d+)/.exec(stdout);
	const code = result.status ?? (selfCode ? Number.parseInt(selfCode[1], 10) : 1);
	if (code !== 0) {
		throw new Error(`generator exited ${code} (see log above)`);
	}
	const projectId = /PROJECT id: (\S+)/.exec(stdout)?.[1];
	if (projectId === undefined) throw new Error("could not parse PROJECT id from generator stdout");
	const methodLines = [];
	let inMethod = false;
	for (const line of stdout.split(/\r?\n/)) {
		if (line.trim() === "--- METHOD ---") {
			inMethod = true;
			continue;
		}
		if (line.trim() === "--- /METHOD ---") {
			inMethod = false;
			continue;
		}
		if (inMethod) methodLines.push(line);
	}
	if (methodLines.length === 0) throw new Error("could not parse METHOD block from generator stdout");
	return { projectId, methodBlock: methodLines.join("\n") };
}

/** In-page marker probe used by the cold-open loop. */
const COLD_PROBE = () => {
	const panel = document.querySelector('[data-testid="export-panel"]');
	const mainTrack = document.querySelector('button[aria-label="Select Main Track track"]');
	const timecode = document.querySelector('button[title="Click to edit time"]');
	const elements = document.querySelectorAll("div.absolute.top-0.select-none").length;
	const dialog = document.querySelector('[role="dialog"]');
	const dialogText =
		dialog && dialog.offsetParent !== null
			? (dialog.textContent || "").trim().slice(0, 100)
			: null;
	return {
		panel: panel !== null,
		mainTrack: mainTrack !== null,
		timecode: timecode !== null,
		elements,
		dialog: dialogText,
	};
};

/**
 * Interaction A setup — the timeline zoom-in toolbar button. The toolbar's
 * zoom buttons carry no testid or aria-label (app code, untouched), so the
 * driver locates them structurally: the two direct-child <button>s of the
 * group that contains the Radix slider ([role="slider"]). The zoom's DOM
 * effect is the inline width style on the tracks scroll content (zoom
 * rescales dynamicTimelineWidth); the observer timestamps the first style
 * mutation after the click.
 */
const ZOOM_SETUP = () => {
	const section = document.querySelector('section[aria-label="Timeline"]');
	if (!(section instanceof HTMLElement)) return { error: "timeline section not found" };
	const slider = section.querySelector('[role="slider"]');
	if (!(slider instanceof HTMLElement)) return { error: "toolbar slider not found" };
	// The slider's own parent is its Radix wrapper; the zoom buttons are the
	// first ancestor's direct-child <button> pair around it.
	let group = slider.parentElement;
	let buttons = [];
	while (group instanceof HTMLElement) {
		buttons = Array.from(group.querySelectorAll(":scope > button"));
		if (buttons.length >= 2) break;
		group = group.parentElement;
	}
	if (buttons.length < 2) return { error: "zoom buttons not found around the toolbar slider" };
	const zoomIn = buttons[buttons.length - 1];
	const content = section.querySelector("div.min-h-full");
	if (!(content instanceof HTMLElement)) return { error: "tracks content width div not found" };
	const rect = zoomIn.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return { error: "zoom-in button has no box (toolbar clipped?)" };
	window.__zoomObs = { ts: null, widthBefore: content.style.width, widthAfter: null };
	const obs = new MutationObserver(() => {
		if (window.__zoomObs.ts === null) {
			window.__zoomObs.ts = performance.now();
			window.__zoomObs.widthAfter = content.style.width;
		}
	});
	obs.observe(content, { attributes: true, attributeFilter: ["style"] });
	return {
		x: rect.x + rect.width / 2,
		y: rect.y + rect.height / 2,
		widthBefore: content.style.width,
		buttonRect: { w: rect.width, h: rect.height },
	};
};

/**
 * Interaction B setup — clicking a clip on the timeline selects it. The
 * point is the middle height of the first fully-visible populated track row
 * at 8% of its width. The dense layout overlaps elements WITHIN a track
 * (8 s durations starting 16 ms apart), so the element the app's own
 * hit-testing selects may be a visually buried sibling, not the topmost one
 * elementFromPoint returns — the observer therefore watches the whole chosen
 * ROW subtree and records which element container mutated. Selection
 * manifests as an inline boxShadow style on the element's inner div plus
 * resize-handle/keyframe child nodes appearing.
 */
const SELECT_SETUP = () => {
	const section = document.querySelector('section[aria-label="Timeline"]');
	if (!(section instanceof HTMLElement)) return { error: "timeline section not found" };
	const content = section.querySelector("div.min-h-full");
	if (!(content instanceof HTMLElement) || !(content.parentElement instanceof HTMLElement)) {
		return { error: "tracks scroll area not found" };
	}
	// The tracks scroll starts at the BOTTOM (useInitialScrollBottom), so the
	// first overlay track may be scrolled out of view: pick the first track
	// row that is fully inside the scroll viewport AND populated with
	// element containers.
	const viewport = content.parentElement.getBoundingClientRect();
	const rows = Array.from(content.querySelectorAll("div.absolute.right-0.left-0"));
	let chosenRow = null;
	for (const row of rows) {
		if (!(row instanceof HTMLElement)) continue;
		if (row.querySelector("div.absolute.top-0.select-none") === null) continue;
		const r = row.getBoundingClientRect();
		if (r.height <= 0) continue;
		if (r.top < viewport.top + 2 || r.bottom > viewport.bottom - 2) continue;
		chosenRow = row;
		break;
	}
	if (chosenRow === null) return { error: "no fully-visible populated track row found in the scroll viewport" };
	const rowRect = chosenRow.getBoundingClientRect();
	const x = rowRect.x + rowRect.width * 0.08;
	const y = rowRect.y + rowRect.height * 0.5;
	window.__selObs = { ts: null, kind: null, targetText: null };
	const textOf = (node) => {
		let cur = node instanceof Element ? node : node?.parentElement ?? null;
		while (cur instanceof Element) {
			if (cur.classList.contains("select-none") && cur.classList.contains("top-0")) {
				return (cur.textContent || "").trim().slice(0, 40);
			}
			cur = cur.parentElement;
		}
		return null;
	};
	const obs = new MutationObserver((records) => {
		if (window.__selObs.ts === null) {
			window.__selObs.ts = performance.now();
			window.__selObs.kind = records[0]?.type ?? "unknown";
			window.__selObs.targetText = textOf(records[0]?.target ?? null);
		}
	});
	obs.observe(chosenRow, {
		attributes: true,
		attributeFilter: ["style"],
		childList: true,
		subtree: true,
	});
	const hit = document.elementFromPoint(x, y);
	const topContainer = hit instanceof Element ? hit.closest("div.absolute.top-0.select-none") : null;
	return {
		x,
		y,
		trackRowTopInViewport: rowRect.top - viewport.top,
		topmostElementText: topContainer instanceof Element
			? (topContainer.textContent || "").trim().slice(0, 40)
			: null,
		rowElementCount: chosenRow.querySelectorAll("div.absolute.top-0.select-none").length,
	};
};

/** Click/wheel event capture — the honest in-page start markers. */
const INPUT_CAPTURE_INSTALL = () => {
	window.__probe = { clickTs: null, wheelTs: null };
	document.addEventListener(
		"click",
		(e) => {
			if (e.isTrusted) window.__probe.clickTs = performance.now();
		},
		{ capture: true },
	);
	document.addEventListener(
		"wheel",
		(e) => {
			if (e.isTrusted) window.__probe.wheelTs = performance.now();
		},
		{ capture: true },
	);
	return true;
};

/** rAF frame counter for the playback window (5 s of renderer frames). */
const RAF_INSTALL = () => {
	window.__raf = { count: 0, intervals: [], t0: null, tPrev: null, tEnd: null };
	const loop = (t) => {
		const s = window.__raf;
		if (s.t0 === null) {
			s.t0 = t;
			s.tPrev = t;
		}
		if (t - s.t0 < 5000) {
			s.count += 1;
			s.intervals.push(t - (s.tPrev ?? t));
			s.tPrev = t;
			requestAnimationFrame(loop);
		} else if (s.tEnd === null) {
			s.tEnd = t;
		}
	};
	requestAnimationFrame(loop);
	return true;
};

/** Focus inside the editor surface so the surface-root keydown listener
 * (space -> toggle-play, actions/definitions.ts) receives the key. */
const FOCUS_EDITOR = () => {
	const btn = document.querySelector('button[aria-label="Select Main Track track"]');
	if (btn instanceof HTMLElement) btn.focus();
	const active = document.activeElement;
	return {
		focused: active === btn,
		active: active ? active.tagName + ":" + (active.getAttribute("aria-label") ?? "") : "none",
	};
};

/** Export status observer: every distinct export-status text with an
 * in-page timestamp (phase boundaries come from these, not the 250 ms poll). */
const EXPORT_OBS_INSTALL = () => {
	window.__exportObs = { events: [] };
	const scan = () => {
		const p = document.querySelector('p[data-testid="export-status"]');
		const text = p ? (p.textContent || "").trim() : null;
		const events = window.__exportObs.events;
		if (text !== null && (events.length === 0 || events[events.length - 1].text !== text)) {
			events.push({ ts: performance.now(), text: text.slice(0, 80) });
		}
	};
	const obs = new MutationObserver(scan);
	obs.observe(document.body, { childList: true, subtree: true, characterData: true });
	scan();
	return true;
};

const EXPORT_SAMPLE = () => {
	const status = document.querySelector('p[data-testid="export-status"]');
	const prog = document.querySelector('div[data-testid="export-progress"]');
	const framesP = document.querySelector('div[data-testid="export-progress"] + p');
	return {
		status: status ? (status.textContent || "").trim() : null,
		percent: prog ? prog.getAttribute("aria-valuenow") : null,
		frames: framesP ? (framesP.textContent || "").trim() : null,
	};
};

const HEAP_SAMPLE = () => {
	const mem = performance.memory;
	return mem
		? { available: true, used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit }
		: { available: false, used: null, limit: null };
};

/** Poll the export job's raw stream size (driver-side fs, cheap). */
function rawMaxBytes(exportsRoot) {
	const jobsDir = join(exportsRoot, "jobs");
	let max = 0;
	let names = [];
	try {
		names = readdirSync(jobsDir);
	} catch {
		return { max, names };
	}
	for (const name of names) {
		if (name.endsWith(".raw")) {
			try {
				const size = statSync(join(jobsDir, name)).size;
				if (size > max) max = size;
			} catch {}
		}
	}
	return { max, names };
}

/** Read the export job's persisted snapshot (driver-side fs) — main-side
 * ground truth for phase/progress when the polled page is gone. */
function readJobSnapshot(exportsRoot) {
	const jobsDir = join(exportsRoot, "jobs");
	try {
		for (const name of readdirSync(jobsDir)) {
			if (!name.endsWith(".json")) continue;
			try {
				const parsed = JSON.parse(readFileSync(join(jobsDir, name), "utf8"));
				return {
					file: name,
					phase: typeof parsed.phase === "string" ? parsed.phase : null,
					progress: typeof parsed.progress === "number" ? parsed.progress : null,
					frames: parsed.frames ?? null,
					error: typeof parsed.error === "string" ? parsed.error : null,
					outputDescriptor: parsed.output?.descriptor ?? null,
				};
			} catch {}
		}
	} catch {}
	return null;
}

/** Scan the exports root for encode/output artifacts (driver-side fs). */
function scanOutputs(exportsRoot) {
	const partials = [];
	const outputs = [];
	try {
		for (const name of readdirSync(exportsRoot)) {
			if (name.endsWith(".partial")) partials.push(name);
			else if (name.endsWith(".mp4") || name.endsWith(".webm")) outputs.push(name);
		}
	} catch {}
	return { partials, outputs };
}

/** One full run: generate → boot → cold open → interactions → playback →
 * export → memory. Returns the run's measurement record. `onPartial`
 * receives the record as soon as it exists so a failed run's partial data
 * still reaches the artifact. */
async function runOnce(runIndex, args, facts, onPartial) {
	const runLabel = `run${runIndex}`;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 17);
	const runRoot = join(SCRATCH_BASE, `perf-baseline-${stamp}-${runLabel}`);
	const storeRoot = join(runRoot, "store");
	const exportsRoot = join(runRoot, "exports");
	mkdirSync(storeRoot, { recursive: true });
	mkdirSync(exportsRoot, { recursive: true });
	const run = {
		runIndex,
		startedAt: new Date().toISOString(),
		storeRoot,
		exportsRoot,
		routeUsed: null,
		methodBlock: null,
		projectId: null,
		coldOpen: null,
		interactions: null,
		playback: null,
		exportResult: null,
		memory: null,
		observations: { consoleErrors: [], mainStderrTail: [], dialogTitle: null, elementCountFinal: null },
		failure: null,
	};
	onPartial(run);

	let app = null;
	try {
		// -- GENERATE -------------------------------------------------------
		const generated = await step(`generate-${runLabel}`, () => runGenerator(`generate-${runLabel}`, storeRoot));
		run.projectId = generated.projectId;
		run.methodBlock = generated.methodBlock;

		// -- BOOT -----------------------------------------------------------
		const { env, passedKeys } = buildLaunchEnv(storeRoot, exportsRoot);
		run.envKeys = passedKeys;
		const launchStart = performance.now();
		app = await electron.launch({
			executablePath: require("electron"),
			args: [MAIN_PATH, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
			env,
		});
		const tLaunchResolved = performance.now();
		const proc = app.process();
		proc.stdout?.on("data", (chunk) => {
			run.observations.mainStderrTail.push(`[stdout] ${String(chunk).trim()}`);
			if (run.observations.mainStderrTail.length > 200) run.observations.mainStderrTail.shift();
		});
		proc.stderr?.on("data", (chunk) => {
			run.observations.mainStderrTail.push(`[stderr] ${String(chunk).trim()}`);
			if (run.observations.mainStderrTail.length > 200) run.observations.mainStderrTail.shift();
		});
		const page = await app.firstWindow();
		const tFirstWindow = performance.now();
		page.setDefaultTimeout(120_000);
		page.on("console", (msg) => {
			if (msg.type() === "error") {
				run.observations.consoleErrors.push(msg.text().slice(0, 300));
			}
		});
		page.on("pageerror", (err) => {
			run.observations.consoleErrors.push(`pageerror: ${err.message.slice(0, 300)}`);
		});

		// Project by URL: main.cjs loads index.html bare; app.tsx reads
		// ?project= from location.search at mount, so a goto with the query
		// boots straight into the editor (picker click is the fallback).
		const tGotoStart = performance.now();
		let routeUsed = "page.goto opencut://app/index.html?project=<id>";
		try {
			await page.goto(`opencut://app/index.html?project=${encodeURIComponent(run.projectId)}`);
		} catch {
			routeUsed = "fallback: picker click";
			await page.goto("opencut://app/index.html");
			await page
				.locator('[data-testid="project-row"]', { hasText: PROJECT_NAME })
				.first()
				.click({ timeout: 120_000 });
		}
		const tGotoResolved = performance.now();
		run.routeUsed = routeUsed;

		// -- COLD OPEN ------------------------------------------------------
		// Editor interactive = export-panel present AND main-track select
		// button present AND all 2000 element nodes mounted (driver clock).
		const firstSeen = { panel: null, mainTrack: null, timecode: null, elements: null };
		const coldStart = performance.now();
		let probe = null;
		let stableCount = 0;
		let lastCount = -1;
		while (performance.now() - coldStart < COLD_OPEN_TIMEOUT_MS) {
			probe = await page.evaluate(COLD_PROBE);
			if (probe.panel && firstSeen.panel === null) firstSeen.panel = performance.now();
			if (probe.mainTrack && firstSeen.mainTrack === null) firstSeen.mainTrack = performance.now();
			if (probe.timecode && firstSeen.timecode === null) firstSeen.timecode = performance.now();
			if (probe.elements >= CLIPS && firstSeen.elements === null) firstSeen.elements = performance.now();
			if (probe.elements === lastCount) stableCount += 1;
			else stableCount = 0;
			lastCount = probe.elements;
			const done =
				firstSeen.panel !== null &&
				firstSeen.mainTrack !== null &&
				firstSeen.elements !== null &&
				stableCount >= 4;
			if (done) break;
			await sleep(POLL_MS);
		}
		const coldEnd = performance.now();
		run.coldOpen = {
			definition:
				"editor interactive = [data-testid=export-panel] present AND button[aria-label='Select Main Track track'] present AND all 2000 element nodes (div.absolute.top-0.select-none) mounted; harness monotonic clock from before electron.launch()",
			clock: "harness (driver) monotonic clock",
			tLaunchResolvedMs: tLaunchResolved - launchStart,
			tFirstWindowMs: tFirstWindow - launchStart,
			tGotoResolvedMs: tGotoResolved - launchStart,
			firstPanelMs: firstSeen.panel !== null ? firstSeen.panel - launchStart : null,
			firstMainTrackMs: firstSeen.mainTrack !== null ? firstSeen.mainTrack - launchStart : null,
			firstTimecodeMs: firstSeen.timecode !== null ? firstSeen.timecode - launchStart : null,
			firstAllElementsMs: firstSeen.elements !== null ? firstSeen.elements - launchStart : null,
			totalMs: firstSeen.elements !== null && firstSeen.panel !== null && firstSeen.mainTrack !== null
				? Math.max(firstSeen.panel, firstSeen.mainTrack, firstSeen.elements) - launchStart
				: null,
			pollSettledMs: coldEnd - launchStart,
			elementCountFinal: probe?.elements ?? null,
			timedOut:
				firstSeen.panel === null || firstSeen.mainTrack === null || firstSeen.elements === null,
		};
		run.observations.elementCountFinal = probe?.elements ?? null;
		if (run.coldOpen.timedOut) {
			throw new Error(
				`cold open timed out after ${fmtMs(COLD_OPEN_TIMEOUT_MS)} (panel=${firstSeen.panel !== null} mainTrack=${firstSeen.mainTrack !== null} elements=${probe?.elements ?? 0}/${CLIPS})`,
			);
		}
		log(`[${runLabel}] cold open total ${fmtMs(run.coldOpen.totalMs)} (elements ${probe?.elements})`);

		// First-run onboarding dialog, if any: record + dismiss (boot-proof's
		// policy — editor source, not ours to change).
		const dialogText = probe?.dialog;
		if (dialogText !== null && dialogText !== undefined && dialogText !== "") {
			run.observations.dialogTitle = dialogText;
			await page.keyboard.press("Escape");
			await page
				.locator('[role="dialog"]')
				.first()
				.waitFor({ state: "hidden", timeout: 30_000 });
		}

		await sleep(2_000); // post-mount settle before interactions
		await page.evaluate(INPUT_CAPTURE_INSTALL);

		// -- INTERACTION A: zoom-in button click -----------------------------
		const zoom = await step(`interaction-zoom-${runLabel}`, async () => {
			const setup = await page.evaluate(ZOOM_SETUP);
			if (setup.error !== undefined) return { error: setup.error, latencyMs: null, verified: false };
			await page.mouse.click(setup.x, setup.y);
			await sleep(1_500);
			const read = await page.evaluate(() => ({ clickTs: window.__probe.clickTs, obs: window.__zoomObs }));
			const verified =
				read.obs !== null &&
				read.obs !== undefined &&
				read.obs.widthAfter !== null &&
				read.obs.widthAfter !== undefined &&
				read.obs.widthAfter !== read.obs.widthBefore;
			return {
				startMarker: "trusted click event on the timeline toolbar zoom-in button (in-page capture listener)",
				effectMarker: "first inline width style mutation on the timeline tracks scroll content (MutationObserver, in-page)",
				latencyMs: read.obs && read.obs.ts !== null && read.clickTs !== null
					? read.obs.ts - read.clickTs
					: null,
				widthBefore: read.obs?.widthBefore ?? null,
				widthAfter: read.obs?.widthAfter ?? null,
				verified,
				error: verified ? null : "zoom width did not change after click (at max zoom or handler inert)",
			};
		});

		// -- INTERACTION B: clip selection click -----------------------------
		const selection = await step(`interaction-select-${runLabel}`, async () => {
			const setup = await page.evaluate(SELECT_SETUP);
			if (setup.error !== undefined) {
				return { error: setup.error, latencyMs: null, verified: false };
			}
			await page.mouse.click(setup.x, setup.y);
			// Fallback effect marker at driver resolution: the first 100 ms poll
			// where a selection resize handle exists anywhere in the timeline.
			// Selection is verified by this state, not by the observer alone.
			let fallbackTs = null;
			for (let i = 0; i < 15; i += 1) {
				const snap = await page.evaluate(() => ({
					ts: performance.now(),
					handle: document.querySelector('section[aria-label="Timeline"] [aria-label="Left resize handle"]') !== null,
				}));
				if (snap.handle && fallbackTs === null) fallbackTs = snap.ts;
				if (fallbackTs !== null && i >= 4) break;
				if (i < 14) await sleep(100);
			}
			const read = await page.evaluate(() => {
				const handle = document.querySelector('section[aria-label="Timeline"] [aria-label="Left resize handle"]');
				const container = handle instanceof Element
					? handle.closest("div.absolute.top-0.select-none")
					: null;
				return {
					clickTs: window.__probe.clickTs,
					obs: window.__selObs,
					handlePresent: handle !== null,
					selectedElementText: container instanceof Element
						? (container.textContent || "").trim().slice(0, 40)
						: null,
				};
			});
			const obsLatencyMs = read.obs && read.obs.ts !== null && read.clickTs !== null
				? read.obs.ts - read.clickTs
				: null;
			const fallbackLatencyMs = fallbackTs !== null && read.clickTs !== null
				? fallbackTs - read.clickTs
				: null;
			// The observer timestamp is only trusted as the effect marker when
			// the mutated element is the one that ended up selected (the dense
			// layout makes hover/other-sibling mutations possible firsts).
			const obsTrustworthy = obsLatencyMs !== null
				&& (read.selectedElementText === null
					|| read.selectedElementText === (read.obs?.targetText ?? read.selectedElementText));
			const latencyMs = obsTrustworthy ? obsLatencyMs : (fallbackLatencyMs ?? obsLatencyMs);
			return {
				startMarker: `trusted click at (${setup.x.toFixed(0)}, ${setup.y.toFixed(0)}) (in-page capture listener); topmost element under the point: "${setup.topmostElementText ?? "none"}", row has ${setup.rowElementCount} elements`,
				effectMarker: latencyMs === null
					? "no selection effect observed (no row mutation, no resize handles anywhere in the timeline)"
					: obsTrustworthy
						? `first DOM mutation inside the clicked track row (MutationObserver, in-page; mutated element "${read.obs?.targetText ?? "?"}")`
						: "first driver poll (100 ms resolution) where a selection resize handle exists in the timeline (observer first-mutation did not match the selected element)",
				markerKind: latencyMs === null ? "none" : obsTrustworthy ? "mutation-observer" : "poll-fallback",
				latencyMs,
				obsLatencyMs,
				fallbackLatencyMs,
				mutationKind: read.obs?.kind ?? null,
				selectedElementText: read.selectedElementText,
				verified: read.handlePresent,
				error: read.handlePresent ? null : "click produced no observable selection effect (no resize handles appeared anywhere in the timeline)",
			};
		});

		// -- INTERACTION C: export panel reopen ------------------------------
		const panel = await step(`interaction-panel-${runLabel}`, async () => {
			await page
				.locator('aside[data-testid="export-panel"] button[aria-label="Collapse export panel"]')
				.click();
			await page
				.locator('[data-testid="export-panel-toggle"]')
				.waitFor({ state: "visible", timeout: 30_000 });
			await page.evaluate(() => {
				window.__panelObs = { ts: null };
				const obs = new MutationObserver(() => {
					if (window.__panelObs.ts === null && document.querySelector('aside[data-testid="export-panel"]')) {
						window.__panelObs.ts = performance.now();
						obs.disconnect();
					}
				});
				obs.observe(document.body, { childList: true, subtree: true });
				return true;
			});
			await page.locator('[data-testid="export-panel-toggle"]').click();
			await sleep(1_500);
			const read = await page.evaluate(() => ({ clickTs: window.__probe.clickTs, ts: window.__panelObs.ts, present: document.querySelector('aside[data-testid="export-panel"]') !== null }));
			return {
				startMarker: "trusted click on [data-testid=export-panel-toggle] after collapsing the panel (in-page capture listener)",
				effectMarker: "aside[data-testid=export-panel] present in DOM again (MutationObserver on body, in-page)",
				latencyMs: (read.ts ?? null) !== null && read.clickTs !== null ? read.ts - read.clickTs : null,
				verified: read.present === true,
			};
		});
		run.interactions = { zoom, selection, panel };

		// -- PLAYBACK FPS ----------------------------------------------------
		run.playback = await step(`playback-${runLabel}`, async () => {
			const focus = await page.evaluate(FOCUS_EDITOR);
			const tcBefore = ((await page
				.locator('button[title="Click to edit time"]')
				.first()
				.textContent()) ?? "").trim();
			await page.evaluate(RAF_INSTALL);
			await page.keyboard.press("Space");
			await sleep(5_600);
			const raf = await page.evaluate(() => window.__raf);
			const tcAfter = ((await page
				.locator('button[title="Click to edit time"]')
				.first()
				.textContent()) ?? "").trim();
			await page.keyboard.press("Space"); // pause
			await sleep(500);
			const windowMs = raf?.t0 !== null && raf?.tEnd !== null && raf?.t0 !== undefined && raf?.tEnd !== undefined
				? raf.tEnd - raf.t0
				: null;
			let medianInterval = null;
			let dropped = null;
			let droppedDef = "rAF intervals > 1.5x the median interval";
			if (raf?.intervals?.length) {
				const sorted = [...raf.intervals].sort((a, b) => a - b);
				medianInterval = sorted[Math.floor(sorted.length / 2)];
				dropped = raf.intervals.filter((i) => i > 1.5 * (medianInterval || 1)).length;
			}
			if ((raf?.count ?? 0) < 3) {
				// With fewer than 3 observed frames every interval IS the
				// median — the heuristic is undefined, not zero.
				dropped = null;
				droppedDef = "n/a — fewer than 3 frames observed in the window, the >1.5x-median heuristic is undefined at this frame rate (not zero)";
			}
			return {
				method: "in-page requestAnimationFrame counter over a 5 s window during playback started with the Space key (keybinding 'space' -> toggle-play), main-track button focused first so the surface-root keydown listener receives it",
				playbackStarted: tcBefore !== tcAfter,
				timecodeBefore: tcBefore,
				timecodeAfter: tcAfter,
				focusTarget: focus.active,
				frames: raf?.count ?? null,
				windowMs,
				fps: raf?.count !== null && raf?.count !== undefined && windowMs
					? (raf.count / (windowMs / 1000))
					: null,
				medianFrameIntervalMs: medianInterval,
				droppedFramesHeuristic: dropped,
				droppedHeuristicDefinition: droppedDef,
			};
		});

		// -- MEMORY BEFORE EXPORT --------------------------------------------
		const memBefore = {
			heap: await page.evaluate(HEAP_SAMPLE),
			rssMain: await app.evaluate(() => process.memoryUsage().rss),
		};

		// -- EXPORT -----------------------------------------------------------
		run.exportResult = await step(`export-${runLabel}`, async () => {
			await page
				.locator('select[data-testid="export-quality"]')
				.waitFor({ state: "visible", timeout: 60_000 });
			await page.locator('select[data-testid="export-format"]').selectOption("mp4");
			await page.locator('select[data-testid="export-quality"]').selectOption("medium");
			await page.locator('input[data-testid="export-audio"]').uncheck();
			await page.evaluate(EXPORT_OBS_INSTALL);
			const exportStart = performance.now();
			const exportStartWallMs = Date.now();
			// Page-death instrumentation: which Playwright event fired and when
			// (driver clock). A renderer crash and a window close are different
			// app failures — the 2026-08-16 pre-fix run crashed the GPU process
			// (exit_code=34) and took the page down mid-export.
			const pageDeath = { kind: null, atMs: null };
			page.on("crash", () => {
				if (pageDeath.kind === null) {
					pageDeath.kind = "renderer crash (Playwright page 'crash' event)";
					pageDeath.atMs = performance.now() - exportStart;
				}
			});
			page.on("close", () => {
				if (pageDeath.kind === null) {
					pageDeath.kind = "window/page closed (Playwright page 'close' event)";
					pageDeath.atMs = performance.now() - exportStart;
				}
			});
			await page.locator('[data-testid="export-start"]').click();
			const startSnap = await page.evaluate(() => ({ clickTs: window.__probe.clickTs }));
			const clickTs = startSnap.clickTs;
			const series = [];
			let last = null;
			let pollError = null;
			while (performance.now() - exportStart < EXPORT_TIMEOUT_MS) {
				try {
					last = await page.evaluate(EXPORT_SAMPLE);
				} catch (error) {
					pollError = error instanceof Error ? error.message : String(error);
					break;
				}
				const raw = rawMaxBytes(exportsRoot);
				series.push({
					tMs: performance.now() - exportStart,
					status: last.status,
					percent: last.percent,
					frames: last.frames,
					rawBytes: raw.max,
				});
				const status = (last.status ?? "").toLowerCase();
				if (
					status.includes("complete") ||
					status.includes("failed") ||
					status.includes("cancelled")
				) {
					break;
				}
				await sleep(POLL_MS);
			}
			// Salvage: the export pipeline lives in the MAIN process (job
			// manager + hidden producer window + ffmpeg child), so it may
			// continue without the polled page. Watch the filesystem only.
			const salvage = [];
			if (pollError !== null) {
				await sleep(1_000); // let the crash/close event land
				salvage.push(
					`page poll failed at +${fmtMs(performance.now() - exportStart)} (driver clock): ${pollError}`,
				);
				if (pageDeath.kind !== null) {
					salvage.push(`${pageDeath.kind} at +${fmtMs(pageDeath.atMs)} (driver clock)`);
				} else {
					salvage.push("no page crash/close event observed — page.evaluate failed for another reason");
				}
				try {
					const mainState = await app.evaluate(() => ({
						windows: require("electron").BrowserWindow.getAllWindows().length,
					}));
					salvage.push(
						`main process alive: yes (${mainState.windows} window(s) remain — the export pipeline may still be running)`,
					);
				} catch (error) {
					salvage.push(
						`main process alive: no (app.evaluate failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)})`,
					);
				}
				const activityBytes = () => {
					const raw = rawMaxBytes(exportsRoot).max;
					const outs = scanOutputs(exportsRoot);
					let total = raw;
					for (const name of [...outs.partials, ...outs.outputs]) {
						try {
							total += statSync(join(exportsRoot, name)).size;
						} catch {}
					}
					return { total, raw, outs };
				};
				let lastActivity = activityBytes().total;
				let lastChange = performance.now();
				let outputStable = 0;
				let outputBytesSeen = -1;
				while (performance.now() - exportStart < EXPORT_TIMEOUT_MS) {
					const { total, raw, outs } = activityBytes();
					if (total !== lastActivity) {
						lastActivity = total;
						lastChange = performance.now();
					}
					series.push({
						tMs: performance.now() - exportStart,
						status: "(salvage: page dead — fs poll only)",
						percent: null,
						frames: null,
						rawBytes: raw,
					});
					if (outs.outputs.length > 0) {
						try {
							const size = statSync(join(exportsRoot, outs.outputs[0])).size;
							if (size === outputBytesSeen) outputStable += 1;
							else outputStable = 0;
							outputBytesSeen = size;
						} catch {}
						if (outputStable >= 3 && outs.partials.length === 0) {
							salvage.push(
								`output appeared and stabilized without the page at +${fmtMs(performance.now() - exportStart)} — export completed headless`,
							);
							break;
						}
					}
					if (performance.now() - lastChange > 180_000) {
						salvage.push(
							`no filesystem activity (raw/partial/output bytes) for 180 s at +${fmtMs(performance.now() - exportStart)} — the pipeline stopped with the page (180 s > one slow swiftshader frame, so this is a stall, not a slow frame)`,
						);
						break;
					}
					await sleep(1_000);
				}
			}
			let events = [];
			let eventsReachable = true;
			try {
				events = await page.evaluate(() => window.__exportObs.events);
			} catch {
				eventsReachable = false;
			}
			const firstEvent = (text) => events.find((e) => e.text.startsWith(text)) ?? null;
			const queued = firstEvent("Starting");
			const rendering = firstEvent("Rendering");
			const encoding = firstEvent("Encoding");
			const doneEv = firstEvent("Export complete");
			const failedEv = firstEvent("Export failed") ?? firstEvent("Export cancelled");
			// Series-derived boundaries (driver clock, 250 ms resolution) — the
			// only source when the in-page observer died with the page.
			const firstSeries = (prefix) =>
				series.find((s) => typeof s.status === "string" && s.status.startsWith(prefix)) ?? null;
			const seriesQueuedMs = firstSeries("Starting")?.tMs ?? null;
			const seriesRenderingMs = firstSeries("Rendering")?.tMs ?? null;
			const seriesEncodingMs = firstSeries("Encoding")?.tMs ?? null;
			const renderStart = rendering?.ts ?? queued?.ts ?? null;
			const encodeStart = encoding?.ts ?? null;
			const endTs = doneEv?.ts ?? failedEv?.ts ?? null;
			const terminalStatus = last?.status ?? null;
			const rawPeak = series.reduce((m, s) => Math.max(m, s.rawBytes), 0);
			const jobSnap = readJobSnapshot(exportsRoot);
			const outsNow = scanOutputs(exportsRoot);
			let outputName = null;
			let outputBytes = null;
			let outputDeleted = false;
			let outputMtimeMs = null;
			// Output identity: the panel's descriptor when the page is alive,
			// the exports-root scan otherwise (the same file either way).
			if (doneEv !== null && doneEv !== undefined) {
				const panelName = await page
					.locator('[data-testid="export-output"]')
					.first()
					.textContent()
					.catch(() => null);
				outputName = ((panelName ?? "")).trim() || null;
			}
			if (outputName === null && outsNow.outputs.length > 0) outputName = outsNow.outputs[0];
			if (outputName !== null) {
				const outputPath = join(exportsRoot, outputName);
				if (existsSync(outputPath)) {
					outputBytes = statSync(outputPath).size;
					outputMtimeMs = statSync(outputPath).mtimeMs;
					rmSync(outputPath, { force: true });
					outputDeleted = !existsSync(outputPath);
				}
			}
			// Outcome classification — an app crash mid-export is a
			// measurement, not a harness failure: it is recorded and the run
			// continues so the remaining metric families still land.
			let outcome;
			if (doneEv !== null && doneEv !== undefined) {
				outcome = "completed";
			} else if (failedEv !== null && failedEv !== undefined) {
				outcome = failedEv.text.includes("cancel") ? "cancelled" : "failed (panel reported)";
			} else if ((terminalStatus ?? "").toLowerCase().includes("complete")) {
				outcome = "completed (panel terminal status; observer event missed)";
			} else if (pollError !== null) {
				outcome = outputDeleted
					? "completed after page death (export pipeline finished without the polled page)"
					: "app died during export (page gone, no output produced)";
			} else if (last === null) {
				outcome = "timeout (no status ever sampled within budget)";
			} else {
				outcome = `no terminal event within budget (last status: "${last.status ?? "none"}" after ${fmtMs(performance.now() - exportStart)})`;
			}
			await sleep(2_000); // producer window teardown settle before memory
			const liveSeries = series.filter((s) => typeof s.status === "string" && !s.status.startsWith("(salvage"));
			return {
				request: { format: "mp4", quality: "medium", includeAudio: false },
				outcome,
				phaseMethod: eventsReachable
					? "phase boundaries = in-page MutationObserver timestamps of distinct [data-testid=export-status] texts (renderer performance.now clock); progress series = 250 ms driver poll"
					: "in-page observer unreachable (page died mid-export) — phase boundaries derived from the 250 ms driver poll series and output-file mtime (driver/wall clock, coarser); salvage detail below",
				clickTsKnown: clickTs !== null,
				queuedMs: renderStart !== null && clickTs !== null ? renderStart - clickTs : null,
				renderPhaseMs: encodeStart !== null && renderStart !== null ? encodeStart - renderStart : null,
				encodePhaseMs: endTs !== null && encodeStart !== null ? endTs - encodeStart : null,
				totalMs: endTs !== null && clickTs !== null ? endTs - clickTs : null,
				seriesQueuedMs,
				seriesRenderPhaseMs:
					seriesEncodingMs !== null && seriesRenderingMs !== null ? seriesEncodingMs - seriesRenderingMs : null,
				seriesEncodePhaseMs:
					outputMtimeMs !== null && seriesEncodingMs !== null
						? Math.max(0, outputMtimeMs - exportStartWallMs - seriesEncodingMs)
						: null,
				seriesTotalMs:
					outputMtimeMs !== null ? Math.max(0, outputMtimeMs - exportStartWallMs) : null,
				terminalStatus,
				statusEvents: events,
				eventsReachable,
				pageDeath: pollError !== null ? pageDeath : null,
				salvageNotes: salvage,
				jobSnapshot: jobSnap,
				framesFinal:
					liveSeries.length > 0 ? liveSeries[liveSeries.length - 1].frames : null,
				samples: series.length,
				pollMs: POLL_MS,
				rawPeakBytes: rawPeak,
				rawExpectedBytes: CANVAS_WIDTH * CANVAS_HEIGHT * 3 * 300,
				outputName,
				outputBytes,
				outputDeleted,
				progressSeriesTail: liveSeries.slice(-5),
			};
		});

		// -- MEMORY AFTER EXPORT ----------------------------------------------
		// Best effort: if the app died during export, the 'after' sample is
		// whatever could still be reached — the absence itself is the data.
		let heapAfter = null;
		try {
			heapAfter = await page.evaluate(HEAP_SAMPLE);
		} catch {}
		let rssAfter = null;
		try {
			rssAfter = await app.evaluate(() => process.memoryUsage().rss);
		} catch {}
		const memAfter = { heap: heapAfter, rssMain: rssAfter };
		run.memory = {
			method: "renderer usedJSHeapSize via performance.memory (page.evaluate) + main-process RSS via process.memoryUsage().rss (app.evaluate in main); 'before' sampled after playback pause, 'after' 2 s past export completion (or past the recorded export outcome)",
			heapAvailable: memBefore.heap.available,
			before: { usedHeapBytes: memBefore.heap.used, mainRssBytes: memBefore.rssMain },
			after: { usedHeapBytes: memAfter.heap?.used ?? null, mainRssBytes: memAfter.rssMain },
			afterReachable: {
				heap: memAfter.heap !== null,
				mainRss: memAfter.rssMain !== null,
			},
			heapDeltaBytes:
				memBefore.heap.used !== null && memAfter.heap?.used != null
					? memAfter.heap.used - memBefore.heap.used
					: null,
			rssDeltaBytes:
				memAfter.rssMain !== null && memBefore.rssMain !== null
					? memAfter.rssMain - memBefore.rssMain
					: null,
		};
	} catch (error) {
		run.failure = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		if (app !== null) {
			await app.close().catch(() => {});
		}
		await step(`cleanup-${runLabel}`, async () => {
			if (!args.keep) {
				await safeRm(storeRoot);
				await safeRm(exportsRoot);
			}
		});
		run.finishedAt = new Date().toISOString();
	}
	return run;
}

function coldOpenTable(run) {
	const co = run.coldOpen;
	if (co === null) return "_cold open not reached_";
	const rows = [
		["electron.launch() resolved", co.tLaunchResolvedMs],
		["first window acquired", co.tFirstWindowMs],
		["page.goto(?project=) resolved", co.tGotoResolvedMs],
		["export-panel present in DOM", co.firstPanelMs],
		["main-track select button present", co.firstMainTrackMs],
		["timecode present", co.firstTimecodeMs],
		[`all ${CLIPS} element nodes mounted`, co.firstAllElementsMs],
		["**Cold open total (launch → editor interactive)**", co.totalMs],
		["poll-stable end (4 consecutive equal counts)", co.pollSettledMs],
	];
	const body = rows
		.map(([label, ms]) => `| ${label} | ${fmtMs(ms)} | no S08 gate exists yet for 2000-clip cold open — baseline recorded for S08 to set against |`)
		.join("\n");
	return [
		`Definition: ${co.definition}.`,
		"",
		`| marker (since launch) | time | vs S08 expectation |`,
		`| --- | --- | --- |`,
		body,
		"",
		`Element node count at end of polling: **${co.elementCountFinal}** (expected ${CLIPS}).`,
	].join("\n");
}

function interactionTable(run) {
	const it = run.interactions;
	if (it === null) return "_interactions not reached_";
	const row = (name, m) =>
		`| ${name} | ${m.error !== null && m.error !== undefined ? `**failed**: ${m.error}` : fmtMs(m.latencyMs)} | ${m.verified ? "verified" : "NOT verified"} | no S08 gate exists yet for interaction latency — baseline recorded |`;
	return [
		"| interaction | event → effect wall time | effect verified | vs S08 expectation |",
		"| --- | --- | --- | --- |",
		row("A — timeline zoom-in button click", it.zoom),
		row("B — click a clip on the timeline (select)", it.selection),
		row("C — reopen the export panel", it.panel),
		"",
		"Markers (recorded per definition, in-page performance.now clock):",
		`- A start: ${it.zoom.startMarker ?? "n/a"}`,
		`- A effect: ${it.zoom.effectMarker ?? "n/a"}${it.zoom.widthBefore !== null && it.zoom.widthBefore !== undefined ? ` (width ${it.zoom.widthBefore} → ${it.zoom.widthAfter ?? "unchanged"})` : ""}`,
		`- B start: ${it.selection.startMarker ?? "n/a"}`,
		`- B effect: ${it.selection.effectMarker ?? "n/a"}${it.selection.mutationKind ? ` (first mutation kind: ${it.selection.mutationKind})` : ""}`,
		`- B marker used: ${it.selection.markerKind ?? "n/a"}${it.selection.obsLatencyMs !== null && it.selection.obsLatencyMs !== undefined ? ` — observer raw ${fmtMs(it.selection.obsLatencyMs)}` : ""}${it.selection.fallbackLatencyMs !== null && it.selection.fallbackLatencyMs !== undefined ? ` · poll-fallback raw ${fmtMs(it.selection.fallbackLatencyMs)}` : ""}${it.selection.selectedElementText ? ` · selected element ended up "${it.selection.selectedElementText}"` : " · no element ended up selected"}`,
		`- C start: ${it.panel.startMarker ?? "n/a"}`,
		`- C effect: ${it.panel.effectMarker ?? "n/a"}`,
	].join("\n");
}

function playbackTable(run) {
	const pb = run.playback;
	if (pb === null) return "_playback not reached_";
	return [
		`Method: ${pb.method}.`,
		"",
		"| metric | value | vs S08 expectation |",
		"| --- | --- | --- |",
		`| playback started (timecode advanced) | ${pb.playbackStarted ? `yes (${pb.timecodeBefore} → ${pb.timecodeAfter})` : `NO (${pb.timecodeBefore} → ${pb.timecodeAfter})`} | — |`,
		`| frames observed in 5 s window | ${pb.frames ?? "n/a"} | — |`,
		`| measured window | ${fmtMs(pb.windowMs)} | — |`,
		`| **observed fps** | ${pb.fps !== null && pb.fps !== undefined ? pb.fps.toFixed(1) : "n/a"} | ${pb.fps !== null && pb.fps !== undefined ? `${pb.fps.toFixed(1)} fps on swiftshader — the S08 gate does not exist yet; today's number is the baseline S08 must set against` : "not measured"} |`,
		`| median frame interval | ${fmtMs(pb.medianFrameIntervalMs)} | — |`,
		`| dropped-frame heuristic count | ${pb.droppedFramesHeuristic ?? "n/a"} (${pb.droppedHeuristicDefinition}) | — |`,
	].join("\n");
}

function exportTable(run) {
	const ex = run.exportResult;
	if (ex === null) return "_export not reached_";
	// Observer timestamps (renderer clock) are the primary source; the
	// series-derived values (driver poll / file mtime) are the fallback when
	// the in-page observer died with the page — never mixed in one cell.
	const cell = (obsMs, seriesMs) => {
		if (obsMs !== null && obsMs !== undefined) return fmtMs(obsMs);
		if (seriesMs !== null && seriesMs !== undefined) return `${fmtMs(seriesMs)} (derived — driver poll / output-file mtime clock)`;
		return "n/a";
	};
	const lines = [
		`Request: format ${ex.request.format}, quality ${ex.request.quality}, include audio ${ex.request.includeAudio} (the project has no audio; the audio phase is D1's territory).`,
		`Method: ${ex.phaseMethod}.`,
		`**Outcome: ${ex.outcome}.**`,
		"",
		"| measure | value | vs S08 expectation |",
		"| --- | --- | --- |",
		`| click → render start (queued) | ${cell(ex.queuedMs, ex.seriesQueuedMs)} | no S08 gate exists yet — baseline recorded |`,
		`| **render phase (first rendering → first encoding)** | ${cell(ex.renderPhaseMs, ex.seriesRenderPhaseMs)} | no S08 gate exists yet for 2000-clip render wall time — baseline recorded for S08 to set |`,
		`| **encode phase (first encoding → completed)** | ${cell(ex.encodePhaseMs, ex.seriesEncodePhaseMs)} | no S08 gate exists yet — baseline recorded |`,
		`| **total export wall time (click → completed)** | ${cell(ex.totalMs, ex.seriesTotalMs)} | no S08 gate exists yet — baseline recorded |`,
		`| terminal panel status | ${ex.terminalStatus ?? "n/a (page died before a terminal status)" } | — |`,
		`| frames (panel text, final live sample) | ${ex.framesFinal ?? "n/a"} | — |`,
		`| output file | ${ex.outputName ?? "none"} | — |`,
		`| output bytes | ${fmtBytes(ex.outputBytes)} | — |`,
		`| output verified then deleted | ${ex.outputDeleted ? `yes (${fmtBytes(ex.outputBytes)} removed)` : "no"} | — |`,
		`| raw stream peak (250 ms fs poll, jobs/*.raw) | ${fmtBytes(ex.rawPeakBytes)} (analytic expectation ${fmtBytes(ex.rawExpectedBytes)}) | — |`,
		`| progress samples taken | ${ex.samples} @ ${ex.pollMs} ms | — |`,
	];
	if (ex.jobSnapshot !== null && ex.jobSnapshot !== undefined) {
		const js = ex.jobSnapshot;
		lines.push(
			`| job snapshot (jobs/*.json, main-side) | phase ${js.phase ?? "?"}, progress ${js.progress ?? "?"}${js.frames !== null && js.frames !== undefined ? `, frames ${JSON.stringify(js.frames)}` : ""}${js.error ? `, error: ${js.error.slice(0, 120)}` : ""} | — |`,
		);
	}
	if (ex.pageDeath !== null && ex.pageDeath !== undefined) {
		lines.push(
			`| page death during export | ${ex.pageDeath.kind ?? "no crash/close event (page.evaluate failed anyway)"} at +${fmtMs(ex.pageDeath.atMs)} (driver clock) | app-level finding — reported, not fixed |`,
		);
	}
	if (ex.salvageNotes !== null && ex.salvageNotes.length > 0) {
		lines.push("", "Salvage detail (driver-side filesystem polling after the page died):");
		for (const note of ex.salvageNotes) lines.push(`- ${note}`);
	}
	lines.push("", "Status-event series (in-page timestamps, renderer clock):");
	if (ex.statusEvents.length > 0) {
		for (const e of ex.statusEvents) lines.push(`- ${e.text} @ +${e.ts.toFixed(0)} ms`);
	} else {
		lines.push("- _none reachable — the in-page observer died with the page; use the derived boundaries in the table above_");
	}
	lines.push("", "Progress series tail (250 ms driver poll, live samples only):");
	for (const s of ex.progressSeriesTail) {
		lines.push(`- +${s.tMs.toFixed(0)} ms: ${s.status ?? "?"} · ${s.percent ?? "-"}% · raw ${fmtBytes(s.rawBytes)}`);
	}
	return lines.join("\n");
}

function memoryTable(run) {
	const mem = run.memory;
	if (mem === null) return "_memory not sampled_";
	const heapDead = mem.afterReachable !== undefined && mem.afterReachable.heap === false;
	const rssDead = mem.afterReachable !== undefined && mem.afterReachable.mainRss === false;
	const heapCell = (bytes, dead) => {
		if (bytes !== null && bytes !== undefined) return fmtBytes(bytes);
		if (dead) return "not sampled — the page died during export (see export outcome)";
		return "unavailable — performance.memory not exposed in this renderer";
	};
	const rssCell = (bytes, dead) => {
		if (bytes !== null && bytes !== undefined) return fmtBytes(bytes);
		if (dead) return "not sampled — the main process was gone (see export outcome)";
		return "n/a";
	};
	return [
		`Method: ${mem.method}.`,
		"",
		"| sample | renderer usedJSHeapSize | main-process RSS | vs S08 expectation |",
		"| --- | --- | --- | --- |",
		`| before export | ${heapCell(mem.before.usedHeapBytes, false)} | ${rssCell(mem.before.mainRssBytes, false)} | no S08 gate exists yet for memory — baseline recorded |`,
		`| after export (+2 s settle) | ${heapCell(mem.after.usedHeapBytes, heapDead)} | ${rssCell(mem.after.mainRssBytes, rssDead)} | no S08 gate exists yet for memory — baseline recorded |`,
		`| delta | ${heapCell(mem.heapDeltaBytes, heapDead && mem.heapDeltaBytes === null)} | ${rssCell(mem.rssDeltaBytes, rssDead && mem.rssDeltaBytes === null)} | — |`,
		"",
		`performance.memory available: **${mem.heapAvailable}**.`,
	].join("\n");
}

function repeatabilityNote(runs) {
	if (runs.length < 2) return "_single run — no repeatability delta available by construction (--runs 1)_";
	const [a, b] = runs;
	const rows = [];
	const push = (label, va, vb) => {
		if (va === null || vb === null || va === undefined || vb === undefined) {
			rows.push(`| ${label} | ${va ?? "n/a"} | ${vb ?? "n/a"} | n/a |`);
			return;
		}
		const delta = Math.abs(vb - va);
		rows.push(`| ${label} | ${va.toFixed(0)} ms | ${vb.toFixed(0)} ms | ${delta.toFixed(0)} ms |`);
	};
	if (a.coldOpen && b.coldOpen) push("cold open total (ms)", a.coldOpen.totalMs, b.coldOpen.totalMs);
	if (a.interactions && b.interactions) {
		push("interaction A zoom (ms)", a.interactions.zoom.latencyMs, b.interactions.zoom.latencyMs);
		push("interaction B select (ms)", a.interactions.selection.latencyMs, b.interactions.selection.latencyMs);
		push("interaction C panel (ms)", a.interactions.panel.latencyMs, b.interactions.panel.latencyMs);
	}
	if (a.playback && b.playback && a.playback.fps !== null && b.playback.fps !== null) {
		rows.push(
			`| playback fps | ${a.playback.fps.toFixed(1)} | ${b.playback.fps.toFixed(1)} | ${Math.abs(b.playback.fps - a.playback.fps).toFixed(1)} fps |`,
		);
	}
	if (a.exportResult && b.exportResult) {
		push("export render phase (ms)", a.exportResult.renderPhaseMs, b.exportResult.renderPhaseMs);
		push("export encode phase (ms)", a.exportResult.encodePhaseMs, b.exportResult.encodePhaseMs);
		push("export total (ms)", a.exportResult.totalMs, b.exportResult.totalMs);
		if (
			a.exportResult.rawPeakBytes !== null && a.exportResult.rawPeakBytes !== undefined &&
			b.exportResult.rawPeakBytes !== null && b.exportResult.rawPeakBytes !== undefined
		) {
			rows.push(
				`| raw peak (MB) | ${(a.exportResult.rawPeakBytes / 1_048_576).toFixed(1)} | ${(b.exportResult.rawPeakBytes / 1_048_576).toFixed(1)} | ${(Math.abs(b.exportResult.rawPeakBytes - a.exportResult.rawPeakBytes) / 1_048_576).toFixed(1)} MB |`,
			);
		} else {
			rows.push(`| raw peak (MB) | ${a.exportResult.rawPeakBytes !== null && a.exportResult.rawPeakBytes !== undefined ? (a.exportResult.rawPeakBytes / 1_048_576).toFixed(1) : "n/a"} | ${b.exportResult.rawPeakBytes !== null && b.exportResult.rawPeakBytes !== undefined ? (b.exportResult.rawPeakBytes / 1_048_576).toFixed(1) : "n/a"} | n/a |`);
		}
	}
	if (
		a.memory && b.memory &&
		a.memory.after.mainRssBytes !== null && a.memory.after.mainRssBytes !== undefined &&
		b.memory.after.mainRssBytes !== null && b.memory.after.mainRssBytes !== undefined
	) {
		rows.push(
			`| main RSS after export (MB) | ${(a.memory.after.mainRssBytes / 1_048_576).toFixed(1)} | ${(b.memory.after.mainRssBytes / 1_048_576).toFixed(1)} | ${(Math.abs(b.memory.after.mainRssBytes - a.memory.after.mainRssBytes) / 1_048_576).toFixed(1)} MB |`,
		);
	}
	return [
		"Both runs measured the same deterministic project (same generator seed → same project id) against fresh scratch roots; deltas below are run-to-run on this machine.",
		"",
		"| metric | run 1 | run 2 | delta |",
		"| --- | --- | --- | --- |",
		...rows,
	].join("\n");
}

function writeArtifact(args, facts, runs) {
	const lines = [];
	lines.push("# Export performance baseline — 2000-clip dense project (2026-08-16)");
	lines.push("");
	lines.push(
		"Generated by `apps/electron-host/scripts/export-perf-baseline.mjs` (do not hand-edit; the script overwrites this file on every run).",
	);
	lines.push(
		"This is the measurement, not a gate pass: the 2000-clip acceptance gate is S08's to set — every \"vs S08 expectation\" cell states the metric's standing without a pass/fail claim.",
	);
	lines.push("");
	lines.push("## Machine facts");
	lines.push("");
	lines.push("| fact | value |");
	lines.push("| --- | --- |");
	lines.push(`| CPU | ${facts.cpuModel} x ${facts.cpuCount} |`);
	lines.push(`| total RAM | ${(facts.totalMem / 1024 ** 3).toFixed(1)} GiB |`);
	lines.push(`| OS | ${facts.platform} |`);
	lines.push(`| node | ${facts.nodeVersion} |`);
	lines.push(`| bun | ${facts.bunVersion} |`);
	lines.push(`| electron | ${facts.electronVersion} |`);
	lines.push(`| playwright | ${facts.playwrightVersion} |`);
	lines.push(`| ffmpeg | ${facts.ffmpegVersion} |`);
	lines.push(`| scratch drive free space | ${facts.diskFree !== null ? fmtBytes(facts.diskFree) : "unknown"} |`);
	lines.push("| GPU | none — `--use-angle=swiftshader --enable-unsafe-swiftshader` (software GL); every rendering number below is CPU-rendered |");
	lines.push(`| harness command | \`node apps/electron-host/scripts/export-perf-baseline.mjs --runs ${args.runs}${args.keep ? " --keep" : ""}\` |`);
	lines.push("");
	lines.push("## Project shape and why");
	lines.push("");
	lines.push(
		`\`${PROJECT_NAME}\`: ${CLIPS} clips (1000 text + 1000 graphic) on 16 overlay tracks, dense layout, canvas ${CANVAS_WIDTH}x${CANVAS_HEIGHT}, fps 30/1, ~10 s timeline (300 frames).`,
	);
	lines.push(
		"The dense layout is the deliberate choice for disk feasibility: every frame composites all 2000 elements, and the raw export stream (~830 MB transient at 720p) fits the E: scratch disk. The staggered layout (the long sparse ~250 s timeline — the timeline-UI stress shape) is the S08 follow-up, not measured here.",
	);
	lines.push("");
	lines.push("Generator METHOD block (verbatim from the generator's stdout, run 1):");
	lines.push("");
	lines.push("```");
	lines.push(runs[0]?.methodBlock ?? "_generator did not complete_");
	lines.push("```");
	lines.push("");
	lines.push("## Definitions and substitutions (read before quoting any number)");
	lines.push("");
	lines.push("- Cold open, interactions, playback and export methods are defined inside each run's section; all in-page deltas use the renderer's `performance.now()` clock, cold open uses the harness monotonic clock, and no two clocks are ever subtracted across.");
	lines.push("- The timeline zoom buttons carry no testid/aria-label, so interaction A locates the zoom-in button structurally: the last direct-child `<button>` of the toolbar group containing the Radix `[role=\"slider\"]` (app code untouched).");
	lines.push("- The export panel is always mounted beside the editor, so interaction C measures reopen-after-collapse (collapse via its aria-labeled button, reopen via `[data-testid=export-panel-toggle]`).");
	lines.push("- Export phase boundaries come from in-page MutationObserver timestamps of the panel's status text (\"Starting…\" / \"Rendering frames…\" / \"Encoding…\" / \"Export complete.\"), not from main-side instrumentation; the 250 ms driver poll only builds the progress series and the raw-size peak. If the page dies mid-export (the 2026-08-16 pre-fix run lost the renderer to a GPU-process crash), the boundaries fall back to the driver poll series and the output file's mtime, labeled as derived — a crash is recorded as the run's export outcome, never as a missing cell.");
	lines.push("- The dense layout overlaps elements within a track (8 s durations starting 16 ms apart), so a click point's topmost element need not be the one the app's hit-testing selects: interaction B observes the whole clicked track row and verifies selection by the resize handles, reporting which element actually ended up selected.");
	lines.push("- The project id is identical across runs (deterministic seed); each run still gets a fresh store root and fresh exports root, both removed by the harness on exit.");
	lines.push("");
	for (const run of runs) {
		lines.push(`## Run ${run.runIndex} — ${run.startedAt}`);
		lines.push("");
		lines.push(`- route into the editor: ${run.routeUsed ?? "n/a"}`);
		lines.push(`- store root: \`${run.storeRoot}\`${args.keep ? " (kept via --keep)" : " (removed after the run)"}`);
		lines.push(`- exports root: \`${run.exportsRoot}\`${args.keep ? " (kept via --keep)" : " (removed after the run)"}`);
		lines.push(`- launch env keys passed: ${run.envKeys ? run.envKeys.join(", ") : "n/a"}`);
		if (run.failure !== null) lines.push(`- **run failure**: ${run.failure}`);
		lines.push("");
		lines.push("### Cold open");
		lines.push("");
		lines.push(coldOpenTable(run));
		lines.push("");
		lines.push("### Interaction latency (event → observable effect)");
		lines.push("");
		lines.push(interactionTable(run));
		lines.push("");
		lines.push("### Playback frame rate");
		lines.push("");
		lines.push(playbackTable(run));
		lines.push("");
		lines.push("### Export wall time, split by phase");
		lines.push("");
		lines.push(exportTable(run));
		lines.push("");
		lines.push("### Memory");
		lines.push("");
		lines.push(memoryTable(run));
		lines.push("");
		lines.push("### Observations (app-level, run " + run.runIndex + ")");
		lines.push("");
		lines.push(`- onboarding dialog seen and dismissed: ${run.observations.dialogTitle ? JSON.stringify(run.observations.dialogTitle) : "none"}`);
		lines.push(`- element nodes mounted: ${run.observations.elementCountFinal ?? "n/a"}`);
		lines.push(`- renderer console errors: ${run.observations.consoleErrors.length}`);
		for (const errText of run.observations.consoleErrors.slice(0, 5)) {
			lines.push(`  - \`${errText.replace(/\n/g, " ")}\``);
		}
		const errTail = run.observations.mainStderrTail.filter((l) => l.toLowerCase().includes("error")).slice(-5);
		lines.push(`- main-process error-ish output lines (tail): ${errTail.length}`);
		for (const line of errTail) {
			lines.push(`  - \`${line.slice(0, 200)}\``);
		}
		lines.push("");
	}
	lines.push("## Repeatability");
	lines.push("");
	lines.push(repeatabilityNote(runs));
	lines.push("");
	const failed = runs.filter((r) => r.failure !== null);
	lines.push(
		failed.length === 0
			? `All ${runs.length} run(s) completed with every metric family measured.`
			: `${failed.length} of ${runs.length} run(s) failed: ${failed.map((r) => `run ${r.runIndex}: ${r.failure}`).join("; ")}`,
	);
	const notCompleted = runs.filter(
		(r) =>
			r.exportResult !== null &&
			r.exportResult !== undefined &&
			!String(r.exportResult.outcome).startsWith("completed") &&
			!String(r.exportResult.outcome).startsWith("cancelled"),
	);
	if (notCompleted.length > 0) {
		lines.push("");
		lines.push(
			`App-level export finding: ${notCompleted.length} of ${runs.length} run(s) did not complete their export — ${notCompleted.map((r) => `run ${r.runIndex}: ${r.exportResult.outcome}`).join("; ")}. Measured and reported, not fixed (the harness does not touch app code).`,
		);
	}
	lines.push("");
	const content = lines.join("\n");
	mkdirSync(dirname(args.out), { recursive: true });
	// LF discipline: join("\n") + trailing newline, written verbatim (no CRLF).
	writeFileSync(args.out, content + "\n", "utf8");
	log(`artifact written: ${args.out} (${content.length} chars)`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	log(`export-perf-baseline: runs=${args.runs} out=${args.out} keep=${args.keep}`);
	const facts = gatherFacts();
	if (facts.diskFree !== null && facts.diskFree < 1.5 * 1024 ** 3) {
		throw new Error(
			`scratch drive has only ${fmtBytes(facts.diskFree)} free — the dense export needs ~1 GB transient; refusing to run`,
		);
	}
	mkdirSync(SCRATCH_BASE, { recursive: true });
	if (!existsSync(join(APP_ROOT, "dist", "index.html"))) {
		throw new Error("apps/electron-host/dist/index.html missing — the app must be built before the baseline run");
	}
	const runs = [];
	let harnessCode = 0;
	for (let i = 1; i <= args.runs; i += 1) {
		log(`--- run ${i} of ${args.runs} ---`);
		let partial = null;
		try {
			const run = await step(`run${i}`, () =>
				runOnce(i, args, facts, (record) => {
					partial = record;
				}),
			);
			runs.push(run);
		} catch (error) {
			log(`run ${i} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
			harnessCode = 1;
			// runOnce's record (with whatever was measured before the failure)
			// when it got that far; an honest stub otherwise.
			runs.push(
				partial ?? {
					runIndex: i,
					startedAt: new Date().toISOString(),
					storeRoot: null,
					exportsRoot: null,
					routeUsed: null,
					methodBlock: null,
					projectId: null,
					coldOpen: null,
					interactions: null,
					playback: null,
					exportResult: null,
					memory: null,
					observations: { consoleErrors: [], mainStderrTail: [], dialogTitle: null, elementCountFinal: null },
					failure: error instanceof Error ? error.message : String(error),
				},
			);
			break;
		}
		writeArtifact(args, facts, runs);
	}
	writeArtifact(args, facts, runs);
	log(`SUMMARY ${JSON.stringify(runs.map((r) => ({
		run: r.runIndex,
		coldOpenMs: r.coldOpen?.totalMs ?? null,
		zoomMs: r.interactions?.zoom.latencyMs ?? null,
		selectMs: r.interactions?.selection.latencyMs ?? null,
		panelMs: r.interactions?.panel.latencyMs ?? null,
		fps: r.playback?.fps ?? null,
		renderMs: r.exportResult?.renderPhaseMs ?? null,
		encodeMs: r.exportResult?.encodePhaseMs ?? null,
		totalExportMs: r.exportResult?.totalMs ?? null,
		rawPeakBytes: r.exportResult?.rawPeakBytes ?? null,
		outputBytes: r.exportResult?.outputBytes ?? null,
		exportOutcome: r.exportResult?.outcome ?? null,
		failure: r.failure,
	})))}`);
	logStepCode("harness", harnessCode);
	process.exit(harnessCode);
}

main().catch((error) => {
	console.error("EXPORT PERF BASELINE FAILED:", error?.stack ?? error);
	logStepCode("harness", 1);
	process.exit(1);
});
