import { expect, test } from "bun:test";
import {
	isProgrammaticResource,
	type ProgrammaticResource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import {
	getBuildDraft,
	ProgrammaticBuildDraft,
} from "./programmatic-build-draft";
import { loadAuthorText } from "./programmatic-build-text";

async function fixture() {
	const blobs = new Map<string, Blob>();
	async function resource({
		id,
		kind,
		code,
	}: {
		id: string;
		kind: "source" | "document";
		code: string;
	}): Promise<ProgrammaticResource> {
		const body = new TextEncoder().encode(code);
		const sha256 = Buffer.from(
			await crypto.subtle.digest("SHA-256", body),
		).toString("hex");
		const mimeType =
			kind === "source" ? "application/octet-stream" : "text/html";
		blobs.set(id, new Blob([body], { type: mimeType }));
		return {
			id,
			kind,
			byteLength: body.length,
			sha256,
			mimeType,
			attachmentKey: `programmatic-${kind === "source" ? "source-" : ""}sha256-${sha256}`,
		};
	}
	const inputs = [
		await resource({
			id: "index.tsx",
			kind: "source",
			code: "\ufeffexport default 1;",
		}),
		await resource({ id: "empty.css", kind: "source", code: "" }),
	];
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "_rocut/compiled.html",
		width: 64,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
		resources: [
			await resource({
				id: "_rocut/compiled.html",
				kind: "document",
				code: "<div>fixture</div>",
			}),
		],
		build: {
			version: 1,
			engine: "remotion",
			engineVersion: "4.0.440",
			entryFile: "index.tsx",
			compositionId: "Main",
			inputs,
			toolchainLock: await resource({
				id: "_rocut/toolchain-lock.json",
				kind: "source",
				code: "{}",
			}),
		},
	};
	const reads: string[] = [],
		requests: unknown[] = [];
	const revised: ProgrammaticSource = { ...source, seed: 8 };
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("No rasterizer in UI-state test");
		},
		loadResource: async ({ resource: value }) => {
			if (!isProgrammaticResource(value))
				throw Error("Invalid resource descriptor");
			const id = value.id;
			reads.push(id);
			const blob = blobs.get(id);
			if (!blob) throw Error("Missing attachment");
			return blob;
		},
		reviseBuild: async ({ request }) => {
			requests.push(request);
			return { source: revised, reusedDocument: false };
		},
	};
	return { source, revised, provider, reads, requests, blobs };
}

test("author file loading verifies actual bytes, retains BOM/empty files and only reads selected input", async () => {
	const f = await fixture();
	const draft = new ProgrammaticBuildDraft(f.source);
	await draft.load(f.provider);
	expect(draft.getSnapshot().files["index.tsx"].code).toBe(
		"\ufeffexport default 1;",
	);
	expect(f.reads).toEqual(["index.tsx"]);
	draft.edit({ code: "export default 2;" });
	draft.select("empty.css");
	await draft.load(f.provider);
	expect(draft.getSnapshot().files["empty.css"].code).toBe("");
	draft.select("index.tsx");
	await draft.load(f.provider);
	expect(f.reads).toEqual(["index.tsx", "empty.css"]);
	expect(draft.getSnapshot().files["index.tsx"].code).toBe("export default 2;");
	expect(draft.getSnapshot().dirty).toBe(true);
	for (const blob of [
		new Blob(["changed"], { type: "application/octet-stream" }),
		new Blob([new Uint8Array(f.source.build!.inputs[0].byteLength)], {
			type: "application/octet-stream",
		}),
	]) {
		f.blobs.set("index.tsx", blob);
		await expect(
			loadAuthorText({
				source: f.source,
				id: "index.tsx",
				provider: f.provider,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("mismatch");
	}
});

test("revision submits only edited files/props and retains drafts across file selection and failure", async () => {
	const f = await fixture();
	const draft = new ProgrammaticBuildDraft(f.source);
	await draft.load(f.provider);
	draft.edit({ code: "edited", inputProps: '{"title":"new"}' });
	let commits = 0;
	await draft.apply({
		provider: {
			...f.provider,
			reviseBuild: async () => {
				throw Error("Compiler unavailable");
			},
		},
		commit: async () => {
			commits++;
		},
	});
	expect(draft.getSnapshot().error).toBe("Compiler unavailable");
	expect(draft.getSnapshot().files["index.tsx"].code).toBe("edited");
	expect(draft.getSnapshot().dirty).toBe(true);
	expect(commits).toBe(0);
	await draft.apply({
		provider: f.provider,
		commit: async (baseline, replacement) => {
			expect(baseline).toEqual(f.source);
			expect(replacement).toEqual(f.revised);
			commits++;
		},
	});
	expect(f.requests).toEqual([
		{
			source: f.source,
			changes: [{ id: "index.tsx", code: "edited" }],
			inputProps: { title: "new" },
		},
	]);
	expect(commits).toBe(1);
	expect(draft.getSnapshot().dirty).toBe(false);
	expect(draft.getSnapshot().baseline).toEqual(f.revised);
});

test("props-only revisions and invalid props/transport never manufacture a successful save", async () => {
	const f = await fixture();
	const draft = new ProgrammaticBuildDraft(f.source);
	let commits = 0;
	const commit = async () => {
		commits++;
	};
	for (const inputProps of ["[1]", "null", "{bad}"]) {
		draft.edit({ inputProps });
		await draft.apply({ provider: f.provider, commit });
		expect(draft.getSnapshot().error).toBeTruthy();
	}
	expect(f.requests).toHaveLength(0);
	draft.edit({ inputProps: '{"title":"props only"}' });
	await draft.apply({
		provider: { ...f.provider, reviseBuild: async () => ({ source: null }) },
		commit,
	});
	expect(draft.getSnapshot().error).toContain("invalid archived source");
	expect(commits).toBe(0);
	await draft.apply({ provider: f.provider, commit });
	expect(f.requests[0]).toMatchObject({
		changes: [],
		inputProps: { title: "props only" },
	});
	expect(commits).toBe(1);
});

test("cancel and external source changes prevent late compiler results from committing", async () => {
	for (const external of [false, true]) {
		const f = await fixture();
		const draft = new ProgrammaticBuildDraft(f.source);
		draft.edit({ inputProps: '{"title":"mine"}' });
		let release!: (value: unknown) => void,
			commits = 0;
		const gate = new Promise<unknown>((resolve) => {
			release = resolve;
		});
		const pending = draft.apply({
			provider: { ...f.provider, reviseBuild: () => gate },
			commit: async () => {
				commits++;
			},
		});
		if (external) draft.refresh({ ...f.source, seed: 900 });
		else draft.cancel();
		release({ source: f.revised, reusedDocument: false });
		await pending;
		expect(commits).toBe(0);
		expect(draft.getSnapshot().dirty).toBe(true);
		expect(draft.getSnapshot().phase).toBeNull();
		if (external) {
			expect(draft.getSnapshot().conflict).toBe(true);
			draft.discard();
			expect(draft.getSnapshot().baseline.seed).toBe(900);
		}
	}
});

test("late cancelled loads cannot replace the next file and failed transactions preserve authored changes", async () => {
	const f = await fixture();
	const draft = new ProgrammaticBuildDraft(f.source);
	let release!: (blob: Blob) => void;
	const delayed = draft.load({
		...f.provider,
		loadResource: () =>
			new Promise((r) => {
				release = r;
			}),
	});
	draft.select("empty.css");
	await draft.load(f.provider);
	release(f.blobs.get("index.tsx")!);
	await delayed;
	expect(draft.getSnapshot().files["index.tsx"]).toBeUndefined();
	draft.edit({ code: "body {}" });
	await draft.apply({
		provider: f.provider,
		commit: async () => {
			throw Error("Storage failed");
		},
	});
	expect(draft.getSnapshot().error).toBe("Storage failed");
	expect(draft.getSnapshot().files["empty.css"].code).toBe("body {}");
	expect(draft.getSnapshot().dirty).toBe(true);
});

test("unapplied author drafts survive selection changes but never cross editor sessions", async () => {
	const { source } = await fixture();
	const owner = {};
	const draft = getBuildDraft({
		owner,
		key: "project/scene/track/clip",
		source,
	});
	const detach = draft.subscribe(() => {});
	draft.edit({ inputProps: '{"message":"retained"}' });
	detach();
	expect(
		getBuildDraft({ owner, key: "project/scene/track/clip", source }),
	).toBe(draft);
	expect(
		getBuildDraft({ owner: {}, key: "project/scene/track/clip", source }),
	).not.toBe(draft);
	draft.discard();
	expect(
		getBuildDraft({ owner, key: "project/scene/track/clip", source }),
	).not.toBe(draft);
});
