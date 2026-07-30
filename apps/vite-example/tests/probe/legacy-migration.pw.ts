import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { HOST } from "../parity/host-profile";
import {
	buildSeed,
	EL_A_AUDIO_NAME,
	EL_A_MEDIA,
	EL_A_MEDIA_NAME,
	EL_A_TEXT_CONTENT,
	EL_B_MEDIA,
	EL_B_MEDIA_NAME,
	MEDIA_A,
	MEDIA_B,
	PROJECT_A,
	PROJECT_A_NAME,
	PROJECT_B,
	PROJECT_B_NAME,
	PROJECT_C,
	PROJECTS_DB,
	PROJECTS_STORE,
	seedInPage,
	type SeedStore,
} from "./seed";

/**
 * The seeded-legacy-project migration probe.
 *
 * The parity fixture **cannot** produce this evidence: its scenario creates a
 * fresh project at the current schema version, so `currentVersion >=
 * targetVersion` holds and the runner does no work either before or after the
 * repair. An unchanged parity snapshot is therefore the *expected* result there
 * and says nothing about migration. This probe is the only artefact that can
 * speak to sites S1-S5, and it is written to **fail before the repair**: a probe
 * that passes pre-repair proves nothing.
 *
 * It runs through a config that spreads `playwright.config.ts`, so it inherits
 * that file's `--use-angle=swiftshader --enable-unsafe-swiftshader` launch args
 * from the same source rather than a copy. A GPU or SwiftShader is a hard
 * runtime requirement at this pin: without one the editor crashes to a blank
 * page in both hosts rather than degrading.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../probe-artifacts", HOST);
const MIGRATIONS_INDEX = resolve(
	HERE,
	"../../../web/src/services/storage/migrations/index.ts",
);

/**
 * Read `CURRENT_PROJECT_VERSION` out of the source rather than restating it.
 *
 * Importing the module would drag the whole migration chain — and the browser
 * APIs it reaches for — into the Node test process. Parsing the one constant
 * keeps the probe unable to drift from the source while importing nothing.
 */
function currentProjectVersionFromSource(): number {
	const source = readFileSync(MIGRATIONS_INDEX, "utf8");
	const match = /CURRENT_PROJECT_VERSION\s*=\s*(\d+)/.exec(source);
	if (!match) {
		throw new Error(
			`could not read CURRENT_PROJECT_VERSION from ${MIGRATIONS_INDEX}`,
		);
	}
	return Number(match[1]);
}

const CURRENT_VERSION = currentProjectVersionFromSource();

function editorPath(projectId: string): string {
	return HOST === "next"
		? `/editor/${projectId}`
		: `/?project=${encodeURIComponent(projectId)}`;
}

interface StoredRecord {
	[key: string]: unknown;
}

/** One sample of the runner's `MigrationProgress` channel, as the page saw it. */
interface MigrationReport {
	isMigrating?: unknown;
	fromVersion?: unknown;
	toVersion?: unknown;
	projectName?: unknown;
}

async function readProjectRecord(
	page: Page,
	projectId: string,
): Promise<StoredRecord | null> {
	return page.evaluate(
		async ({ db, store, id }) => {
			const open = (): Promise<IDBDatabase> =>
				new Promise((resolveDb, rejectDb) => {
					const request = indexedDB.open(db);
					request.onsuccess = () => resolveDb(request.result);
					request.onerror = () => rejectDb(request.error);
				});
			const database = await open();
			if (!database.objectStoreNames.contains(store)) {
				database.close();
				return null;
			}
			const record = await new Promise<unknown>((resolveRec) => {
				const request = database
					.transaction(store, "readonly")
					.objectStore(store)
					.get(id);
				request.onsuccess = () => resolveRec(request.result ?? null);
				request.onerror = () => resolveRec(null);
			});
			database.close();
			return (record as StoredRecord) ?? null;
		},
		{ db: PROJECTS_DB, store: PROJECTS_STORE, id: projectId },
	);
}

async function listDatabases(page: Page): Promise<string[]> {
	return page.evaluate(async () =>
		(await indexedDB.databases())
			.map((info) => info.name ?? "<unnamed>")
			.sort(),
	);
}

/** Every nested object that carries both an `id` and a `type`, i.e. an element. */
function collectElements(value: unknown, out: StoredRecord[] = []): StoredRecord[] {
	if (Array.isArray(value)) {
		for (const entry of value) collectElements(entry, out);
		return out;
	}
	if (value && typeof value === "object") {
		const record = value as StoredRecord;
		if (typeof record.id === "string" && typeof record.type === "string") {
			out.push(record);
		}
		for (const entry of Object.values(record)) collectElements(entry, out);
	}
	return out;
}

/** Stable stringify, so "byte-unchanged" does not fail on key order alone. */
function canonical(value: unknown): string {
	const walk = (input: unknown): unknown => {
		if (Array.isArray(input)) return input.map(walk);
		if (input && typeof input === "object") {
			const out: Record<string, unknown> = {};
			for (const key of Object.keys(input as Record<string, unknown>).sort()) {
				out[key] = walk((input as Record<string, unknown>)[key]);
			}
			return out;
		}
		return input;
	};
	return JSON.stringify(walk(value));
}

test.describe.configure({ mode: "serial" });

test(`seeded legacy project reaches the current version — ${HOST} host`, async ({
	page,
	baseURL,
}) => {
	mkdirSync(OUT_DIR, { recursive: true });
	const origin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
	const seed: SeedStore[] = buildSeed({ currentVersion: CURRENT_VERSION });
	const findings: Record<string, unknown> = {
		host: HOST,
		baseURL,
		currentProjectVersion: CURRENT_VERSION,
		generatedAt: new Date().toISOString(),
	};

	// First-party only, exactly as the parity scenario does, so the probe cannot
	// pass or fail because of a third party or a machine-level proxy.
	await page.route("**/*", async (route) => {
		const url = route.request().url();
		if (url.startsWith(origin) || url.startsWith("data:")) {
			await route.continue();
			return;
		}
		await route.abort();
	});

	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) =>
		consoleErrors.push(`pageerror: ${error.message}`),
	);

	// The migration dialog is the *only* non-invasive view of the runner's
	// `MigrationProgress` channel: `MigrationDialog` renders `Upgrading "<name>"
	// from v<from> to v<to>` from it, and it is mounted on the editor surface of
	// both hosts. Observing it with a MutationObserver installed before any app
	// code runs catches it even though the runner's 1000 ms display floor makes it
	// brief; nothing in the editor source is patched to make this visible.
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __probeDialogTexts: string[] }).__probeDialogTexts =
			seen;
		const record = () => {
			for (const dialog of document.querySelectorAll('[role="dialog"]')) {
				const text = (dialog.textContent ?? "").trim();
				if (text.length > 0 && !seen.includes(text)) seen.push(text);
			}
		};
		const start = () => {
			record();
			new MutationObserver(record).observe(document.body, {
				childList: true,
				subtree: true,
				characterData: true,
			});
		};
		if (document.body) start();
		else document.addEventListener("DOMContentLoaded", start);
	});

	// The runner's `MigrationProgress` channel itself, observed at runtime rather
	// than read off `runner.ts`. The dialog above cannot supply this evidence — see
	// the assertions at the end of this test for why it can never render — so the
	// channel is sampled where it lands: `ProjectManager.migrationState`, which
	// `onProgress` assigns and `getMigrationState()` returns.
	//
	// Reaching that object needs the `EditorCore` singleton, and nothing exposes it
	// globally. It is held in a hook of `EditorProvider`, which calls
	// `useEditor((e) => e.project.getActiveOrNull())` at render and stays mounted
	// through the whole load, so the React fiber tree is a route to it that patches
	// no editor source. Duck-typing on `project.getMigrationState` rather than on a
	// hook index keeps this from depending on hook order.
	//
	// The cheaper hook — an `Object.prototype` accessor for `migrationState`,
	// installed before any app code — was rejected on evidence, not taste: Vite
	// emits the field as a constructor assignment (`this.migrationState = {...}`,
	// which a prototype setter intercepts) while Next emits a bare class-field
	// declaration (`class{...migrationState;...}`), which defines an own property
	// and shadows the accessor. That hook would report on Vite and silently observe
	// nothing on Next — the exact shape of a per-host false negative.
	//
	// Polling is sound rather than racy: `runStorageMigrations` holds `isMigrating:
	// true` for `max(elapsed, MIN_MIGRATION_DISPLAY_MS = 1000 ms)` across at most
	// two seeded legacy projects, so at least one report is exposed for ≥500 ms
	// against a 20 ms sample. Which of the two is *not* guaranteed: the display
	// floor sleeps **after** the loop, so B's payload is the reliably observable
	// one and A's is the overwritable one — a fast first project can be replaced
	// inside a single tick. Pinning "A" would have been flaky by construction and
	// would have read as a host difference, so the assertions accept either seeded
	// name and never pin the order. The completion payload is the most reliable of
	// all: nothing replaces it once the runner returns.
	await page.addInitScript(() => {
		interface ProbeFiber {
			return?: ProbeFiber | null;
			child?: ProbeFiber | null;
			sibling?: ProbeFiber | null;
			memoizedState?: unknown;
		}
		interface ProbeHook {
			memoizedState?: unknown;
			next?: ProbeHook | null;
		}
		interface ProbeEditor {
			project: { getMigrationState: () => unknown };
		}

		const reports: unknown[] = [];
		(
			window as unknown as { __probeMigrationReports: unknown[] }
		).__probeMigrationReports = reports;

		const isEditor = (value: unknown): value is ProbeEditor => {
			if (!value || typeof value !== "object") return false;
			const project = (value as { project?: unknown }).project;
			if (!project || typeof project !== "object") return false;
			return (
				typeof (project as { getMigrationState?: unknown })
					.getMigrationState === "function"
			);
		};

		// `__reactContainer$…` on the mount node *is* the HostRoot fiber;
		// `__reactFiber$…` on any rendered element reaches it by climbing.
		const rootFiber = (): ProbeFiber | null => {
			for (const node of document.querySelectorAll("*")) {
				const key = Object.keys(node).find(
					(name) =>
						name.startsWith("__reactContainer$") ||
						name.startsWith("__reactFiber$"),
				);
				if (!key) continue;
				let fiber = (node as unknown as Record<string, ProbeFiber>)[key];
				let climbed = 0;
				while (fiber.return && climbed++ < 1_000) fiber = fiber.return;
				return fiber;
			}
			return null;
		};

		const findEditor = (): ProbeEditor | null => {
			const root = rootFiber();
			if (!root) return null;
			const stack: ProbeFiber[] = [root];
			let visited = 0;
			while (stack.length > 0 && visited++ < 50_000) {
				const fiber = stack.pop();
				if (!fiber) break;
				let hook = fiber.memoizedState as ProbeHook | null | undefined;
				let depth = 0;
				while (hook && typeof hook === "object" && depth++ < 200) {
					const state = hook.memoizedState;
					// `useMemo` stores `[value, deps]`; `useSyncExternalStore` stores the
					// value. `useEditor` goes through both, so either shape can carry it.
					const candidate = Array.isArray(state) ? state[0] : state;
					if (isEditor(candidate)) return candidate;
					hook = hook.next;
				}
				if (fiber.child) stack.push(fiber.child);
				if (fiber.sibling) stack.push(fiber.sibling);
			}
			return null;
		};

		// Samples are keyed on **object identity**, not content, and the `false`
		// payloads are recorded too. Both matter:
		//
		// `onProgress` replaces `migrationState` wholesale, so a changed reference is
		// exactly one emission — but this polls at 20 ms, so an emission superseded
		// inside one tick is never sampled. The recorded array is therefore an
		// order-preserving **subsequence** of the emissions, not the sequence. That
		// is all the assertions need: dropped samples cannot reorder, invent a
		// `false`, or hide the terminal one. Content-keyed dedup could not express
		// even that — the completion payload (`runner.ts:115-120`) is byte-identical
		// to the constructor-initialised state (`project-manager.ts:48`), so
		// "completion" differs from "never started" only by **where it falls**.
		//
		// The first recorded sample may therefore be the constructor's initial state
		// rather than an emission — that is why the assertion looks for a `false`
		// *after* the last `true`, and never merely for a `false`.
		const UNSEEN = {};
		let editor: ProbeEditor | null = null;
		let lastSeen: unknown = UNSEEN;
		setInterval(() => {
			try {
				if (!editor) editor = findEditor();
				if (!editor) return;
				const state = editor.project.getMigrationState();
				if (state === lastSeen) return;
				lastSeen = state;
				if (!state || typeof state !== "object") return;
				reports.push(JSON.parse(JSON.stringify(state)));
			} catch {
				// Mid-render, or a fiber shape moved. Sample again next tick.
			}
		}, 20);
	});

	// A same-origin document with no application on it, so the seed lands in the
	// right storage partition before any editor code can read it. Navigating to
	// the app first and seeding afterwards would seed *after* the migration run
	// under test.
	await page.route("**/__probe-seed", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<!doctype html><title>probe seed</title><body>seeding</body>",
		}),
	);
	await page.goto("/__probe-seed");
	findings.seeded = await page.evaluate(seedInPage, seed);
	findings.databasesAfterSeed = await listDatabases(page);

	// Open project A. `ProjectManager.loadProject` awaits `ensureStorageMigrations()`
	// *before* reading the record, so this is the real application path on which a
	// legacy project would be migrated.
	await page.goto(editorPath(PROJECT_A));

	// Poll the persisted records rather than waiting on editor chrome. Pre-repair
	// the editor cannot open a v1 record at all, and a chrome timeout would report
	// "the editor did not load" — hiding the finding. What this probe is about is
	// whether the stored version moved.
	//
	// **Both** A and B are polled, and that is not belt-and-braces. The runner walks
	// the projects in `getAll()` order and migrates them one after another, so
	// exiting the wait the moment A reaches 31 can read B mid-chain: the first
	// post-repair run did exactly that and reported B still at version 1 on the Next
	// host while the Vite host happened to finish in time. That was a race in this
	// probe, not a host difference in the product.
	const deadline = Date.now() + 180_000;
	const isMigrated = (record: StoredRecord | null): boolean =>
		(record?.version as number | undefined) === CURRENT_VERSION;
	let recordA = await readProjectRecord(page, PROJECT_A);
	let recordB = await readProjectRecord(page, PROJECT_B);
	while (Date.now() < deadline && !(isMigrated(recordA) && isMigrated(recordB))) {
		await page.waitForTimeout(1_000);
		recordA = await readProjectRecord(page, PROJECT_A);
		recordB = await readProjectRecord(page, PROJECT_B);
	}

	const recordC = await readProjectRecord(page, PROJECT_C);
	const dialogTexts = await page.evaluate(
		() =>
			(window as unknown as { __probeDialogTexts?: string[] })
				.__probeDialogTexts ?? [],
	);
	const migrationReports = (await page.evaluate(
		() =>
			(window as unknown as { __probeMigrationReports?: unknown[] })
				.__probeMigrationReports ?? [],
	)) as MigrationReport[];

	findings.versionA = recordA?.version ?? null;
	findings.versionB = recordB?.version ?? null;
	findings.versionC = recordC?.version ?? null;
	findings.dialogTexts = dialogTexts;
	findings.migrationReports = migrationReports;
	findings.databasesAfterLoad = await listDatabases(page);
	findings.consoleErrors = consoleErrors;

	const elementsA = collectElements(recordA);
	const elementsB = collectElements(recordB);
	const mediaElementA = elementsA.find((el) => el.mediaId === MEDIA_A);
	const mediaElementB = elementsB.find((el) => el.mediaId === MEDIA_B);
	findings.recoveredA = {
		elementCount: elementsA.length,
		ids: elementsA.map((el) => el.id),
		mediaElementAType: mediaElementA?.type ?? null,
	};
	findings.recoveredB = {
		elementCount: elementsB.length,
		ids: elementsB.map((el) => el.id),
		mediaElementBType: mediaElementB?.type ?? null,
	};
	findings.recordCCanonical = canonical(recordC);
	findings.recordACanonical = canonical(recordA);
	// The text `MigrationDialog` would render if it re-rendered at all, recorded next
	// to the reason it never does (see the assertion at the end of this test).
	findings.migrationReportExpectedText = `Upgrading "${PROJECT_A_NAME}" from v1 to v${CURRENT_VERSION}`;

	await page.screenshot({
		path: resolve(OUT_DIR, `probe-${HOST}.png`),
		fullPage: false,
	});
	writeFileSync(
		resolve(OUT_DIR, `probe-${HOST}.json`),
		`${JSON.stringify(findings, null, 2)}\n`,
	);

	// ---------------------------------------------------------------- assertions

	// S1 + S2. The runner must have seen the project at all (S1) and written the
	// migrated record back under its own key (S2). Pre-repair this is the
	// assertion that fails, and it fails saying the version is still 1.
	expect(
		recordA?.version,
		`project A's persisted version (S1: the runner must enumerate the real projects database; S2: the migrated record must be written back)`,
	).toBe(CURRENT_VERSION);

	// The project is structurally intact, not merely version-stamped.
	expect(Array.isArray(recordA?.scenes), "project A still has a scenes array").toBe(
		true,
	);
	expect(
		(recordA?.scenes as unknown[]).length,
		"project A still has its scene",
	).toBeGreaterThan(0);

	// S3. The per-scene legacy timeline database was read, so its tracks are in the
	// migrated project. Asserted on recovered *content*, never on the legacy
	// databases being gone: a working delete and a broken read look identical.
	const serializedA = JSON.stringify(recordA);
	expect(
		serializedA,
		"S3: the media element from the per-scene legacy timeline database",
	).toContain(EL_A_MEDIA);
	expect(
		serializedA,
		"S3: the text element from the per-scene legacy timeline database",
	).toContain(EL_A_TEXT_CONTENT);
	expect(
		serializedA,
		"S3: the audio element from the per-scene legacy timeline database",
	).toContain(EL_A_AUDIO_NAME);
	expect(serializedA, "S3: the recovered media element's name").toContain(
		EL_A_MEDIA_NAME,
	);

	// S5. The legacy media-metadata database was read, so the recovered element is
	// an `image`. Without that read `mediaTypesById` is empty and
	// `transformMediaTrack` falls back to `video` — which is exactly what B shows.
	expect(
		mediaElementA,
		`S5: an element carrying mediaId ${MEDIA_A} exists in the migrated project`,
	).toBeTruthy();
	expect(
		mediaElementA?.type,
		"S5: the legacy media-metadata read resolved this element's type to image",
	).toBe("image");

	// S4. B has no per-scene database, so its tracks can only have come through the
	// main-scene fallback read.
	expect(
		recordB?.version,
		"project B's persisted version (migrated through the main-scene fallback)",
	).toBe(CURRENT_VERSION);
	const serializedB = JSON.stringify(recordB);
	expect(
		serializedB,
		"S4: the media element from the project-level legacy timeline database",
	).toContain(EL_B_MEDIA);
	expect(serializedB, "S4: the recovered element's name").toContain(
		EL_B_MEDIA_NAME,
	);
	// The S5 contrast: B has no metadata, so its element must stay `video`.
	expect(
		mediaElementB?.type,
		"S5 contrast: with no legacy metadata the element keeps the video fallback",
	).toBe("video");

	// The runner's `MigrationProgress` channel, asserted positively and from a
	// runtime observation. `browser-persistence-boundary` requires the migration to
	// be *reported* through this channel — in progress **and on completion** — and
	// reading `runner.ts:77-82` and `:115-120` is not evidence of that in a change
	// whose whole posture is runtime evidence over code inspection. Sampled by the
	// observer installed at the top of this test from `ProjectManager.migrationState`,
	// the object `onProgress` is assigned to.
	const captured = JSON.stringify(migrationReports);
	const inProgressIndexes = migrationReports
		.map((report, index) => (report.isMigrating === true ? index : -1))
		.filter((index) => index >= 0);
	expect(
		inProgressIndexes.length,
		`the MigrationProgress channel emitted at least one in-progress report (captured: ${captured})`,
	).toBeGreaterThan(0);

	// Every in-progress report that was captured, not just the first: both are
	// recorded on both hosts, and checking one of two would over-credit the
	// evidence. Which projects get sampled is not pinned; what each sampled report
	// must carry is.
	for (const index of inProgressIndexes) {
		const report = migrationReports[index];
		expect(
			report.fromVersion,
			`report ${index}: the channel reported the from-version`,
		).toBe(1);
		expect(
			report.toVersion,
			`report ${index}: the channel reported the to-version`,
		).toBe(CURRENT_VERSION);
		const reportedName =
			typeof report.projectName === "string" ? report.projectName : null;
		expect(
			[PROJECT_A_NAME, PROJECT_B_NAME],
			`report ${index}: the channel reported the migrating project's name`,
		).toContain(reportedName ?? "<no string projectName was reported>");
	}

	// The completion half of the same scenario: "…and reports completion
	// afterwards". Asserted on **position**, because the completion payload is
	// byte-identical to the constructor's initial state — a `false` anywhere proves
	// nothing, a `false` *after* the last `true` is the only thing that does.
	//
	// What this guards: a change that returned early before `runner.ts:115-120`
	// would leave the channel stuck reporting "migrating" forever. Every other
	// assertion in this test would still pass; this one would not.
	const lastInProgress = inProgressIndexes[inProgressIndexes.length - 1];
	const completion = migrationReports
		.slice(lastInProgress + 1)
		.find((report) => report.isMigrating === false);
	expect(
		completion,
		`the channel reported completion after its last in-progress report (captured: ${captured})`,
	).toBeDefined();
	// The payload itself, not just the flag: the runner clears all three fields.
	expect(completion?.fromVersion, "completion clears the from-version").toBeNull();
	expect(completion?.toVersion, "completion clears the to-version").toBeNull();
	expect(completion?.projectName, "completion clears the project name").toBeNull();

	// The SEPARATE inherited defect this probe found: the channel reports, and
	// nothing renders what it reports.
	//
	// `ProjectManager.ensureStorageMigrations` stores each progress payload and
	// `notify()`s — that much is asserted above. But its only UI consumer,
	// `MigrationDialog`, calls `useEditor()` **with no selector**, and that overload
	// subscribes with `subscribeNone = () => () => {}` (see `editor/use-editor.ts`).
	// It therefore reads `getMigrationState()` exactly once, at mount, when
	// `isMigrating` is still false — and never re-renders. **The migration dialog
	// cannot appear at all**, before or after this change, and no repair here
	// affects that.
	//
	// So the assertion pins the current truth rather than a behaviour the product
	// does not have. The MutationObserver demonstrably works — it captures the
	// onboarding dialog on **both** hosts — so an empty result here is a
	// measurement, not a missed observation. If someone later gives
	// `MigrationDialog` a real subscription, this assertion fails and points at the
	// finding instead of letting it pass unnoticed.
	const migrationDialog = dialogTexts.find((text) => /Upgrading/.test(text));
	expect(
		migrationDialog,
		`no migration dialog can be observed: MigrationDialog subscribes with subscribeNone, a separate inherited defect out of this change's scope (dialogs seen: ${JSON.stringify(dialogTexts)})`,
	).toBeUndefined();
});

test(`a project already at the current version is left untouched — ${HOST} host`, async () => {
	// Asserted from the artefact the first test wrote, so the two claims cannot
	// drift apart and the expensive page load is not repeated.
	const findings = JSON.parse(
		readFileSync(resolve(OUT_DIR, `probe-${HOST}.json`), "utf8"),
	) as { recordCCanonical: string; currentProjectVersion: number };
	const expected = canonical(
		buildSeed({ currentVersion: findings.currentProjectVersion }).find(
			(store) => store.dbName === PROJECTS_DB,
		)?.records.find((record) => record.id === PROJECT_C),
	);
	expect(
		findings.recordCCanonical,
		"project C was already at the current version, so its persisted record must be unchanged",
	).toBe(expected);
});
