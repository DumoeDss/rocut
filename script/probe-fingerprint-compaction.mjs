import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

const prefix = "oc-txn:v1:sha256:";
const normalize = (value) =>
	value.startsWith('["array",')
		? prefix +
			createHash("sha256")
				.update(prefix + "\0" + value)
				.digest("hex")
		: value;
function decodeTagged(value) {
	switch (value[0]) {
		case "undefined":
			return undefined;
		case "null":
			return null;
		case "string":
		case "boolean":
			return value[1];
		case "number":
			return Number(value[1]);
		case "array":
			return value[1].map(decodeTagged);
		case "object":
			return Object.fromEntries(
				value[1].map(([key, entry]) => [key, decodeTagged(entry)]),
			);
		default:
			throw new Error("Unexpected legacy fingerprint tag");
	}
}

export async function probeFingerprintCompaction({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	const read = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	const ledger = (record) => record.data.__opencutTransaction.idempotency;
	const content = (record) => ({
		scenes: record.data.scenes,
		sequences: record.data.motionTextSequences,
		settings: record.data.settings,
	});
	const initial = await read();
	const before = {
		bytes: (await stat(join(project, "project.json"))).size,
		entries: ledger(initial).length,
		fingerprintCharacters: ledger(initial).reduce(
			(n, entry) => n + entry.fingerprint.length,
			0,
		),
	};
	assert(
		before.fingerprintCharacters > 1_000_000,
		"Must exercise an actual legacy oversized ledger",
	);
	const legacy = ledger(initial)
		.filter((entry) => entry.fingerprint.startsWith('["array",'))
		.sort((a, b) => a.fingerprint.length - b.fingerprint.length)[0];
	const operations = decodeTagged(JSON.parse(legacy.fingerprint));
	// This fixture uses only JSON-compatible operations; do not drop explicit undefined.
	assert.deepEqual(JSON.parse(JSON.stringify(operations)), operations);
	const replay = () =>
		page.evaluate(
			async (body) => {
				const response = await fetch(new URL("api/apply", location.href), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				return { status: response.status, body: await response.json() };
			},
			{ operations, idempotencyKey: legacy.key },
		);
	onPhase("legacy receipt retry before UI compaction");
	const retried = await replay();
	assert.equal(retried.status, 200);
	assert.deepEqual(retried.body, { accepted: true, ...legacy.result });
	assert.deepEqual(await read(), initial);
	evidence.checks.push({
		name: "old installed receipt retries without modifying project",
		pass: true,
	});
	onPhase("real cue edit compacts old history on normal save");
	await page.getByTestId("timeline-clip").click();
	await page.locator("#editor-properties").getByLabel("Motion text", { exact: true }).click();
	const cue = initial.data.motionTextSequences[0].cues[0];
	const row = page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.first();
	if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
	const input = page.locator('textarea[id="motion-text-cue-' + cue.id + '"]');
	const editedText = cue.text + " compact";
	await input.fill(editedText);
	const apply = input
		.locator("..")
		.locator("..")
		.getByRole("button", { name: "Apply changes", exact: true });
	await apply.click();
	await expect
		.poll(async () => (await read()).data.motionTextSequences[0].cues[0].text)
		.toBe(editedText);
	const edited = await read();
	assert.equal(ledger(edited).length, ledger(initial).length + 1);
	for (let i = 0; i < ledger(initial).length; i++)
		assert.deepEqual(ledger(edited)[i], {
			...ledger(initial)[i],
			fingerprint: normalize(ledger(initial)[i].fingerprint),
		});
	assert(
		ledger(edited).every(
			(entry) => entry.fingerprint.length === prefix.length + 64,
		),
	);
	evidence.checks.push({
		name: "UI commit compacts every legacy fingerprint without dropping or changing receipts",
		pass: true,
	});
	// Move focus out of the textarea so these are editor undo/redo, not text undo.
	await page.getByLabel("Edit playhead time", { exact: true }).focus();
	await hostPage.keyboard.press("Control+z");
	await expect
		.poll(async () => content(await read()))
		.toEqual(content(initial));
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(async () => content(await read())).toEqual(content(edited));
	await hostPage.keyboard.press("Control+z");
	await expect
		.poll(async () => content(await read()))
		.toEqual(content(initial));
	const restored = await read();
	assert(
		ledger(restored).every(
			(entry) => entry.fingerprint.length === prefix.length + 64,
		),
	);
	const file = JSON.parse(
		await readFile(join(project, "project.json"), "utf8"),
	);
	assert.deepEqual(file.record ?? file, restored);
	const after = {
		bytes: (await stat(join(project, "project.json"))).size,
		entries: ledger(restored).length,
		fingerprintCharacters: ledger(restored).reduce(
			(n, entry) => n + entry.fingerprint.length,
			0,
		),
	};
	assert(after.bytes < before.bytes / 2);
	evidence.fingerprintCompaction = { before, after };
	evidence.checks.push({
		name: "real undo redo restore content while keeping compact durable ledger",
		pass: true,
	});
	onPhase("actual workspace close reopen and legacy receipt replay");
	const url = page.url();
	await hostPage
		.locator(
			'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
		)
		.click();
	await expect(
		hostPage.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
	).toHaveCount(0);
	await hostPage
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	await expect
		.poll(
			() => {
				const frame = hostPage.frames().find((frame) => frame.url() === url);
				if (frame) page = frame;
				return !!frame;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await page.getByTestId("timeline-clip").waitFor({ timeout: 30000 });
	assert.deepEqual(content(await read()), content(initial));
	const afterReplay = await replay();
	assert.equal(afterReplay.status, 200);
	assert.deepEqual(afterReplay.body, { accepted: true, ...legacy.result });
	assert.equal(ledger(await read()).length, ledger(restored).length);
	await hostPage.screenshot({
		path: join(work, "fingerprint-compaction-reopened.png"),
	});
	evidence.checks.push({
		name: "actual workspace reopen preserves 600 cues and old receipt replay",
		pass: true,
	});
}
