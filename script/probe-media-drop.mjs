import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { reloadEditorFrame } from "./probe-reload-editor.mjs";
import { createNativeDropHelpers } from "./probe-native-drop.mjs";

export async function probeMediaDrop({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
	storageFailure = false,
}) {
	const check = (name, detail = {}) =>
		evidence.checks.push({ name, ...detail, pass: true });
	const attachments = () =>
		page.evaluate(async () =>
			(await fetch(new URL("api/attachments", location.href))).json(),
		);
	const clips = () =>
		page.evaluate(async () => {
			const t = (
				await (await fetch(new URL("api/record", location.href))).json()
			).record.data.scenes[0].tracks;
			return [t.main, ...t.overlay, ...t.audio].flatMap((t) => t.elements);
		});
	const cdp = await hostPage.context().newCDPSession(hostPage);
	try {
		const { make, drop, verifyBytes } = createNativeDropHelpers({
			page,
			work,
			cdp,
			attachments,
			onTarget: (target) => {
				(evidence.nativeDropTargets ??= []).push(target);
			},
		});
		const assetVideo = make("拖入 素材.mp4"),
			assetAudio = make("drop-library.wav", true);
		const timelineVideo = make("drop-timeline.mp4"),
			timelineAudio = make("drop-timeline.wav", true);
		await page.evaluate(() => {
			globalThis.__rocutDrops = [];
			document.addEventListener(
				"drop",
				(event) =>
					globalThis.__rocutDrops.push({
						trusted: event.isTrusted,
						names: Array.from(event.dataTransfer?.files ?? [], (f) => f.name),
					}),
				true,
			);
		});
		onPhase("native file drop into empty media panel");
		await page.getByLabel("Media", { exact: true }).click();
		await drop(
			[assetVideo, assetAudio],
			page.getByRole("button", {
				name: "Drag and drop videos, photos, and audio files here",
				exact: true,
			}),
		);
		await expect
			.poll(async () => (await attachments()).length, { timeout: 30000 })
			.toBe(2);
		assert.equal(
			(await clips()).length,
			0,
			"Dropping into the library must not add timeline clips",
		);
		await verifyBytes([assetVideo, assetAudio]);
		check(
			"native media drop preserves video audio and Unicode names without inserting clips",
		);
		onPhase("native mixed-file drop directly into timeline");
		await drop(
			[timelineVideo, timelineAudio],
			page.getByRole("region", { name: "Timeline", exact: true }),
		);
		await expect
			.poll(async () => (await clips()).length, { timeout: 30000 })
			.toBe(2);
		await expect.poll(async () => (await attachments()).length).toBe(4);
		assert.deepEqual((await clips()).map((c) => c.type).sort(), [
			"audio",
			"video",
		]);
		await verifyBytes([timelineVideo, timelineAudio]);
		const observed = await page.evaluate(() => globalThis.__rocutDrops);
		assert.equal(observed.length, 2);
		assert(observed.every((e) => e.trusted && e.names.length === 2));
		evidence.nativeDropEvents = observed;
		await reloadEditorFrame(page);
		assert.equal((await attachments()).length, 4);
		assert.equal((await clips()).length, 2);
		await hostPage.screenshot({ path: join(work, "media-drop-reopened.png") });
		check(
			"native timeline drop persists both media clips and exact source bytes across reopen",
		);
		if (!storageFailure) return;
		evidence.acceptanceEligible = false;
		evidence.faultInjection =
			"Only attachment PUT for the owned drop-rejected.wav returns controlled HTTP 507";
		onPhase("timeline drop attachment failure must not report upload success");
		const rejected = make("drop-rejected.wav", true),
			survivor = make("drop-survivor.wav", true);
		let rejectedWrites = 0;
		const reject = async (route) => {
			if (route.request().method() !== "PUT") return route.continue();
			const m = JSON.parse(
				Buffer.from(
					route.request().headers()["x-opencut-metadata"],
					"base64",
				).toString("utf8"),
			);
			if (m.name !== "drop-rejected.wav") return route.continue();
			rejectedWrites++;
			await route.fulfill({
				status: 507,
				contentType: "application/json",
				body: JSON.stringify({ error: "Owned E2E storage failure" }),
			});
		};
		await hostPage.route("**/api/attachment/*", reject);
		try {
			await drop(
				[rejected],
				page.getByRole("region", { name: "Timeline", exact: true }),
			);
			await expect.poll(() => rejectedWrites).toBe(1);
			const visible = page.locator('[data-sonner-toast][data-visible="true"]');
			await expect
				.poll(async () =>
					(await visible.allTextContents()).some(
						(t) =>
							t.includes("Failed to upload") ||
							t.includes("drop-rejected.wav has been uploaded"),
					),
				)
				.toBe(true);
			const texts = await visible.allTextContents();
			evidence.failedDropToasts = texts;
			assert.equal((await attachments()).length, 4);
			assert.equal((await clips()).length, 2);
			assert(
				!texts.some((t) => t.includes("drop-rejected.wav has been uploaded")),
				"Rejected timeline drop falsely reports successful upload",
			);
			assert(
				texts.some((t) => t.includes("Failed to upload")),
				"Failed timeline drop must show an error",
			);
			await drop(
				[rejected, survivor],
				page.getByRole("region", { name: "Timeline", exact: true }),
			);
			await expect.poll(() => rejectedWrites).toBe(2);
			await expect(
				visible
					.filter({ hasText: "1 of 2 media assets uploaded; 1 failed" })
					.first(),
			).toBeVisible();
			await expect.poll(async () => (await clips()).length).toBe(3);
			assert.equal((await attachments()).length, 5);
		} finally {
			await hostPage.unroute("**/api/attachment/*", reject);
		}
		check(
			"controlled failed and partial timeline drops count only durable media",
			{ faultInjected: true },
		);
		onPhase("retry native timeline drop after storage recovery");
		await drop(
			[rejected],
			page.getByRole("region", { name: "Timeline", exact: true }),
		);
		await expect.poll(async () => (await clips()).length).toBe(4);
		await expect.poll(async () => (await attachments()).length).toBe(6);
		await reloadEditorFrame(page);
		assert.equal((await clips()).length, 4);
		assert.equal((await attachments()).length, 6);
		await verifyBytes([rejected, survivor]);
		check(
			"storage recovery permits native drop retry and preserves previous timeline and media",
		);
	} finally {
		await cdp.detach();
	}
}
