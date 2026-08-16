/**
 * sdk-export-capability (D1/D2) — shared harness for the two export proof
 * scripts. Everything the real-app proofs need that is not the proof itself:
 * the minimal-env launch, the parity driver's editor/import primitives
 * (mirrored, not imported — the parity driver lives in another package's test
 * tree), the export panel reader, ffprobe/tasklist/sha256 helpers, and the
 * evidence collector that writes the run's markdown record.
 *
 * Env discipline (the §12 capture rule): `_electron.launch` REPLACES the
 * environment (probed: an explicit `env` wins wholesale — a marker variable
 * and a shrunk PATH came through verbatim), and Playwright/Electron then
 * layer the Windows essentials underneath (observed set: COMSPEC, HOMEDRIVE,
 * HOMEPATH, LOGONSERVER, PATH, PATHEXT, PROMPT, SYSTEMDRIVE, SYSTEMROOT,
 * TEMP, TMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR). This module passes
 * ONLY the run's four opencut variables — never `...process.env` — so every
 * scratch root and the ffmpeg binary are the harness's explicit choices.
 *
 * Exit-code discipline: every external command this harness spawns is run
 * through `cmd()`, which always logs `REAL_EXIT_CODE[<step>]:<code>`.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
	createHash,
} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const require = createRequire(import.meta.url);
export const here = dirname(fileURLToPath(import.meta.url));
export const appRoot = join(here, "..");
export const worktreeRoot = join(appRoot, "..", "..");
export const mainPath = join(appRoot, "electron", "main.cjs");
export const electronBinary = require("electron");

export const FFPROBE = "E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe";
export const FFMPEG = "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe";
export const FIXTURE_DIR = join(
	worktreeRoot,
	"apps",
	"vite-example",
	"tests",
	"fixtures",
);
export const FIXTURE_IMAGE = join(FIXTURE_DIR, "fixture-image.png");
export const FIXTURE_TONE_A4 = join(FIXTURE_DIR, "fixture-tone-a4.wav");

/** The parity driver's host-neutral editor selectors (tests/parity/driver.ts). */
export const MAIN_TRACK = 'button[aria-label="Select Main Track track"]';
export const TIMECODE = 'button[title="Click to edit time"]';

/** A ffmpeg-free PATH for the negative launch (the auto PATH carries ffmpeg). */
export const FFMPEG_FREE_PATH = "C:\\Windows\\system32;C:\\Windows";

// -- evidence collector -------------------------------------------------------

export function evidenceCollector(outDir) {
	const lines = [];
	return {
		line(text) {
			lines.push(text);
		},
		code(text) {
			lines.push("", "```", text.replace(/\s+$/, ""), "```");
		},
		heading(text) {
			lines.push("", "## " + text, "");
		},
		/**
		 * Write the run's markdown record. `append: true` concatenates onto the
		 * existing file (multi-invocation runs: one phase per process so the app
		 * is fully torn down between phases — the freeze-era hard rule) instead
		 * of replacing it.
		 */
		async flush(file, options = {}) {
			mkdirSync(outDir, { recursive: true });
			const body = lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
			// LF discipline: normalize whatever the host wrote, then verify.
			const target = join(outDir, file);
			const { writeFileSync } = await import("node:fs");
			let final = body;
			if (options.append === true && existsSync(target)) {
				const existing = readFileSync(target, "utf8");
				final = `${existing.replace(/\r\n/g, "\n").replace(/\n+$/, "\n")}\n${body}`;
			}
			writeFileSync(target, final.replace(/\r\n/g, "\n"), "utf8");
			const crCount = readFileSync(target, "utf8").split("\r").length - 1;
			if (crCount !== 0) {
				throw new Error(`${target} carries ${crCount} CR bytes after write`);
			}
			return target;
		},
	};
}

// -- command runner (exit-code discipline) -------------------------------------

export function cmd(step, command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: options.timeoutMs ?? 120_000,
		cwd: options.cwd ?? worktreeRoot,
		maxBuffer: 64 * 1024 * 1024,
	});
	const code = result.status;
	console.log(`REAL_EXIT_CODE[${step}]:${code === null ? "null" : code}`);
	if (result.error) console.log(`  ${step} spawn error: ${result.error.message}`);
	return {
		code,
		ok: code === 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

// -- assertion ledger ----------------------------------------------------------

export function makeGates() {
	const gates = [];
	return {
		gate(name, ok, detail = "") {
			gates.push({ name, ok: Boolean(ok), detail });
			console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
			return Boolean(ok);
		},
		failures() {
			return gates.filter((entry) => !entry.ok);
		},
		all() {
			return gates;
		},
	};
}

// -- launch / drive ------------------------------------------------------------

/**
 * The minimal launch env. Playwright replaces the whole environment with this
 * object (probed), then layers the Windows essentials; every explicit key
 * wins. `ffmpegPath: null` + `pathOverride` is the negative configuration.
 */
export function launchEnv({ storeRoot, exportsRoot, ffmpegPath, pathOverride }) {
	const env = {
		SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows",
		OPENCUT_STORE_ROOT: storeRoot,
		OPENCUT_EXPORT_ROOT: exportsRoot,
	};
	if (ffmpegPath !== null) env.OPENCUT_FFMPEG_PATH = ffmpegPath;
	if (pathOverride !== undefined) env.PATH = pathOverride;
	return env;
}

export async function launchHost(env, { gpu = "swiftshader" } = {}) {
	// `gpu: "real"` drops the swiftshader overrides so the export renders on
	// the machine's actual GPU — the D2 real-GPU vs swiftshader cost probe.
	const gpuArgs =
		gpu === "real" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
	const app = await electron.launch({
		executablePath: electronBinary,
		args: [mainPath, ...gpuArgs],
		env,
	});
	const page = await app.firstWindow();
	const consoleErrors = [];
	/**
	 * Main-process stdout/stderr capture (D2 v2 forensic patch): the
	 * ExportJobManager's log lines, producer-window spawn errors, and ffmpeg
	 * spawn failures all land here — the channel attempt 1's failure escaped
	 * through. Attached best-effort: a null stream degrades to an empty tail.
	 */
	const mainOutput = [];
	try {
		const proc = app.process();
		const attach = (stream, tag) => {
			stream?.on("data", (chunk) => {
				for (const line of chunk.toString("utf8").split(/\r?\n/)) {
					if (line.length > 0) mainOutput.push(`${tag} ${line}`);
				}
			});
		};
		attach(proc.stdout, "[main-out]");
		attach(proc.stderr, "[main-err]");
	} catch {
		// No streams on this transport — the failed-settle dump notes the gap.
	}
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
	return { app, page, consoleErrors, mainOutput };
}

/** The parity driver's editor-on-screen wait (host-neutral selectors). */
export async function waitForEditor(page, timeoutMs = 300_000) {
	await page.locator(MAIN_TRACK).first().waitFor({ timeout: timeoutMs });
	await page.locator(TIMECODE).first().waitFor({ timeout: timeoutMs });
}

/** Dismiss and report the first-run onboarding dialog (parity policy). */
export async function dismissOnboarding(page) {
	const dialog = page.locator('[role="dialog"]').first();
	if (!(await dialog.isVisible().catch(() => false))) return null;
	const title = ((await dialog.textContent()) ?? "").trim().slice(0, 120);
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden", timeout: 30_000 });
	return title;
}

/** Create a project through the picker; returns the project id from the URL. */
export async function createProjectViaPicker(page) {
	await page.getByRole("button", { name: "New project" }).waitFor({ timeout: 120_000 });
	await page.getByRole("button", { name: "New project" }).click();
	const search = await page
		.waitForFunction(() => window.location.search.includes("project="), null, {
			timeout: 60_000,
		})
		.then((handle) => handle.evaluate(() => window.location.search));
	return new URLSearchParams(search).get("project");
}

/** Open an existing project by clicking its picker row. */
export async function openProjectFromPicker(page, nameFragment) {
	const row = page
		.locator('[data-testid="project-row"]')
		.filter({ hasText: nameFragment })
		.first();
	await row.waitFor({ timeout: 120_000 });
	await row.click();
	await waitForEditor(page);
	return dismissOnboarding(page);
}

/**
 * Import through the assets panel's always-mounted hidden file input — the
 * parity driver's Electron branch (the native chooser never surfaces for
 * Playwright in Electron). `multiple` is set imperatively, exactly as
 * `openFilePicker` does, then one `setInputFiles` produces the same change
 * event the intercepted chooser produces on the browser hosts.
 */
export async function importFiles(page, files) {
	const input = page.locator('input[type="file"]').first();
	await input.evaluate((element) => {
		element.multiple = true;
	});
	await input.setInputFiles(files);
}

/** The assets-panel card for an imported asset, located by its label title. */
export function assetCard(page, name) {
	return page
		.locator("div.group")
		.filter({ has: page.locator(`[title="${name}"]`) })
		.first();
}

/** Click a card's hover-revealed "add to timeline" plus button (parity). */
export async function addToTimeline(page, name) {
	const card = assetCard(page, name);
	await card.scrollIntoViewIfNeeded();
	await card.hover();
	await card.locator("button").first().click();
}

/** Focus the editor surface root before a shortcut (parity discipline). */
export async function pressShortcut(page, key) {
	const surface = page.locator("[data-editor-surface]").first();
	await surface.focus();
	await page.keyboard.press(key);
	await page.waitForTimeout(300);
}

/** Autosave debounce is 800 ms; wait past it before reading storage. */
export async function settleAutosave(page) {
	await page.waitForTimeout(2_000);
}

// -- persisted record (the page's own store bridge) -----------------------------

const TICKS_PER_SECOND = 120_000;

/**
 * Read the project record through the page's own `opencutStore` bridge and
 * derive the export-relevant facts: every placed element (name, track kind,
 * start, duration) and the timeline's total extent in ticks.
 */
export async function readProjectFacts(page, projectId) {
	return page.evaluate(
		async ({ id }) => {
			const store = window.opencutStore;
			const stored = await store.loadRecord(id);
			if (stored === null) return null;
			const data = stored.record.data;
			const scene = data.scenes[0];
			const elements = [];
			const collect = (kind, track, trackName) => {
				for (const element of track?.elements ?? []) {
					elements.push({
						name: element.name ?? "",
						kind,
						trackName: trackName ?? "",
						startTime: element.startTime ?? 0,
						duration: element.duration ?? 0,
					});
				}
			};
			collect("visual-main", scene.tracks.main, scene.tracks.main?.name);
			for (const track of scene.tracks.overlay ?? []) collect("visual-overlay", track, track.name);
			for (const track of scene.tracks.audio ?? []) collect("audio", track, track.name);
			const extentTicks = elements.reduce(
				(max, element) => Math.max(max, element.startTime + element.duration),
				0,
			);
			return {
				projectId: id,
				name: data.metadata?.name ?? "",
				metadataDurationTicks: data.metadata?.duration ?? null,
				fps: data.settings?.fps ?? null,
				canvas: data.settings?.canvasSize ?? null,
				elements,
				extentTicks,
			};
		},
		{ id: projectId },
	);
}

// -- the export panel -----------------------------------------------------------

const PANEL = '[data-testid="export-panel"]';

/** One DOM readout of the panel: every value the proofs assert on. */
export async function readPanel(page) {
	return page.evaluate((selector) => {
		const panel = document.querySelector(selector);
		if (panel === null) return { visible: false };
		const status = panel.querySelector('[data-testid="export-status"]')?.textContent ?? "";
		const output = panel.querySelector('[data-testid="export-output"]')?.textContent ?? "";
		const text = panel.textContent ?? "";
		const frames = /(\d+)\/(\d+) frames/.exec(text);
		const bytes = /(\d+(?:\.\d+)? (?:B|KB|MB))/.exec(text);
		return {
			visible: true,
			status: status.trim(),
			outputName: output.trim(),
			progress: Number(panel.querySelector('[data-testid="export-progress"]')?.getAttribute("aria-valuenow") ?? -1),
			accepted: frames ? Number(frames[1]) : null,
			total: frames ? Number(frames[2]) : null,
			bytesText: bytes ? bytes[1] : null,
			hasStart: panel.querySelector('[data-testid="export-start"]') !== null,
			hasCancel: panel.querySelector('[data-testid="export-cancel"]') !== null,
			interrupted: panel.querySelectorAll('[data-testid="export-interrupted"]').length,
			hasResume: panel.querySelector('[data-testid="export-resume"]') !== null,
			rawText: text.trim().slice(0, 400),
		};
	}, PANEL);
}

/** Set the idle form's options and click start. */
export async function startExportFromPanel(page, { format, quality, includeAudio }) {
	await page.locator(PANEL).waitFor({ timeout: 60_000 });
	await page.locator('[data-testid="export-start"]').waitFor({ timeout: 60_000 });
	if (format !== undefined) {
		await page.locator('[data-testid="export-format"]').selectOption(format);
	}
	if (quality !== undefined) {
		await page.locator('[data-testid="export-quality"]').selectOption(quality);
	}
	if (includeAudio !== undefined) {
		const box = page.locator('[data-testid="export-audio"]');
		const checked = await box.isChecked();
		if (checked !== includeAudio) await box.click();
	}
	await page.locator('[data-testid="export-start"]').click();
}

/** Clip a viewport screenshot to the panel's box (small evidence PNGs). */
export async function screenshotPanel(page, app, file) {
	const box = await page.locator(PANEL).first().boundingBox();
	if (box === null) {
		await page.screenshot({ path: file });
		return false;
	}
	await page.screenshot({
		path: file,
		clip: {
			x: Math.max(0, box.x - 8),
			y: Math.max(0, box.y - 8),
			width: Math.min(box.width + 16, 1920),
			height: Math.min(box.height + 16, 1080),
		},
	});
	return true;
}

/**
 * Sample the panel until it settles (complete/failed/cancelled view). Records
 * only CHANGING samples (value transitions) plus the first sample in each
 * phase — the series stays honest for timing evidence without hundreds of
 * duplicate rows. `onSample` sees every raw sample for side observations.
 */
export async function sampleUntilSettled(page, app, { intervalMs, timeoutMs, onSample }) {
	const startedAt = Date.now();
	const series = [];
	let lastKey = null;
	for (;;) {
		const sample = await readPanel(page).catch(() => null);
		if (sample === null) {
			if (Date.now() - startedAt > timeoutMs) throw new Error("panel disappeared before settling");
		} else {
			const elapsedS = (Date.now() - startedAt) / 1000;
			const entry = {
				t: Number(elapsedS.toFixed(2)),
				status: sample.status,
				progress: sample.progress,
				accepted: sample.accepted,
				total: sample.total,
			};
			const key = `${sample.status}|${sample.progress}|${sample.accepted ?? "-"}`;
			if (key !== lastKey) {
				series.push(entry);
				lastKey = key;
			}
			await onSample?.(sample, elapsedS);
			const settled =
				sample.status.startsWith("Export complete") ||
				sample.status.startsWith("Export failed") ||
				sample.status.startsWith("Export cancelled");
			if (settled) return { series, settled: sample, elapsedS };
		}
		if (Date.now() - startedAt > timeoutMs) {
			return { series, settled: null, elapsedS: (Date.now() - startedAt) / 1000 };
		}
		await page.waitForTimeout(intervalMs);
	}
}

// -- ffprobe / fingerprint / process helpers -------------------------------------

export function ffprobeJson(step, file, extraArgs = []) {
	const run = cmd(step, FFPROBE, [
		"-v",
		"error",
		...extraArgs,
		"-show_streams",
		"-show_format",
		"-of",
		"json",
		file,
	]);
	let json = null;
	try {
		json = JSON.parse(run.stdout);
	} catch {
		// Reported as a failed gate by the caller; keep the raw output.
	}
	return { ...run, json };
}

export function sha256File(file) {
	const hash = createHash("sha256");
	const bytes = readFileSync(file);
	hash.update(bytes);
	return { sha256: hash.digest("hex"), bytes: bytes.byteLength };
}

/** Count live ffmpeg.exe processes (tasklist, image-name filter). */
export function tasklistFfmpeg(step) {
	const run = cmd(step, "tasklist", ["/FI", "IMAGENAME eq ffmpeg.exe"]);
	const matches = run.stdout.match(/^ffmpeg\.exe/gm) ?? [];
	return { ...run, count: matches.length };
}

/** Best-effort ffmpeg parent-pid observation via CIM (needs PowerShell). */
export function ffmpegParentPid(step) {
	const run = cmd(step, "powershell", [
		"-NoProfile",
		"-Command",
		"Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
	]);
	if (run.code !== 0 || run.stdout.trim() === "") return { caught: false, ...run };
	try {
		const parsed = JSON.parse(run.stdout);
		const rows = Array.isArray(parsed) ? parsed : [parsed];
		return { caught: rows.length > 0, rows, ...run };
	} catch {
		return { caught: false, ...run };
	}
}

// -- dual-source progress (D2 v2) --------------------------------------------------

/**
 * The parallel-run crash vocabulary (swiftshader + wasm `unreachable` +
 * GPU-process death) that killed the interactive page in the v1 era —
 * recognized so evidence can name what killed a page instead of guessing.
 */
const CRASH_SIGNATURE = /unreachable|opencut_wasm|Parking not supported|GPU process/i;

/** Which captured console lines match the known crash signature. */
export function crashSignatureIn(consoleErrors) {
	return consoleErrors.filter((line) => CRASH_SIGNATURE.test(line));
}

/** Plain timer sleep — no page dependency (`page.waitForTimeout` dies with
 * the page; that abort is v1's recorded failure mode). */
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the job record file under `<exportsRoot>/jobs` — the durable progress
 * source that survives interactive-page death. The manager persists the
 * record after EVERY transition (queued → rendering, each frame batch,
 * encoding progress, settlement), and its atomic temp-sibling + rename
 * discipline means a read always sees a complete file; `.tmp-` siblings are
 * skipped by name.
 */
export function readJobRecord(exportsRoot) {
	const jobsDir = join(exportsRoot, "jobs");
	let names;
	try {
		names = readdirSync(jobsDir);
	} catch {
		return null;
	}
	const candidates = names.filter(
		(name) => name.endsWith(".json") && !name.includes(".tmp-"),
	);
	if (candidates.length === 0) return null;
	let best = null;
	for (const name of candidates) {
		const full = join(jobsDir, name);
		const mtime = statSync(full).mtimeMs;
		if (best === null || mtime > best.mtime) best = { name, full, mtime };
	}
	try {
		const parsed = JSON.parse(readFileSync(best.full, "utf8"));
		if (parsed?.kind !== "opencut-export-job") return null;
		return {
			file: best.name,
			jobId: parsed.jobId,
			phase: parsed.phase,
			progress: parsed.progress,
			acceptedFrames: parsed.acceptedFrames,
			totalFrames: parsed.totalFrames,
			error: parsed.error ?? null,
			outputName: parsed.outputName ?? null,
		};
	} catch {
		return null; // mid-rename race; the next tick sees the settled file
	}
}

/**
 * One DOM readout attempt. `dead: true` means the page/context is gone (v1's
 * death mode); a transient evaluate failure without closure is a miss, not a
 * death.
 */
export async function readPanelOrDead(page) {
	try {
		if (page.isClosed()) return { dead: true, sample: null };
		return { dead: false, sample: await readPanel(page) };
	} catch (error) {
		const text = String(error?.message ?? error);
		const closed = /closed|Target closed|crash/i.test(text);
		return {
			dead: closed || page.isClosed(),
			sample: null,
			error: closed ? text : undefined,
		};
	}
}

/**
 * Sample BOTH progress sources until the job settles: the panel DOM (v1's
 * only source — dies with the interactive page) and the job record file (the
 * durable fallback). Termination requires the RECORD to reach a settled
 * phase AND the DOM to settle or die (with a 10s grace so a lagging panel
 * cannot hang the proof); a timeout returns both series unfinalized for the
 * honest RED.
 */
export async function sampleDualUntilSettled(
	page,
	app,
	exportsRoot,
	{ intervalMs, timeoutMs, onSample },
) {
	const startedAt = Date.now();
	const domSeries = [];
	const recordSeries = [];
	let domDead = false;
	let domDiedAtS = null;
	let lastDomKey = null;
	let lastRecordKey = null;
	let domSettled = null;
	let recordSettled = null;
	let recordSettledAtS = null;
	for (;;) {
		const elapsedS = (Date.now() - startedAt) / 1000;
		const dom = domDead
			? { dead: true, sample: null }
			: await readPanelOrDead(page);
		if (dom.dead && !domDead) {
			domDead = true;
			domDiedAtS = elapsedS;
		}
		const record = readJobRecord(exportsRoot);
		if (dom.sample !== null) {
			const entry = {
				t: Number(elapsedS.toFixed(2)),
				status: dom.sample.status,
				progress: dom.sample.progress,
				accepted: dom.sample.accepted,
				total: dom.sample.total,
			};
			const key = `${entry.status}|${entry.progress}|${entry.accepted ?? "-"}`;
			if (key !== lastDomKey) {
				domSeries.push(entry);
				lastDomKey = key;
			}
			const settledStatus =
				entry.status.startsWith("Export complete") ||
				entry.status.startsWith("Export failed") ||
				entry.status.startsWith("Export cancelled");
			if (settledStatus && domSettled === null) domSettled = dom.sample;
		}
		if (record !== null) {
			const entry = {
				t: Number(elapsedS.toFixed(2)),
				phase: record.phase,
				progress: record.progress,
				accepted: record.acceptedFrames,
				total: record.totalFrames,
			};
			const key = `${entry.phase}|${entry.accepted ?? "-"}`;
			if (key !== lastRecordKey) {
				recordSeries.push(entry);
				lastRecordKey = key;
			}
			const settledPhase =
				entry.phase === "completed" ||
				entry.phase === "failed" ||
				entry.phase === "cancelled";
			if (settledPhase && recordSettled === null) {
				recordSettled = record;
				recordSettledAtS = elapsedS;
			}
		}
		await onSample?.({ domSample: dom.sample, record, elapsedS, domDead });
		const recordDone = recordSettled !== null;
		const domDone = domSettled !== null || domDead;
		const gracePast =
			recordSettledAtS !== null && elapsedS - recordSettledAtS > 10;
		if (recordDone && (domDone || gracePast)) {
			return {
				domSeries,
				recordSeries,
				domSettled,
				recordSettled,
				domDead,
				domDiedAtS,
				elapsedS,
			};
		}
		if (Date.now() - startedAt > timeoutMs) {
			return {
				domSeries,
				recordSeries,
				domSettled,
				recordSettled,
				domDead,
				domDiedAtS,
				elapsedS: (Date.now() - startedAt) / 1000,
			};
		}
		await sleep(intervalMs);
	}
}

/**
 * Poll rendering progress from whichever source is alive (DOM first, record
 * file as the fallback) until `predicate` accepts. For the cancel and kill
 * windows — robust against the interactive page dying mid-window.
 */
export async function pollProgressDual(
	page,
	exportsRoot,
	predicate,
	timeoutMs,
	label,
) {
	const startedAt = Date.now();
	for (;;) {
		const dom = await readPanelOrDead(page).catch(() => ({
			dead: true,
			sample: null,
		}));
		const record = readJobRecord(exportsRoot);
		const domRendering =
			dom.sample !== null &&
			dom.sample.status.startsWith("Rendering") &&
			dom.sample.accepted !== null
				? {
						source: "dom",
						accepted: dom.sample.accepted,
						total: dom.sample.total,
						progress: dom.sample.progress,
					}
				: null;
		const recordRendering =
			record !== null &&
			record.phase === "rendering" &&
			record.acceptedFrames !== null &&
			record.totalFrames !== null
				? {
						source: "record",
						accepted: record.acceptedFrames,
						total: record.totalFrames,
						progress: record.progress,
					}
				: null;
		const sample = domRendering ?? recordRendering;
		if (sample !== null && predicate(sample)) {
			return { ...sample, waitedMs: Date.now() - startedAt };
		}
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(
				`window predicate ${label} not reached in ${timeoutMs}ms (last dom: ${JSON.stringify(dom.sample?.status ?? null)}, record: ${JSON.stringify(record)})`,
			);
		}
		await sleep(400);
	}
}

// -- stray-process sweep (D2 v2 step 4) ---------------------------------------------

/**
 * Electron/ffmpeg processes whose command line ties them to this worktree
 * (`electron.exe` runs the worktree's node_modules binary; `node.exe` is
 * deliberately excluded — the driver itself matches the fragment). Returns
 * the rows; killing is the caller's explicit choice.
 */
export function strayProcessSweep(step, pathFragment) {
	const script =
		`Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='ffmpeg.exe'" | ` +
		`Where-Object { $_.CommandLine -like '*${pathFragment}*' } | ` +
		`Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
	const run = cmd(step, "powershell", ["-NoProfile", "-Command", script]);
	let rows = [];
	const text = run.stdout.trim();
	if (text !== "") {
		try {
			const parsed = JSON.parse(text);
			rows = Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			rows = [];
		}
	}
	return { ...run, rows, count: rows.length };
}

/** Force-kill exactly the pids the sweep returned (only ever ours). */
export function killStrayPids(step, pids) {
	if (pids.length === 0) return { code: 0, ok: true, stdout: "(nothing to kill)", stderr: "" };
	const script = pids
		.map((pid) => `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue;`)
		.join(" ");
	return cmd(step, "powershell", ["-NoProfile", "-Command", script]);
}

/** Count live processes of one image name (tasklist corroboration). */
export function tasklistImage(step, image) {
	const run = cmd(step, "tasklist", ["/FI", `IMAGENAME eq ${image}`]);
	const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const matches = run.stdout.match(new RegExp(`^${escaped}`, "gm")) ?? [];
	return { ...run, count: matches.length };
}

// -- disk hygiene ----------------------------------------------------------------

export function ensureDir(path) {
	mkdirSync(path, { recursive: true });
}

export function listDir(path) {
	try {
		return readdirSync(path);
	} catch {
		return null;
	}
}

export function fileSize(path) {
	try {
		return statSync(path).size;
	} catch {
		return null;
	}
}

export function removeDir(path) {
	if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

export { join, existsSync, readFileSync };
