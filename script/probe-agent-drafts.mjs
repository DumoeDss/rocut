import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

const run = promisify(execFile);

// Installed CLI, real Elftia UI and dedicated data only. Manual CLI approval
// represents the authorized test actor, NOT a live model or in-pane review UI.
export async function probeAgentDrafts({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	assert(
		process.env.ELFTIA_INSTALLED_ROCUT,
		"Set the exact installed plugin root",
	);
	const plugin = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
	const cliPath = join(plugin, "vendor/run/rocut.mjs");
	const bytes = await readFile(cliPath);
	evidence.agentDriver = {
		kind: "installed CLI + real editor UI",
		modelCalled: false,
		cliSha256: createHash("sha256").update(bytes).digest("hex"),
		approval:
			"authorized test actor invokes manual draft approve; not in-pane review acceptance",
	};
	const cli = async (...args) => {
		const { stdout } = await run(
			process.execPath,
			[
				cliPath,
				...args,
				"--project",
				project,
				"--targets-root",
				join(homedir(), ".rocut"),
			],
			{ timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
		);
		return stdout.trim();
	};
	const json = async (...args) => JSON.parse(await cli(...args));
	const spec = async (name, data) => {
		const output = join(work, name + ".json");
		await writeFile(output, JSON.stringify(data, null, 2));
		return output;
	};
	const check = (name, details = {}) =>
		evidence.checks.push({ name, ...details, pass: true });
	const makeMutation = (sequence, text) => ({
		mutation: {
			kind: "update-cue",
			cueId: sequence.cues[2].id,
			text,
			startTime: sequence.cues[2].startTime,
			duration: sequence.cues[2].duration,
			preset: { mode: "keep" },
			font: { mode: "keep" },
			colors: { mode: "set", foreground: "#00FF00", accent: "#FF0000" },
		},
		expectedSequenceRevision: sequence.revision,
	});
	const previewAndStage = async (snapshot, label) => {
		const sequence = snapshot.sequences[0];
		const draftId = await cli("draft", "begin");
		assert.match(draftId, /^[a-zA-Z0-9:_-]+$/);
		const input = await spec(
			label,
			makeMutation(sequence, "草稿批准后的第三句"),
		);
		const preview = await json(
			"motion-text",
			"mutate",
			sequence.id,
			input,
			"--preview",
		);
		assert.equal(preview.applied, false);
		assert.equal(preview.baseSequenceRevision, sequence.revision);
		assert.equal(preview.projectRevision, snapshot.projectRevision);
		assert.equal(preview.candidate.cues[2].text, "草稿批准后的第三句");
		assert.equal(
			preview.candidate.cues[2].overrides.colors.foreground,
			"#00FF00",
		);
		const batch = await spec(label + "-stage", {
			operations: [
				{
					kind: "update-motion-text-sequence",
					sequenceId: sequence.id,
					expectedSequenceRevision: sequence.revision,
					sequence: preview.candidate,
				},
			],
		});
		assert.equal(
			(await json("draft", "stage", batch, "--draft", draftId)).accepted,
			true,
		);
		assert.deepEqual(
			await json("motion-text", "list"),
			snapshot,
			"Preview/staging must not commit",
		);
		return { draftId, preview };
	};
	const expectCliFailure = async (args, pattern) => {
		let failure;
		try {
			await cli(...args);
		} catch (error) {
			failure = String(error.stderr ?? "");
		}
		assert(
			failure && pattern.test(failure),
			"CLI must report the expected refusal, not succeed or time out",
		);
	};
	onPhase("UI fixture for agent draft collaboration");
	await page.getByLabel("Motion text", { exact: true }).click();
	await page
		.getByRole("combobox", { name: "Lyrics format", exact: true })
		.click();
	await page
		.getByRole("option", { name: "LRC timestamps", exact: true })
		.click();
	await page
		.locator("#motion-text-source")
		.fill(
			"[00:00.00]第一句保持不变\n[00:02.00]第二句由用户修改\n[00:04.00]第三句等待草稿",
		);
	await page
		.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
		.fill("6");
	await page.getByTestId("motion-text-add").click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await expect
		.poll(async () => (await json("motion-text", "list")).sequences.length)
		.toBe(1);
	const before = await json("motion-text", "list");
	assert.equal(before.sequences[0].cues.length, 3);
	onPhase("agent stages canonical text and local color candidate");
	const first = await previewAndStage(before, "initial-proposal");
	check(
		"installed CLI previews and stages a Rust-planned cue edit without changing the live project",
	);
	onPhase("real user edit invalidates the pending agent draft");
	await page.getByTestId("timeline-clip").click();
	await page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.nth(1)
		.click();
	await page
		.getByRole("textbox", { name: "Lyric text", exact: true })
		.fill("用户保留的第二句");
	await page
		.getByRole("button", { name: "Apply changes", exact: true })
		.click();
	await expect
		.poll(
			async () => (await json("motion-text", "list")).sequences[0].cues[1].text,
		)
		.toBe("用户保留的第二句");
	const userState = await json("motion-text", "list");
	await expectCliFailure(
		["draft", "approve", "--draft", first.draftId],
		/404.*unknown-draft/s,
	);
	const stale = await spec("stale-direct-mutation", {
		...makeMutation(before.sequences[0], "must not overwrite"),
		expectedRevision: before.projectRevision,
		idempotencyKey: "agent-draft-probe-stale",
	});
	await expectCliFailure(
		["motion-text", "mutate", before.sequences[0].id, stale],
		/409/,
	);
	assert.deepEqual(await json("motion-text", "list"), userState);
	check(
		"real UI edit invalidates old draft; stale mutation is rejected without overwriting user data",
		{
			beforeRevision: before.projectRevision,
			userRevision: userState.projectRevision,
		},
	);
	onPhase("agent re-reads and commits a fresh manually approved draft");
	const fresh = await previewAndStage(userState, "rebased-proposal");
	assert.equal(
		(await json("draft", "approve", "--draft", fresh.draftId)).applied,
		true,
	);
	const committed = await json("motion-text", "list");
	assert.equal(committed.projectRevision, userState.projectRevision + 1);
	assert.equal(committed.sequences[0].cues[1].text, "用户保留的第二句");
	assert.equal(committed.sequences[0].cues[2].text, "草稿批准后的第三句");
	assert.deepEqual(committed.sequences[0], fresh.preview.candidate);
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await page.getByTestId("timeline-clip").click();
	await expect(
		page.locator('[aria-labelledby="motion-text-cues-heading"]'),
	).toContainText("草稿批准后的第三句", { timeout: 10000 });
	await hostPage.screenshot({ path: join(work, "agent-draft-committed.png") });
	const proof = await json("verify", "540000");
	check(
		"fresh manual draft commits text and local color atomically and appears in the live editor",
		{
			projectRevision: committed.projectRevision,
			sequenceRevision: committed.sequences[0].revision,
		},
	);
	onPhase(
		"close pane: exports refuse, business reads survive, project reopens",
	);
	await hostPage
		.locator(
			'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
		)
		.click();
	await expect(
		hostPage.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
	).toHaveCount(0);
	await expectCliFailure(
		[
			"export",
			"--format",
			"mp4",
			"--quality",
			"low",
			"--out",
			join(work, "must-not-export.mp4"),
		],
		/409.*(pane|surface|editor)/is,
	);
	const closed = await json("motion-text", "list");
	assert.deepEqual(closed.sequences, committed.sequences);
	await hostPage
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	let reopened;
	await expect
		.poll(
			async () => {
				for (const frame of hostPage.frames())
					if (
						(await frame.title().catch(() => "")).startsWith("OpenCut editor")
					)
						reopened = frame;
				return !!reopened;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await reopened.getByTestId("timeline-clip").click({ timeout: 30000 });
	await expect(
		reopened.locator('[aria-labelledby="motion-text-cues-heading"]'),
	).toContainText("草稿批准后的第三句");
	await expect(
		reopened.locator('[aria-labelledby="motion-text-cues-heading"]'),
	).toContainText("用户保留的第二句");
	assert.equal((await json("verify", "540000")).digest, proof.digest);
	await hostPage.screenshot({ path: join(work, "agent-draft-reopened.png") });
	check(
		"closed pane refuses rendering but keeps CLI reads; reopening preserves user and agent changes and frame-description digest",
	);
}
