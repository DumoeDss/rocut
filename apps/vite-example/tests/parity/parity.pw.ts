import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import * as drive from "./driver";
import { HOST, HOST_PROFILE } from "./host-profile";
import { normalize, readPersisted, summarizeTracks } from "./snapshot";

/**
 * The §3.3 editing-parity scenario, run against a **production** build of
 * whichever host `PARITY_HOST` selects.
 *
 * The rule this file is written to (task 9.6): an interaction with neither an
 * assertion nor a capture is not evidence. Every one of the nine interactions
 * therefore records what was actually asserted and what was only captured, and
 * the run fails if any of them ends up with neither. Interactions do not abort
 * the run when they fail — a failed step still produces a ledger entry, because
 * "we could not drive this" is a finding worth reporting, not a reason to have
 * no record.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "../fixtures");
const OUT_DIR = resolve(HERE, "../parity-artifacts", HOST);

const IMAGE = "fixture-image.png";
const VIDEO = "fixture-video.mp4";
const TONE_A = "fixture-tone-a4.wav";
const TONE_B = "fixture-tone-a5.wav";
const FIXTURES = [IMAGE, VIDEO, TONE_A, TONE_B].map((name) =>
	resolve(FIXTURE_DIR, name),
);

interface Interaction {
	id: string;
	title: string;
	asserted: string[];
	captured: string[];
	notes: string[];
	error: string | null;
}

const ledger: Interaction[] = [];
const blockedRequests: string[] = [];

function begin(id: string, title: string): Interaction {
	const entry: Interaction = {
		id,
		title,
		asserted: [],
		captured: [],
		notes: [],
		error: null,
	};
	ledger.push(entry);
	return entry;
}

async function capture(
	page: Page,
	entry: Interaction,
	name: string,
): Promise<void> {
	const file = `${name}.png`;
	await page.screenshot({ path: resolve(OUT_DIR, file), fullPage: false });
	entry.captured.push(file);
}

/** Runs a step, recording its failure instead of aborting the whole scenario. */
async function step(
	entry: Interaction,
	body: () => Promise<void>,
): Promise<boolean> {
	try {
		await body();
		return true;
	} catch (error) {
		entry.error = error instanceof Error ? error.message : String(error);
		return false;
	}
}

test.describe.configure({ mode: "serial" });

test(`editing parity scenario — ${HOST} host`, async ({ page, baseURL }) => {
	mkdirSync(OUT_DIR, { recursive: true });
	const origin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;

	// Task 9.4 — first-party only. Everything off-origin is aborted, so this run
	// doubles as the §3.7 network-blocked evidence: whatever the editor needs
	// from a third party either degrades visibly or the scenario fails here.
	await page.route("**/*", async (route) => {
		const url = route.request().url();
		if (url.startsWith(origin) || url.startsWith("data:")) {
			await route.continue();
			return;
		}
		blockedRequests.push(url);
		await route.abort();
	});

	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

	// ---------------------------------------------------------------- 1. create
	const create = begin("create-open", "Create and open a project");
	await step(create, async () => {
		await page.goto(HOST_PROFILE.entryPath);
		await HOST_PROFILE.createProject(page);
		await drive.waitForEditor(page);
		await expect(page.locator(drive.MAIN_TRACK).first()).toBeVisible();
		create.asserted.push("editor chrome (main track + timecode) is on screen");
		const dialog = await drive.dismissOnboarding(page);
		create.notes.push(
			dialog === null
				? "no modal dialog on first open"
				: `dismissed a modal on first open: "${dialog}"`,
		);

		await drive.settleAutosave(page);
		const raw = await readPersisted(page);
		expect(raw.project).toBeTruthy();
		create.asserted.push("a project record exists in video-editor-projects");
	});
	await capture(page, create, "01-editor-open");

	// ---------------------------------------------------------------- 2. import
	const importStep = begin(
		"import-media",
		"Import image, video and two audio assets",
	);
	await step(importStep, async () => {
		await drive.importFixtures(page, FIXTURES);
		for (const name of [IMAGE, VIDEO, TONE_A, TONE_B]) {
			await expect(drive.assetCard(page, name)).toBeVisible({
				timeout: 180_000,
			});
		}
		importStep.asserted.push("all four assets appear in the assets panel");

		await drive.settleAutosave(page);
		const raw = await readPersisted(page);
		const names = (raw.media as { name?: string }[]).map((m) => m.name).sort();
		expect(names).toEqual([IMAGE, TONE_A, TONE_B, VIDEO].sort());
		importStep.asserted.push(
			"all four assets are persisted in media-metadata with their names",
		);
	});
	await capture(page, importStep, "02-assets-imported");

	// ----------------------------------------------------------------- 3. place
	const place = begin(
		"place-multi-track",
		"Place clips on >=2 visual and >=2 audio tracks",
	);
	await step(place, async () => {
		for (const name of [IMAGE, VIDEO, TONE_A, TONE_B]) {
			// Home returns the playhead to 0 so each clip is added at the same time
			// and the placement resolver is forced to open a new track rather than
			// appending to the existing one.
			await drive.pressShortcut(page, "Home");
			await drive.addToTimeline(page, name);
			await page.waitForTimeout(800);
		}
		await drive.settleAutosave(page);

		const raw = await readPersisted(page);
		const summary = summarizeTracks(raw.project);
		place.notes.push(
			`tracks: ${summary.tracks
				.map((t) => `${t.kind}[${t.elements.join(", ")}]`)
				.join(" | ")}`,
		);
		const visualWithClips = summary.tracks.filter(
			(t) => !t.kind.startsWith("audio") && t.elements.length > 0,
		).length;
		const audioWithClips = summary.tracks.filter(
			(t) => t.kind.startsWith("audio") && t.elements.length > 0,
		).length;
		expect(visualWithClips).toBeGreaterThanOrEqual(2);
		expect(audioWithClips).toBeGreaterThanOrEqual(2);
		place.asserted.push(
			`${visualWithClips} visual and ${audioWithClips} audio tracks carry clips (persisted)`,
		);
	});
	await capture(page, place, "03-clips-placed");

	// ------------------------------------------------------------------ 4. drag
	const drag = begin("drag", "Drag a clip along the timeline");
	await step(drag, async () => {
		const { before, after } = await drive.dragElementBy(page, VIDEO, 160);
		expect(after.x).toBeGreaterThan(before.x + 80);
		drag.asserted.push(
			`clip moved ${Math.round(after.x - before.x)}px right (requested 160px)`,
		);

		await drive.settleAutosave(page);
		const raw = await readPersisted(page);
		const video = findPersistedElement(raw.project, VIDEO);
		expect(video?.startTime ?? 0).toBeGreaterThan(0);
		drag.asserted.push(
			`persisted startTime is now ${video?.startTime} (was 0)`,
		);
	});
	await capture(page, drag, "04-after-drag");

	// ------------------------------------------------------------------ 5. trim
	const trim = begin("trim", "Trim a clip by its resize handle");
	await step(trim, async () => {
		// The 2 s tone, not the 5 s image: at this zoom a 5 s clip is wider than
		// the window, so its right handle sits outside the viewport and cannot be
		// grabbed. Trimming what is reachable is a real trim; aiming off-screen
		// would have produced a false "trim is broken".
		const { before, after } = await drive.trimElement(page, TONE_A, "right", -90);
		expect(after.width).toBeLessThan(before.width - 40);
		trim.asserted.push(
			`clip width ${Math.round(before.width)}px -> ${Math.round(after.width)}px`,
		);

		await drive.settleAutosave(page);
		const raw = await readPersisted(page);
		const tone = findPersistedElement(raw.project, TONE_A);
		expect(tone).toBeTruthy();
		expect(
			(tone?.trimEnd ?? 0) > 0 ||
				(tone?.duration ?? 0) < (tone?.sourceDuration ?? Number.POSITIVE_INFINITY),
		).toBe(true);
		trim.asserted.push(
			`persisted trim: duration=${tone?.duration} trimStart=${tone?.trimStart} trimEnd=${tone?.trimEnd}`,
		);
	});
	await capture(page, trim, "05-after-trim");

	// ----------------------------------------------------------------- 6. split
	const split = begin("split", "Split a clip at the playhead");
	await step(split, async () => {
		const beforeRaw = await readPersisted(page);
		const beforeCount = countPersistedElements(beforeRaw.project, VIDEO);

		const box = await drive.clickElement(page, VIDEO);
		const timecode = await drive.scrubToX(page, box.x + box.width / 2);
		split.notes.push(`playhead moved to ${timecode} before splitting`);
		await drive.pressShortcut(page, "s");
		await drive.settleAutosave(page);

		const afterRaw = await readPersisted(page);
		const afterCount = countPersistedElements(afterRaw.project, VIDEO);
		expect(afterCount).toBe(beforeCount + 1);
		split.asserted.push(
			`clips derived from ${VIDEO}: ${beforeCount} -> ${afterCount}`,
		);
	});
	await capture(page, split, "06-after-split");

	// ------------------------------------------------------------------ 7. snap
	const snap = begin("snap", "Snap a clip to a neighbouring clip edge");
	await step(snap, async () => {
		// Snap the 3 s tone's left edge to the (now trimmed) 2 s tone's right edge.
		// Both clips are on their own audio tracks, so the move cannot be rejected
		// as an overlap, and both edges are inside the viewport.
		const toneA = await drive.findElement(page, TONE_A);
		const target = toneA.x + toneA.width;
		const toneB = await drive.findElement(page, TONE_B);
		// Land 6px short of the edge — inside the editor's 10px snap threshold,
		// but far enough that landing exactly on the edge cannot be a coincidence.
		const dx = target - toneB.x - 6;

		let indicatorSeen = false;
		const { after } = await drive.dragElementBy(page, TONE_B, dx, {
			grabOffsetPx: 10,
			whileDragging: async () => {
				indicatorSeen = await page
					.locator(drive.SNAP_INDICATOR)
					.first()
					.isVisible()
					.catch(() => false);
				await page.screenshot({
					path: resolve(OUT_DIR, "07-snap-mid-drag.png"),
				});
			},
		});
		snap.captured.push("07-snap-mid-drag.png");
		snap.notes.push(
			`snap indicator visible mid-drag: ${indicatorSeen}; landed ${(
				after.x - target
			).toFixed(2)}px from the neighbour edge (dropped 6px short)`,
		);

		expect(indicatorSeen).toBe(true);
		snap.asserted.push("the snap indicator was rendered during the drag");
		expect(Math.abs(after.x - target)).toBeLessThanOrEqual(2);
		snap.asserted.push(
			"the clip landed on the neighbour edge, not where the pointer released",
		);
	});
	await capture(page, snap, "07-after-snap");

	// ----------------------------------------------------------------- 8. scrub
	const scrub = begin("scrub", "Scrub the playhead on the ruler");
	await step(scrub, async () => {
		const ruler = await drive.rulerVisibleBox(page);
		await drive.pressShortcut(page, "Home");
		const atStart = await drive.readTimecode(page);
		const atQuarter = await drive.scrubToX(page, ruler.x + ruler.width * 0.25);
		const atHalf = await drive.scrubToX(page, ruler.x + ruler.width * 0.5);
		scrub.notes.push(`timecodes: ${atStart} -> ${atQuarter} -> ${atHalf}`);
		expect(atQuarter).not.toBe(atStart);
		expect(atHalf).not.toBe(atQuarter);
		expect(atHalf > atQuarter).toBe(true);
		scrub.asserted.push(
			"the displayed timecode advances monotonically with ruler position",
		);
	});
	await capture(page, scrub, "08-after-scrub");

	// ------------------------------------------------------------------ 9. play
	const play = begin("play", "Play the preview and pause it");
	await step(play, async () => {
		await drive.pressShortcut(page, "Home");
		const before = await drive.readTimecode(page);
		await drive.pressShortcut(page, "Space");
		await page.waitForTimeout(1500);
		const during = await drive.readTimecode(page);
		await drive.pressShortcut(page, "Space");
		await page.waitForTimeout(500);
		const after = await drive.readTimecode(page);
		play.notes.push(`timecode ${before} -> ${during} (playing) -> ${after} (paused)`);
		expect(during).not.toBe(before);
		play.asserted.push("playback advances the timecode");
		const afterPause = await drive.readTimecode(page);
		expect(afterPause).toBe(after);
		play.asserted.push("pausing holds the timecode still");
	});
	await capture(page, play, "09-after-play");

	// ------------------------------------------- save -> reload -> reopen
	const persist = begin(
		"save-reload-reopen",
		"Save, full page reload, reopen with equivalent content",
	);
	let beforeSnapshot: ReturnType<typeof normalize> | null = null;
	let afterSnapshot: ReturnType<typeof normalize> | null = null;
	await step(persist, async () => {
		await drive.settleAutosave(page);
		beforeSnapshot = normalize(await readPersisted(page));

		await page.reload();
		await drive.waitForEditor(page);
		const reopenDialog = await drive.dismissOnboarding(page);
		if (reopenDialog !== null) {
			persist.notes.push(`modal on reopen: "${reopenDialog}"`);
		}
		await drive.settleAutosave(page);
		afterSnapshot = normalize(await readPersisted(page));

		expect(afterSnapshot.trackSummary).toEqual(beforeSnapshot.trackSummary);
		persist.asserted.push(
			"after a full reload the reopened project has identical tracks, clip order, placement and trims",
		);
	});
	await capture(page, persist, "10-after-reload");

	// Every IndexedDB the app actually owns after the run. Recorded in the ledger
	// rather than the compared snapshot, because database names embed the project
	// id and would diff as noise. It is here to answer a specific question: the
	// storage migration runner opens its projects database with a *positional*
	// call into an options-object constructor, so a database literally named
	// "undefined" appearing here is what a silently broken migration looks like.
	const databases = await readPersisted(page)
		.then((raw) => raw.databases)
		.catch(() => []);

	// ------------------------------------------------------------- artifacts
	const snapshot = afterSnapshot ?? beforeSnapshot;
	if (snapshot) {
		writeFileSync(
			resolve(OUT_DIR, `snapshot-${HOST}.json`),
			`${JSON.stringify(snapshot, null, 2)}\n`,
		);
	}
	writeFileSync(
		resolve(OUT_DIR, `ledger-${HOST}.json`),
		`${JSON.stringify(
			{
				host: HOST,
				baseURL,
				generatedAt: new Date().toISOString(),
				interactions: ledger.map((entry) => ({
					...entry,
					status:
						entry.asserted.length > 0
							? "asserted"
							: entry.captured.length > 0
								? "captured-only"
								: "missing",
				})),
				blockedThirdPartyRequests: [...new Set(blockedRequests)].sort(),
				consoleErrors,
				persistedDatabases: databases,
			},
			null,
			2,
		)}\n`,
	);

	const unevidenced = ledger.filter(
		(entry) => entry.asserted.length === 0 && entry.captured.length === 0,
	);
	expect(
		unevidenced.map((entry) => entry.id),
		"every interaction must carry an assertion or a capture",
	).toEqual([]);

	const failed = ledger.filter((entry) => entry.error !== null);
	expect(
		failed.map((entry) => `${entry.id}: ${entry.error}`),
		"no interaction may fail",
	).toEqual([]);
});

interface PersistedElement {
	name?: string;
	startTime?: number;
	duration?: number;
	trimStart?: number;
	trimEnd?: number;
	sourceDuration?: number;
}

function allPersistedElements(project: unknown): PersistedElement[] {
	const scenes =
		(project as { scenes?: { tracks?: Record<string, unknown> }[] })?.scenes ??
		[];
	const out: PersistedElement[] = [];
	for (const scene of scenes) {
		const tracks = scene.tracks as
			| {
					main?: { elements?: PersistedElement[] };
					overlay?: { elements?: PersistedElement[] }[];
					audio?: { elements?: PersistedElement[] }[];
				}
			| undefined;
		if (!tracks) continue;
		for (const track of [
			tracks.main,
			...(tracks.overlay ?? []),
			...(tracks.audio ?? []),
		]) {
			for (const element of track?.elements ?? []) out.push(element);
		}
	}
	return out;
}

function findPersistedElement(
	project: unknown,
	nameFragment: string,
): PersistedElement | undefined {
	return allPersistedElements(project).find((element) =>
		(element.name ?? "").includes(nameFragment),
	);
}

function countPersistedElements(
	project: unknown,
	nameFragment: string,
): number {
	return allPersistedElements(project).filter((element) =>
		(element.name ?? "").includes(nameFragment),
	).length;
}
