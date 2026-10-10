import { expect, spyOn, test } from "bun:test";
import { blazeHostClips } from "./blaze-host-cases";
import {
	blazeHostFields,
	blazeHostParams,
	blazeHostSettings,
	type BlazeHostShot,
} from "./blaze-host-contract";
import {
	blazeEditorChanges,
	blazeEditorContract,
	blazeEditorFiles,
	blazeEditorSeekTicks,
} from "./blaze-editor-contract.mjs";
import {
	blazeEditorHistory,
	blazeEditorRequest,
	blazeEditorTimecode,
} from "./blaze-editor-control.mjs";
import {
	blazeEditorExpectedEdit,
	blazeEditorUnchangedOthers,
} from "./blaze-editor-inputs.mjs";
import { blazeEditorRedact } from "./blaze-editor-lifecycle.mjs";

const staticShot: BlazeHostShot = {
	source: { ...blazeHostSettings, resources: [{ id: "private-image" }] },
	effects: [
		{
			id: "template-blaze",
			type: "blaze",
			enabled: true,
			params: { ...blazeHostParams },
		},
	],
	animations: {},
};
const clips = () => blazeHostClips({ staticShot, animatedShot: staticShot });

test("ten actual input edits are distinct legal values with stable labels and complete field coverage", () => {
	expect(blazeEditorChanges).toHaveLength(10);
	expect(blazeEditorChanges.map((change) => change.key).sort()).toEqual(
		Object.keys(blazeHostParams).sort(),
	);
	for (const change of blazeEditorChanges) {
		const field = blazeHostFields.find(([key]) => key === change.key)!;
		expect(change.value).toBeGreaterThanOrEqual(field[1]);
		expect(change.value).toBeLessThanOrEqual(field[2]);
		expect(change.value).not.toBe(
			blazeHostParams[change.key as keyof typeof blazeHostParams],
		);
		expect(change.label.length).toBeGreaterThan(0);
		if (change.key === "seed")
			expect(Number.isInteger(change.value)).toBe(true);
	}
	expect(
		Object.isFrozen(blazeEditorChanges) &&
			blazeEditorChanges.every(Object.isFrozen),
	).toBe(true);
	expect(blazeHostSettings.width).toBe(blazeEditorContract.width);
	expect(blazeHostSettings.height).toBe(blazeEditorContract.height);
});

test("UI expected edits change only the intended effect parameter and preserve sources and other effects", () => {
	const original = clips()[0],
		saved = structuredClone(original);
	original.editing.effects.push({
		id: "unrelated-effect",
		type: "other",
		enabled: false,
		params: { untouched: 42 },
	});
	for (const change of blazeEditorChanges) {
		const result = blazeEditorExpectedEdit(original, change.key, change.value);
		expect(result.editing.programmatic).toEqual(original.editing.programmatic);
		expect(result.editing.effects[1]).toEqual(original.editing.effects[1]);
		const restored = structuredClone(result);
		restored.editing.effects[0].params[change.key] =
			original.editing.effects[0].params[change.key];
		expect(restored).toEqual(original);
	}
	expect(original.editing.effects[0]).toEqual(saved.editing.effects[0]);
	expect(() => blazeEditorExpectedEdit(original, "unknown", 1)).toThrow();
	expect(() => blazeEditorExpectedEdit(original, "amount", NaN)).toThrow();
});

test("other-clip guard rejects sentinel, disabled, animation and track changes during edit/history stages", () => {
	const before = {
		clips: clips(),
		tracks: [{ id: "blaze-shots", hidden: false }],
		revision: 1,
	};
	const after = structuredClone(before);
	after.clips[0] = blazeEditorExpectedEdit(after.clips[0], "amount", 0.9);
	after.revision = 2;
	expect(() =>
		blazeEditorUnchangedOthers(before, after, "blaze-static"),
	).not.toThrow();
	for (const index of [1, 2, 3]) {
		const altered = structuredClone(after);
		altered.clips[index].editing.name = "unexpected";
		expect(() =>
			blazeEditorUnchangedOthers(before, altered, "blaze-static"),
		).toThrow();
	}
	const altered = structuredClone(after);
	altered.tracks[0].hidden = true;
	expect(() =>
		blazeEditorUnchangedOthers(before, altered, "blaze-static"),
	).toThrow();
});

test("seek actions use exact 30fps timecode through forward reverse and repeated frame requests", () => {
	expect(blazeEditorSeekTicks.map(blazeEditorTimecode)).toEqual([
		"00:00:01:01",
		"00:00:01:03",
		"00:00:01:06",
		"00:00:01:03",
		"00:00:01:01",
	]);
	expect(blazeEditorTimecode(24000)).toBe("00:00:00:06");
	expect(blazeEditorTimecode(432000000)).toBe("01:00:00:00");
	for (const ticks of [-4000, 1, 4000.5, Infinity, NaN])
		expect(() => blazeEditorTimecode(ticks)).toThrow();
});

test("scope excludes unperformed pixel export installed-plugin and keyframe-creation UI claims", () => {
	for (const key of [
		"keyframeUiCreationTested",
		"renderingPixelCorrectnessTested",
		"disabledPixelsTested",
		"videoExportTested",
		"installedPluginTested",
		"electronTested",
	] as const)
		expect(blazeEditorContract[key]).toBe(false);
	expect(blazeEditorContract.historyTested).toContain(
		"Attached editor session",
	);
	expect(blazeEditorFiles).toHaveLength(11);
	expect(new Set(blazeEditorFiles).size).toBe(11);
	expect(
		blazeEditorFiles.every((file) =>
			/^script\/(?:fixtures\/blaze-editor|probe-blaze-editor)/.test(file),
		),
	).toBe(true);
});

test("readiness URLs are removed from complete captured logs", () => {
	const privateUrl = "http://127.0.0.1:43210/private-session-token/";
	const log = JSON.stringify({ editorUrl: privateUrl }) + "\n";
	const redacted = blazeEditorRedact(log);
	expect(redacted).not.toContain("private-session-token");
	expect(redacted).not.toContain("43210");
	expect(redacted).toContain("private URL redacted");
});

const historyJob = (status: string, extra: Record<string, unknown> = {}) => ({
	id: "task-1234",
	surfaceId: "surface-1234",
	request: {
		kind: "history.status",
		expectedRevision: 7,
		idempotencyKey: "history-key",
	},
	status,
	...extra,
});

test("request helper requires 202 only for editor task creation and exact 200 elsewhere", async () => {
	const fetch = spyOn(globalThis, "fetch");
	try {
		const request = blazeEditorRequest("http://fixture.invalid/session/");
		for (const [route, body, status, accepted] of [
			["editor-tasks", { request: {} }, 202, true],
			["editor-tasks", { request: {} }, 200, false],
			["editor-tasks", { request: {} }, 409, false],
			["editor-tasks", undefined, 200, true],
			["editor-tasks", undefined, 202, false],
			["editor-tasks/task-1234", undefined, 200, true],
			["editor-tasks/task-1234", undefined, 202, false],
			["other", {}, 202, false],
		] as const) {
			fetch.mockResolvedValueOnce(Response.json({ marker: true }, { status }));
			if (accepted)
				expect(await request(route, body)).toEqual({ marker: true });
			else await expect(request(route, body)).rejects.toThrow();
		}
	} finally {
		fetch.mockRestore();
	}
});

test("accepted asynchronous history creation polls running jobs to terminal complete without resubmitting", async () => {
	const result = { scope: "attached-session", count: 0 };
	const fetch = spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(Response.json({ revision: 7 }))
		.mockResolvedValueOnce(
			Response.json(historyJob("running"), { status: 202 }),
		)
		.mockResolvedValueOnce(Response.json(historyJob("running")))
		.mockResolvedValueOnce(Response.json(historyJob("complete", { result })));
	try {
		const history = blazeEditorHistory(
			blazeEditorRequest("http://fixture.invalid/session/"),
		);
		expect(await history("history.status", "history-key")).toEqual(result);
		expect(
			fetch.mock.calls.map(([url, options]) => [
				String(url),
				options?.method ?? "GET",
			]),
		).toEqual([
			["http://fixture.invalid/session/api/context", "GET"],
			["http://fixture.invalid/session/api/editor-tasks", "POST"],
			["http://fixture.invalid/session/api/editor-tasks/task-1234", "GET"],
			["http://fixture.invalid/session/api/editor-tasks/task-1234", "GET"],
		]);
		expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({
			request: historyJob("running").request,
		});
	} finally {
		fetch.mockRestore();
	}
});

test("history rejects terminal failures, unknown outcomes and inconsistent completion payloads", async () => {
	for (const job of [
		historyJob("failed", { error: "failed-task" }),
		historyJob("cancelled"),
		historyJob("outcome-unknown", { error: "surface-disconnected" }),
		historyJob("invalid-status"),
		historyJob("complete"),
		historyJob("complete", { result: undefined }),
		historyJob("complete", { result: {}, error: "hidden-failure" }),
		historyJob("complete", { result: {}, id: "different-task" }),
		historyJob("complete", { result: {}, surfaceId: "different-surface" }),
		historyJob("complete", {
			result: {},
			request: { ...historyJob("running").request, kind: "history.undo" },
		}),
	]) {
		const fetch = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ revision: 7 }))
			.mockResolvedValueOnce(
				Response.json(historyJob("running"), { status: 202 }),
			)
			.mockResolvedValueOnce(Response.json(job));
		try {
			const history = blazeEditorHistory(
				blazeEditorRequest("http://fixture.invalid/session/"),
			);
			await expect(history("history.status", "history-key")).rejects.toThrow();
			expect(fetch).toHaveBeenCalledTimes(3);
		} finally {
			fetch.mockRestore();
		}
	}
});

test("already terminal accepted tasks retain strict completion checks without unnecessary polling", async () => {
	for (const status of ["complete", "failed", "cancelled", "outcome-unknown"]) {
		const result = { scope: "attached-session", count: 0 };
		const fetch = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ revision: 7 }))
			.mockResolvedValueOnce(
				Response.json(historyJob(status, { result }), { status: 202 }),
			);
		try {
			const history = blazeEditorHistory(
				blazeEditorRequest("http://fixture.invalid/session/"),
			);
			if (status === "complete")
				expect(await history("history.status", "history-key")).toEqual(result);
			else
				await expect(
					history("history.status", "history-key"),
				).rejects.toThrow();
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			fetch.mockRestore();
		}
	}
});
