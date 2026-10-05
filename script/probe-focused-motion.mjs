import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	mainPreviewCanvas,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

export async function probeFocusedMotion({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const original = hostPage.viewportSize();
	const prefs = () =>
		page.evaluate(() => {
			const raw = localStorage.getItem("panel-sizes");
			if (!raw) return null;
			const p = JSON.parse(raw).state.panels;
			return [p.tools, p.preview, p.properties];
		});
	const read = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				id: record.id,
				sequences: record.data.motionTextSequences ?? [],
				scenes: record.data.scenes.map(({ updatedAt, ...s }) => s),
				settings: record.data.settings,
			};
		});
	const before = await read(),
		proportions = await prefs();
	assert.equal(before.sequences.length, 0, "Use an empty dedicated fixture");
	const tabs = page.getByRole("tablist", { name: "Editor views", exact: true });
	const tab = (name) => tabs.getByRole("tab", { name, exact: true });
	const source = page.locator("#motion-text-source");
	const lyrics = Array.from(
		{ length: 12 },
		(_, i) => "保留草稿 " + (i + 1),
	).join("\n");
	try {
		onPhase("narrow focused motion editor uses full width and real scrolling");
		await hostPage.setViewportSize({ width: 760, height: 650 });
		await expect(page.getByTestId("editor-main-panels")).toHaveAttribute(
			"data-layout",
			"focus",
		);
		await expect(tabs).toBeVisible();
		await tab("Media & text").click();
		await page
			.getByLabel("Media", { exact: true })
			.locator("..")
			.getByLabel("Motion text", { exact: true })
			.click();
		const area = page.getByRole("tabpanel", {
			name: "Media & text",
			exact: true,
		});
		const box = await area.boundingBox();
		assert(
			box.width > 400,
			"Focused form must not remain a narrow third column",
		);
		await page.evaluate(() => {
			globalThis.__focusPanelNodes = [
				...document.querySelectorAll(
					'[data-panel-id="editor-assets"],[data-panel-id="editor-preview"],[data-panel-id="editor-properties"]',
				),
			];
		});
		const importButton = area.getByRole("button", {
			name: "Import",
			exact: true,
		});
		await importButton.scrollIntoViewIfNeeded();
		const chooser = hostPage.waitForEvent("filechooser");
		await importButton.click();
		await (await chooser).setFiles([]);
		await source.fill(lyrics);
		const duration = page.getByRole("spinbutton", {
			name: "Duration (seconds)",
			exact: true,
		});
		await duration.fill("12");
		const preset = area.getByRole("button", { name: /Clean caption/ });
		await preset.scrollIntoViewIfNeeded();
		await preset.click();
		await expect(preset).toBeInViewport();
		const scrollers = await area.evaluate((e) =>
			[...e.querySelectorAll("*")]
				.filter(
					(n) =>
						getComputedStyle(n).overflowY === "auto" &&
						n.scrollHeight > n.clientHeight,
				)
				.map((n) => ({ x: n.scrollWidth, w: n.clientWidth, y: n.scrollTop })),
		);
		assert(
			scrollers.some((s) => s.y > 0),
			"Real motion form scroll must move to lower controls",
		);
		assert(
			scrollers.every((s) => s.x <= s.w + 1),
			"Motion form must not overflow horizontally",
		);
		const add = page.getByTestId("motion-text-add");
		await expect(add).toBeInViewport();
		assert(
			await add.evaluate((e) => e.scrollWidth <= e.clientWidth),
			"Action text must fit",
		);
		onPhase(
			"keyboard panel switching and resizing retain the same mounted draft",
		);
		await tab("Media & text").focus();
		await hostPage.keyboard.press("ArrowRight");
		await expect(tab("Preview")).toBeFocused();
		await expect(tab("Preview")).toHaveAttribute("aria-selected", "true");
		await expect(source).toBeHidden();
		await hostPage.keyboard.press("End");
		await expect(tab("Inspector")).toBeFocused();
		await hostPage.keyboard.press("Home");
		await expect(tab("Media & text")).toBeFocused();
		await expect(source).toHaveValue(lyrics);
		await expect(duration).toHaveValue("12");
		for (const width of [1920, 1000, 760]) {
			await hostPage.setViewportSize({
				width,
				height: width === 1920 ? 1080 : 650,
			});
			await expect(page.getByTestId("editor-main-panels")).toHaveAttribute(
				"data-layout",
				width === 1920 ? "wide" : "focus",
			);
			await expect(source).toHaveValue(lyrics);
			assert.deepEqual(await prefs(), proportions);
			assert(
				await page.evaluate(
					() =>
						globalThis.__focusPanelNodes.length === 3 &&
						globalThis.__focusPanelNodes.every((e) => e.isConnected),
				),
				"Panels must remain mounted",
			);
		}
		assert.deepEqual(
			await read(),
			before,
			"Draft and layout changes must not author project content",
		);
		evidence.checks.push({
			name: "focused motion form scrolls without clipping; keyboard tabs and host resizing retain mounted draft and wide proportions",
			pass: true,
			scrollers,
		});
		await hostPage.screenshot({ path: join(work, "focused-motion-draft.png") });
		onPhase("create motion text and select timeline clip to reveal inspector");
		await add.click();
		await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
		await page.getByTestId("timeline-clip").click();
		await expect(tab("Inspector")).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("tabpanel", { name: "Inspector", exact: true }),
		).toBeVisible();
		await page
			.getByLabel("Transform", { exact: true })
			.locator("..")
			.getByLabel("Motion text", { exact: true })
			.click();
		const cue = page
			.locator(
				'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
			)
			.last();
		await cue.scrollIntoViewIfNeeded();
		await expect(cue).toBeInViewport();
		await hostPage.screenshot({
			path: join(work, "focused-motion-inspector.png"),
		});
		onPhase(
			"focused preview renders the created clip and history survives view switches",
		);
		await tab("Preview").click();
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:24");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await expect
			.poll(
				async () => {
					const png = await (await mainPreviewCanvas(page)).screenshot();
					return samplePreviewPng(page, png, (pixels) => {
						let lit = 0;
						for (let i = 0; i < pixels.length; i += 4)
							if (pixels[i] > 150 && pixels[i + 1] > 150 && pixels[i + 2] > 150)
								lit++;
						return lit;
					});
				},
				{ timeout: 20000 },
			)
			.toBeGreaterThan(20);
		await hostPage.keyboard.press("Control+z");
		await expect(page.getByTestId("timeline-clip")).toHaveCount(0);
		await expect.poll(read).toEqual(before);
		await hostPage.keyboard.press("Control+Shift+z");
		await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
		await tab("Media & text").click();
		await expect(source).toHaveValue(lyrics);
		assert.deepEqual(await prefs(), proportions);
		evidence.checks.push({
			name: "focused inspector reaches final cue; rendered preview and undo redo preserve content and input draft",
			pass: true,
		});
	} catch (error) {
		await hostPage.screenshot({ path: join(work, "focus-failure.png") });
		throw error;
	} finally {
		if (original) await hostPage.setViewportSize(original);
		else {
			const c = await hostPage.context().newCDPSession(hostPage);
			await c.send("Emulation.clearDeviceMetricsOverride");
			await c.detach();
		}
	}
}
