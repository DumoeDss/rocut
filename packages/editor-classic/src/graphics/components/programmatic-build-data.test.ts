import { expect, test } from "bun:test";
import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { ProgrammaticBuildDraft } from "./programmatic-build-draft";
import { isAuthorTextFile, loadAuthorText } from "./programmatic-build-text";

async function fixture({
	id,
	bytes,
}: {
	id: string;
	bytes: Uint8Array<ArrayBuffer>;
}) {
	const sha256 = Buffer.from(
		await crypto.subtle.digest("SHA-256", bytes),
	).toString("hex");
	const input: ProgrammaticResource = {
		id,
		kind: "source",
		byteLength: bytes.length,
		sha256,
		mimeType: "application/octet-stream",
		attachmentKey: `programmatic-source-sha256-${sha256}`,
	};
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "html-document",
		code: "<html><body>data fixture</body></html>",
		width: 32,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 7,
		build: {
			version: 1,
			engine: "remotion",
			engineVersion: "4.0.440",
			entryFile: "index.tsx",
			compositionId: "Main",
			inputs: [{ ...input, id: "index.tsx" }, input],
			toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
		},
	};
	const reads: unknown[] = [],
		requests: unknown[] = [];
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("No rendering in author draft tests");
		},
		loadResource: async ({ resource }) => {
			reads.push(resource);
			return new Blob([bytes], { type: input.mimeType });
		},
		reviseBuild: async ({ request }) => {
			requests.push(request);
			return { source, reusedDocument: true };
		},
	};
	return { source, input, provider, reads, requests };
}

test("declared data and captions can be selected, loaded losslessly and submitted as author edits", async () => {
	for (const extension of ["json", "txt", "csv", "srt", "vtt", "lrc"]) {
		const id = `public/歌詞.${extension}`;
		const code = "\ufeff歌詞, café 🎵\r\nsecond line\n";
		const f = await fixture({ id, bytes: new TextEncoder().encode(code) });
		expect(isAuthorTextFile(id)).toBe(true);
		expect(isAuthorTextFile(id.toUpperCase())).toBe(true);
		const draft = new ProgrammaticBuildDraft(f.source);
		draft.select(id);
		await draft.load(f.provider);
		expect(draft.getSnapshot().selectedId).toBe(id);
		expect(draft.getSnapshot().files[id].code).toBe(code);
		expect(f.reads).toEqual([f.input]);
		const edited = `${code}変更\n`;
		draft.edit({ code: edited });
		let commits = 0;
		await draft.apply({
			provider: f.provider,
			commit: async () => {
				commits++;
			},
		});
		expect(f.requests).toEqual([
			{ source: f.source, changes: [{ id, code: edited }] },
		]);
		expect(commits).toBe(1);
		expect(draft.getSnapshot().error).toBeNull();
	}
});

test("binary or undeclared author files never load, and malformed UTF-8 fails after digest verification", async () => {
	for (const id of ["public/a.wav", "public/a.png", "public/a.srt.bin"]) {
		const f = await fixture({ id, bytes: new Uint8Array([1, 2, 3]) });
		expect(isAuthorTextFile(id)).toBe(false);
		await expect(
			loadAuthorText({
				source: f.source,
				id,
				provider: f.provider,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("archived text");
		expect(f.reads).toHaveLength(0);
	}
	const f = await fixture({
		id: "public/captions.srt",
		bytes: new Uint8Array([0xc3, 0x28]),
	});
	await expect(
		loadAuthorText({
			source: f.source,
			id: "public/unknown.txt",
			provider: f.provider,
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("archived text");
	expect(f.reads).toHaveLength(0);
	await expect(
		loadAuthorText({
			source: f.source,
			id: f.input.id,
			provider: f.provider,
			signal: new AbortController().signal,
		}),
	).rejects.toThrow();
	expect(f.reads).toEqual([f.input]);
});
