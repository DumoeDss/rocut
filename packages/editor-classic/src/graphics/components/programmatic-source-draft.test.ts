import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	getSourceDraft,
	ProgrammaticSourceDraft,
	sourceReadOnlyReason,
} from "./programmatic-source-draft";

const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: "canvas.width = 64;",
	width: 64,
	height: 32,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 90,
	seed: 7,
};

test("unmounted clean drafts are released; dirty drafts survive and release after Discard", () => {
	const owner = {};
	const clean = getSourceDraft({ owner, key: "clean", source });
	clean.subscribe(() => {})();
	expect(getSourceDraft({ owner, key: "clean", source })).not.toBe(clean);
	const dirty = getSourceDraft({ owner, key: "dirty", source });
	const stop = dirty.subscribe(() => {});
	dirty.edit({ code: "retained" });
	stop();
	expect(getSourceDraft({ owner, key: "dirty", source })).toBe(dirty);
	dirty.discard();
	expect(getSourceDraft({ owner, key: "dirty", source })).not.toBe(dirty);
	// React may unsubscribe/re-subscribe the same controller during a mount.
	const stopAgain = clean.subscribe(() => {});
	clean.edit({ code: "newly dirty" });
	stopAgain();
	expect(getSourceDraft({ owner, key: "clean", source })).toBe(clean);
});

test("drafts survive selection changes without leaking between clips or sessions", () => {
	const owner = {};
	const a = getSourceDraft({ owner, key: "clip-a", source });
	a.edit({ code: "draft A" });
	const b = getSourceDraft({ owner, key: "clip-b", source });
	expect(b.getSnapshot().dirty).toBe(false);
	expect(getSourceDraft({ owner, key: "clip-a", source })).toBe(a);
	expect(a.getSnapshot().code).toBe("draft A");
	expect(
		getSourceDraft({ owner: {}, key: "clip-a", source }).getSnapshot().code,
	).toBe(source.code);
});

test("external edits retain dirty text, block apply and make Discard load latest", async () => {
	const draft = new ProgrammaticSourceDraft(source);
	draft.edit({ code: "my unsaved code" });
	const external = { ...source, seed: 91, code: "external code" };
	draft.refresh(external);
	expect(draft.getSnapshot()).toMatchObject({
		code: "my unsaved code",
		conflict: true,
	});
	let calls = 0;
	await draft.apply(async () => {
		calls++;
		return source;
	});
	expect(calls).toBe(0);
	draft.discard();
	expect(draft.getSnapshot()).toMatchObject({
		code: "external code",
		seed: "91",
		dirty: false,
		conflict: false,
	});
});

test("clean drafts follow undo/redo and errors preserve the unapplied draft", async () => {
	const draft = new ProgrammaticSourceDraft(source);
	draft.refresh({ ...source, code: "undo" });
	expect(draft.getSnapshot().code).toBe("undo");
	draft.edit({ code: "attempt" });
	await draft.apply(async () => {
		throw new Error("Rust rejected the source");
	});
	expect(draft.getSnapshot()).toMatchObject({
		code: "attempt",
		dirty: true,
		pending: false,
		error: "Rust rejected the source",
	});
});

test("pending apply is single-flight and late completion preserves newer publication", async () => {
	const draft = new ProgrammaticSourceDraft(source);
	draft.edit({ code: "submitted" });
	let complete!: (source: ProgrammaticSource) => void;
	const pending = draft.apply(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	expect(draft.getSnapshot().pending).toBe(true);
	draft.edit({ code: "must not replace submitted" });
	draft.discard();
	await draft.apply(async () => {
		throw new Error("duplicate apply");
	});
	draft.refresh({ ...source, code: "newer external" });
	complete({ ...source, code: "submitted" });
	await pending;
	expect(draft.getSnapshot()).toMatchObject({
		code: "newer external",
		dirty: false,
		pending: false,
	});
});

test("successful apply makes one clean baseline, while compiled/document sources are read-only", async () => {
	const draft = new ProgrammaticSourceDraft(source);
	draft.edit({ code: "applied", seed: "8" });
	await draft.apply(async (state) => ({
		...state.baseline,
		code: state.code,
		seed: Number(state.seed),
	}));
	expect(draft.getSnapshot()).toMatchObject({
		code: "applied",
		seed: "8",
		dirty: false,
	});
	expect(sourceReadOnlyReason(source)).toBeNull();
	expect(
		sourceReadOnlyReason({ ...source, documentId: "document.html" }),
	).toContain("attachment");
	const resource = {
		id: "author",
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 1,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
	};
	for (const engine of ["hyperframes", "remotion", "three"] as const) {
		expect(
			sourceReadOnlyReason({
				...source,
				build: {
					version: 1,
					engine,
					engineVersion: "pinned",
					entryFile: "index",
					inputs: [resource],
					toolchainLock: resource,
				},
			}),
		).toBe(
			"The generated HTML is read-only. Edit its archived author files below, then recompile to update this clip.",
		);
	}
});
