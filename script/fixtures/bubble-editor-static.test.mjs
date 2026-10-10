import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	bubbleEditorContract as spec,
	bubbleEditorClips,
} from "./bubble-editor-contract.mjs";
import { assertBubbleEditorBrowserErrors } from "../probe-bubble-editor.mjs";
import { closeBlazeEditorResources } from "./blaze-editor-lifecycle.mjs";
import { assertBubbleEditorDuplicateRejection } from "./bubble-editor-cross-retry.mjs";
import { observeBubbleEditorPage, isBubbleEditorPointPreviewError } from "./bubble-editor-observe.mjs";

test("seed uses actual Creator caller shape and isolated clip/standalone/disabled identities", () => {
	const resource = { id: "fixture-image", sha256: "a".repeat(64) };
	let invocation;
	const creator = {
		bubbleImage: (args) => {
			invocation = args;
			return {
				source: { resources: [args.image] },
				effects: [
					{
						id: "bubble",
						type: "bubble",
						enabled: true,
						params: {
							pointCount: 1,
							point0Time: 0,
							point0X: 0.5,
							point0Y: 0.5,
							refraction: 0.12,
						},
					},
				],
				animations: {},
			};
		},
	};
	const clips = bubbleEditorClips(creator, resource, {
		effects: {
			bubble: [
				{ key: "refraction", default: 0.12 },
				{ key: "point1Time", default: 0, required: false },
			],
		},
	});
	assert.deepEqual(invocation.knots, [{ time: 0, x: 0.5, y: 0.5 }]);
	assert.deepEqual(invocation.params, { refraction: 0.12 });
	assert.equal(clips.length, 3);
	assert.equal(new Set(clips.map((clip) => clip.id)).size, 3);
	assert.equal(clips[1].editing.effects[0].enabled, false);
	assert.equal(clips[2].editing.type, "effect");
	assert(
		clips.every((clip) => clip.startTime % 4000 === 0 && clip.trimStart === 0),
	);
	assert.equal(
		spec.keyframeTitle,
		`Toggle ${spec.opticalLabel.toLowerCase()} keyframe`,
	);
});

test("actual UI checks use DOM/keyboard for mutations and read-only Host observations", async () => {
	const checks = await readFile(
		fileURLToPath(new URL("./bubble-editor-checks.mjs", import.meta.url)),
		"utf8",
	);
	const control = await readFile(
		fileURLToPath(new URL("./bubble-editor-control.mjs", import.meta.url)),
		"utf8",
	);
	assert(
		checks.includes('name: "Add point"') &&
			checks.includes('name: "Remove point"'),
	);
	assert(checks.includes("bubbleEditorCrossRetry") && checks.includes("keyButton.click()"));
	assert(
		control.includes('keyboard.press("Control+z")') &&
			control.includes('keyboard.press("Control+Shift+z")'),
	);
	assert(!/request\(["'](?:apply|editor-tasks)/.test(checks + control));
	assert(
		control.includes("input.fill") && control.includes('input.press("Enter")'),
	);
});

test("native rejection browser exception is narrow and bound to verified UI rejection count", () => {
	const evidence = {
		errors: [],
		externalRequests: [],
		validatedRejections: [{}],
		httpFailures: [{ status: 409, path: "/api/apply" }],
		consoleErrors: [
			"Failed to load resource: the server responded with a status of 409 (Conflict)",
		],
		requestFailures: [],
		localPointErrors: [],
	};
	evidence.validatedRejections = [{ boundary: "http-native", body: { accepted: false, message: "Invalid Bubble trajectory: InvalidPointTime" } }];
	assert.doesNotThrow(() => assertBubbleEditorBrowserErrors(evidence));
	assert.throws(() =>
		assertBubbleEditorBrowserErrors({ ...evidence, validatedRejections: [] }),
	);
	assert.throws(() =>
		assertBubbleEditorBrowserErrors({
			...evidence,
			httpFailures: [{ status: 409, path: "/api/context" }],
		}),
	);
	assert.throws(() =>
		assertBubbleEditorBrowserErrors({
			...evidence,
			errors: ["unexpected page error"],
		}),
	);
});

test("409 correlation requires native duplicate-time semantics and the actual duplicate request", () => {
	const body = { accepted: false, message: "Invalid Bubble trajectory: InvalidPointTime" };
	assertBubbleEditorDuplicateRejection(body, JSON.stringify({ operations: [{ editing: { params: { point0Time: 0, point1Time: 0 } } }] }));
	for (const invalid of [{ accepted: true, message: body.message }, { accepted: false, message: "revision-conflict" }, { accepted: false, message: "BorrowMutError" }])
		assert.throws(() => assertBubbleEditorDuplicateRejection(invalid, '{"point0Time":0,"point1Time":0}'));
	assert.throws(() => assertBubbleEditorDuplicateRejection(body, '{"point0Time":0,"point1Time":120000}'));
});

test("runner observes failed requests and rejects them even without HTTP responses", async () => {
	const handlers = new Map();
	const evidence = { requestFailures: [], applyRequests: [], applyRejections: [], localPointErrors: [], errors: [], externalRequests: [], warnings: [], consoleErrors: [], httpFailures: [], validatedRejections: [] };
	await observeBubbleEditorPage({ route: async () => {}, on: (event, callback) => handlers.set(event, callback) }, "http://127.0.0.1/", evidence);
	handlers.get("requestfailed")({ url: () => "http://127.0.0.1/api/resource", failure: () => ({ errorText: "net::ERR_FAILED" }) });
	assert.equal(evidence.requestFailures.length, 1);
	assert.throws(() => assertBubbleEditorBrowserErrors(evidence));
});

test("preview errors are only accompanying diagnostics of a fresh verified DOM commit rejection", () => {
	const message = "Failed to render preview frame: Error: Invalid Bubble trajectory: InvalidPointTime\n    at buildPasses ([private URL redacted]";
	assert(isBubbleEditorPointPreviewError(message));
	for (const unexpected of ["BorrowMutError", message + "\nother panic", message.replace("InvalidPointTime", "unreachable")])
		assert(!isBubbleEditorPointPreviewError(unexpected));
	const evidence = { errors: [], externalRequests: [], requestFailures: [], httpFailures: [],
		consoleErrors: [message], localPointErrors: [{ attempt: "a", consoleIndex: 0 }],
		validatedRejections: [{ attempt: "a", boundary: "local-dom-commit-rejection", nativeConsoleIndices: [0], applyWrites: 0,
			commitCycle: { attempt: "a", initialBusy: "false", initialDisabled: false, connected: true,
				busyValues: ["false", "true", "false"], busy: "false", disabled: false },
			snapshotUnchanged: true, savedBytesUnchanged: true, draftVisible: true }] };
	assertBubbleEditorBrowserErrors(evidence);
	assert.throws(() => assertBubbleEditorBrowserErrors({ ...evidence, validatedRejections: [] }));
	assert.throws(() => assertBubbleEditorBrowserErrors({ ...evidence, validatedRejections: [{ ...evidence.validatedRejections[0], applyWrites: 1 }] }));
	assert.throws(() => assertBubbleEditorBrowserErrors({ ...evidence, consoleErrors: ["BorrowMutError"] }));
});

test("Host lifecycle uses isolated project and real host close/reopen, no export job project", async () => {
	const host = await readFile(
		fileURLToPath(new URL("./bubble-editor-host.mjs", import.meta.url)),
		"utf8",
	);
	assert(host.includes('assert.rejects(lstat(join(root, "project"))'));
	assert(
		host.includes("await startHost(options)") &&
			host.includes("await host.close()"),
	);
	assert(
		host.includes('join(root, "expected-edited.json")') &&
			host.includes('join(root, "project-final-ui.json")'),
	);
	assert(
		host.includes("assert.deepEqual(await snapshot(request), expected)") &&
			host.includes("verifyResource()"),
	);
});

test("cleanup sends verify only after completed checks, otherwise stop, and closes owned browser resources", async () => {
	for (const verify of [true, false]) {
		const calls = [];
		const result = await closeBlazeEditorResources({
			verify,
			browser: {
				close: async () => {
					calls.push("browser");
				},
			},
			server: {
				close: async () => {
					calls.push("server");
				},
			},
			host: {
				child: {
					exitCode: null,
					signalCode: null,
					stdin: {
						end: (text) => {
							calls.push(text.trim());
						},
					},
				},
				closed: Promise.resolve({ code: 0, signal: null }),
			},
		});
		assert.deepEqual(calls, ["browser", "server", verify ? "verify" : "stop"]);
		assert(result.hostClosed && result.browserClosed && !result.forced);
		assert.deepEqual(result.errors, []);
	}
});

test("cleanup reports a failed private Host rather than claiming acceptance", async () => {
	const result = await closeBlazeEditorResources({
		verify: true,
		host: {
			child: { exitCode: 1, signalCode: null },
			closed: Promise.resolve({ code: 1, signal: null }),
		},
	});
	assert.equal(result.hostClosed, false);
	assert.equal(result.forced, false);
	assert.equal(result.errors.length, 1);
});
