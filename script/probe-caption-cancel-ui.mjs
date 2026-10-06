import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const work = await mkdtemp(join(tmpdir(), "rocut-caption-cancel-"));
const fixture = fileURLToPath(
	new URL(
		"../packages/editor-classic/src/subtitles/__tests__/browser.html",
		import.meta.url,
	),
).replaceAll("\\", "/");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 760, height: 720 } });
const evidence = {
	kind: "caption-operation-component-regression",
	installedAcceptance: false,
	checks: [],
	errors: [],
};
page.on("pageerror", (error) => evidence.errors.push(error.message));
try {
	await page.addInitScript(() => {
		const original = File.prototype.text;
		const pending = [];
		File.prototype.text = function () {
			if (this.name !== "delayed.srt") return original.call(this);
			return new Promise((resolve) =>
				pending.push(() => original.call(this).then(resolve)),
			);
		};
		window.__releaseCaptionReads = async () => {
			await Promise.all(pending.splice(0).map((release) => release()));
		};
	});
	await page.goto(`http://127.0.0.1:4196/@fs/${fixture}`);
	await expect(page.getByTestId("ready")).toHaveText("true");
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await expect(page.getByTestId("project")).not.toHaveText("");
	const importFile = async (name) => {
		await page.locator('input[type="file"]').setInputFiles({
			name,
			mimeType: "text/plain",
			buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nOwned caption\n"),
		});
	};
	const cancel = page.getByRole("button", {
		name: "Cancel caption operation",
		exact: true,
	});
	const generate = page.getByRole("button", {
		name: "Generate transcript",
		exact: true,
	});
	const release = () => page.evaluate(() => window.__releaseCaptionReads());
	await importFile("delayed.srt");
	await expect(cancel).toBeVisible();
	await cancel.focus();
	await page.keyboard.press("Enter");
	await expect(cancel).toHaveCount(0);
	// An empty timeline legitimately disables transcription; restore focus to Import.
	await expect(
		page.getByRole("button", { name: "Import", exact: true }),
	).toBeFocused();
	await release();
	await expect(page.getByTestId("captions")).toHaveText("[]");
	evidence.checks.push({
		name: "Keyboard cancellation restores focus and delayed import publishes nothing",
		pass: true,
	});
	await importFile("fixed.srt");
	await expect
		.poll(
			async () =>
				JSON.parse(await page.getByTestId("captions").textContent()).length,
		)
		.toBe(1);
	evidence.checks.push({
		name: "A fresh real SRT import succeeds after cancellation",
		pass: true,
	});
	await importFile("delayed.srt");
	await expect(cancel).toBeVisible();
	await page.getByRole("button", { name: "Toggle panel", exact: true }).click();
	await release();
	await expect
		.poll(
			async () =>
				JSON.parse(await page.getByTestId("captions").textContent()).length,
		)
		.toBe(1);
	await page.getByRole("button", { name: "Toggle panel", exact: true }).click();
	await expect(generate).toBeVisible();
	evidence.checks.push({
		name: "Leaving the panel invalidates a pending file read",
		pass: true,
	});
	await importFile("delayed.srt");
	await expect(cancel).toBeVisible();
	const previous = await page.getByTestId("project").textContent();
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await expect(page.getByTestId("project")).not.toHaveText(previous);
	await release();
	await expect(page.getByTestId("captions")).toHaveText("[]");
	await expect(generate).toBeVisible();
	evidence.checks.push({
		name: "A delayed subtitle read cannot insert into the next project",
		pass: true,
	});
	await importFile("delayed.srt");
	await expect(cancel).toBeVisible();
	await page.getByRole("button", { name: "Suspend", exact: true }).click();
	await release();
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await expect(generate).toBeVisible();
	await expect(page.getByTestId("captions")).toHaveText("[]");
	evidence.checks.push({
		name: "Suspension cancels UI work and resume does not restart it",
		pass: true,
	});
	await page
		.getByRole("button", { name: "Fail next caption save", exact: true })
		.click();
	await importFile("failed-save.srt");
	await expect(page.getByRole("alert")).toContainText(
		/unavailable|save|persist/i,
	);
	await expect(page.getByTestId("captions")).toHaveText("[]");
	await importFile("retry-save.srt");
	await expect
		.poll(
			async () =>
				JSON.parse(await page.getByTestId("captions").textContent()).length,
		)
		.toBe(1);
	await expect(page.getByRole("alert")).toHaveCount(0);
	evidence.checks.push({
		name: "A failed durable insertion is visible and importing again recovers",
		pass: true,
	});
	assert.deepEqual(evidence.errors, []);
	evidence.passed = true;
} catch (error) {
	evidence.passed = false;
	evidence.failure = String(error.stack);
	await page.screenshot({ path: join(work, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	await browser.close();
	console.log(JSON.stringify({ work, ...evidence }));
}
