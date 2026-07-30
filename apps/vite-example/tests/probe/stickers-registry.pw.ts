import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import * as drive from "../parity/driver";
import { HOST, HOST_PROFILE } from "../parity/host-profile";

/**
 * Runtime evidence for site **S6** — `stickers/providers/index.ts:22` calling
 * `DefinitionRegistry.register({ key, definition })` positionally.
 *
 * The same spec asserts **both** directions, selected by `STICKERS_PHASE`:
 *
 * - `before` — the panel must read "No stickers found", no sticker image may be
 *   rendered, and a persisted recent sticker id must be **dropped** by the
 *   rehydration sanitizer. This is the pre-repair state, and asserting it (rather
 *   than only screenshotting it) is what makes the before-state a measurement.
 * - `after` — the panel must render sections with sticker images, and the same
 *   persisted recent sticker id must **survive** a reload.
 *
 * Why the registry's contents are read through behaviour rather than directly:
 * `stickersRegistry` is not exposed on `window`, and putting it there would mean
 * patching the inherited source this change is measuring.
 *
 * **A limit of this probe, stated rather than glossed.** What it can establish is
 * that **zero providers are registered**. It cannot distinguish "the map holds one
 * `undefined` entry" from "the map is empty" — measurement showed every candidate
 * discriminator collapses:
 *
 * - `browseAll` and `searchAll` both map over `getAll()` in an **`async`** callback,
 *   so with `[undefined]` the `TypeError` becomes a rejection that
 *   `Promise.allSettled` discards. Empty sections either way.
 * - the panel never reaches the one non-`async` map (module `searchStickers` with
 *   `category: "all"`): the store routes "all" to `searchAll` and only a concrete
 *   category to `searchStickers`, where `getProviderByCategory` catches the throw.
 *   Even if it were reached, the store wraps the call in `try/catch` and would
 *   report it as `console.error("Search failed:")`, not as an uncaught error.
 * - `registry.get(id)` throws the identical `Unknown sticker provider: <id>` in
 *   both cases, and `has(id)` is false in both.
 *
 * That the entry is `undefined -> undefined` is therefore established by the
 * mechanism (destructuring a string yields `key === undefined`, and `has()`
 * staying false is why all three providers overwrite the same entry) plus the
 * type checker, not by this probe. What this probe contributes is the
 * user-visible half: the panel is empty before and populated after.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../probe-artifacts", HOST);
const PHASE = process.env.STICKERS_PHASE === "after" ? "after" : "before";

/**
 * One persisted recent sticker id per default provider.
 *
 * This is how registration **under each provider's own id** is proven without
 * exposing the registry: `sanitizeRecentStickers` keeps an id only if
 * `stickersRegistry.has(parseStickerId(id).providerId)` is true, and it never
 * validates the value half. So each surviving id is a direct statement that that
 * provider id is a key in the registry.
 *
 * It is the only available proof for `logos`: its `browse()` returns
 * `EMPTY_BROWSE_RESULT` unconditionally (`providers/logos.ts`), so a registered
 * logos provider contributes no browse section by design — the panel can never
 * show it, and its absence from `sectionTitles` is not evidence of anything.
 */
const PERSISTED_RECENTS = ["flags:us", "logos:github", "shapes:circle"];
const STICKERS_TAB = 'button[aria-label="Stickers"]';

function panel(page: Page) {
	return page
		.locator("div.panel")
		.filter({ has: page.locator(STICKERS_TAB) })
		.first();
}

async function readPersistedRecents(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const raw = window.localStorage.getItem("stickers-settings");
		if (!raw) return null;
		try {
			return (JSON.parse(raw) as { state?: { recentStickers?: unknown } }).state
				?.recentStickers ?? null;
		} catch {
			return "<unparseable>";
		}
	});
}

test.describe.configure({ mode: "serial" });

test(`sticker provider registry — ${PHASE} — ${HOST} host`, async ({
	page,
	baseURL,
}) => {
	mkdirSync(OUT_DIR, { recursive: true });
	const origin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
	const pageErrors: string[] = [];
	const blockedRequests: string[] = [];
	const findings: Record<string, unknown> = {
		host: HOST,
		phase: PHASE,
		baseURL,
		generatedAt: new Date().toISOString(),
	};

	// First-party only, as the parity scenario does. This is also the measurement
	// OQ3 asks for: whatever the newly registered providers reach for off-origin
	// shows up in `blockedRequests` instead of silently succeeding.
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
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	// Seed a persisted recent sticker BEFORE any app code runs, so the rehydration
	// sanitizer (`sanitizeRecentStickers` -> `isValidStickerId` ->
	// `stickersRegistry.has`) runs against it on first load.
	//
	// `version: 0` is load-bearing and was found by measurement. The store is at
	// `version: 1`, and zustand's `persist` only calls `migrate` — the *only*
	// caller of `sanitizeRecentStickers` — when the persisted version differs.
	// Seeded at `version: 1` the sanitizer never runs at all and a bogus recent id
	// survives even with the defect present, which is not the claim being tested.
	// So the dropped-recents consequence is real but **narrower** than "persisted
	// recents are dropped": it needs a `stickers-settings` blob written before the
	// store's version 1.
	await page.addInitScript(
		({ recents }) => {
			window.localStorage.setItem(
				"stickers-settings",
				JSON.stringify({
					state: { selectedCategory: "all", recentStickers: recents },
					version: 0,
				}),
			);
		},
		{ recents: PERSISTED_RECENTS },
	);

	await page.goto(HOST_PROFILE.entryPath);
	await HOST_PROFILE.createProject(page);
	await drive.waitForEditor(page);
	await drive.dismissOnboarding(page);

	// A plain click is correct here: the tab is a `<Button onClick>`, not a Radix
	// dropdown trigger. (Radix's `pointerdown` gotcha applies to menus, and using
	// `.click()` on one of those is what reads as "the feature is broken".)
	await page.locator(STICKERS_TAB).click();
	await page.waitForTimeout(4_000);

	const browseText = (await panel(page).innerText()).trim();
	const browseImages = await panel(page).locator("img[alt]").count();
	const sectionTitles = await panel(page)
		.locator("p.text-xs")
		.allInnerTexts();

	findings.browse = {
		saysNoStickersFound: browseText.includes("No stickers found"),
		imageCount: browseImages,
		sectionTitles,
		panelTextExcerpt: browseText.slice(0, 400),
	};
	await page.screenshot({
		path: resolve(OUT_DIR, `stickers-${PHASE}.png`),
		fullPage: false,
	});

	// Both search branches are driven, because they fail differently: the "All" tab
	// goes through `searchAll` (async map, rejection absorbed by `allSettled`) and a
	// concrete category goes through module `searchStickers` (`getProviderByCategory`
	// catches the `registry.get` throw). Recording both is what shows the fault is
	// swallowed on every path the panel can reach.
	const search: Record<string, unknown> = {};
	for (const [label, category] of [
		["all", null],
		["shapes", "Shapes"],
	] as const) {
		const errorsBefore = pageErrors.length;
		const consoleBefore = consoleErrors.length;
		if (category) {
			await panel(page).getByRole("tab", { name: category }).click();
			await page.waitForTimeout(1_500);
		}
		await panel(page).locator('input[placeholder="Search..."]').fill("circle");
		await page.waitForTimeout(5_000);
		const searchText = (await panel(page).innerText()).trim();
		search[label] = {
			query: "circle",
			newPageErrors: pageErrors.slice(errorsBefore),
			newConsoleErrors: consoleErrors.slice(consoleBefore),
			saysNoStickersFound: searchText.includes("No stickers found"),
			imageCount: await panel(page).locator("img[alt]").count(),
			panelTextExcerpt: searchText.slice(0, 400),
		};
		await page.screenshot({
			path: resolve(OUT_DIR, `stickers-${PHASE}-search-${label}.png`),
			fullPage: false,
		});
	}
	findings.search = search;

	findings.recentsAfterFirstLoad = await readPersistedRecents(page);
	await page.reload();
	await drive.waitForEditor(page);
	await page.waitForTimeout(3_000);
	findings.recentsAfterReload = await readPersistedRecents(page);
	findings.pageErrors = pageErrors;
	findings.consoleErrors = consoleErrors;
	findings.blockedOffOriginRequests = blockedRequests;
	findings.blockedOffOriginHosts = [
		...new Set(blockedRequests.map((url) => new URL(url).host)),
	].sort();

	writeFileSync(
		resolve(OUT_DIR, `stickers-${PHASE}-${HOST}.json`),
		`${JSON.stringify(findings, null, 2)}\n`,
	);

	// ---------------------------------------------------------------- assertions

	if (PHASE === "before") {
		expect(
			findings.browse,
			"S6 before-state: the stickers panel reads 'No stickers found'",
		).toMatchObject({ saysNoStickersFound: true, imageCount: 0 });
		expect(
			findings.recentsAfterReload,
			"S6 before-state: `registry.has()` is false for every provider id, so every persisted recent sticker is silently dropped",
		).toEqual([]);
	} else {
		expect(
			(findings.browse as { imageCount: number }).imageCount,
			"S6 after-state: the panel renders sticker previews",
		).toBeGreaterThan(0);
		expect(
			(findings.browse as { saysNoStickersFound: boolean })
				.saysNoStickersFound,
			"S6 after-state: the panel no longer reads 'No stickers found'",
		).toBe(false);
		expect(
			(findings.browse as { sectionTitles: string[] }).sectionTitles.length,
			"S6 after-state: a category browse returns non-empty sections",
		).toBeGreaterThan(0);
		expect(
			findings.recentsAfterReload,
			"S6 after-state: a persisted recent sticker id survives a reload for EVERY default provider, i.e. all three are registered under their own ids",
		).toEqual(PERSISTED_RECENTS);
	}
});
