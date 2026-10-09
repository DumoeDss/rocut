import { expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
	prepareStaticDataFixture,
	readStaticDataManifest,
	staticData,
} from "../../../../script/fixtures/remotion-static-data-fixture";

const toolchain = process.env.ROCUT_TEST_REMOTION_TOOLCHAIN;
async function removeFixture(root: string, parent: string) {
	if (
		dirname(root) !== parent ||
		!basename(root).startsWith("rocut-remotion-static-")
	)
		throw Error("Unsafe static-data test cleanup");
	await rm(root, { recursive: true, force: true });
}
test.skipIf(!toolchain)(
	"Remotion archives public JSON/captions without changing module imports, then rebuilds/revises offline",
	async () => {
		const parent = resolve(tmpdir());
		const root = await mkdtemp(join(parent, "rocut-remotion-static-"));
		try {
			const fixture = await prepareStaticDataFixture(root, toolchain!);
			const { source } = await fixture.compile(
				"compile",
				fixture.specification,
			);
			const html = await fixture.document(source);
			expect(html).not.toContain(fixture.specification.sourceDirectory);
			expect(html).not.toContain(toolchain!);
			const inventory = readStaticDataManifest(html);
			expect(inventory).toHaveLength(6);
			for (const file of inventory) {
				const text = staticData[file.name as keyof typeof staticData];
				expect(
					Buffer.from(file.src.split(",")[1]!, "base64").toString("utf8"),
				).toBe(text);
				expect(file.src).toMatch(
					/^data:(application\/(json|x-subrip)|text\/(plain|csv|vtt));charset=utf-8;base64,/,
				);
				expect(file.sizeInBytes).toBe(Buffer.byteLength(text));
				expect(file.lastModified).toBe(0);
			}
			await rename(
				fixture.specification.sourceDirectory,
				join(root, "author-moved"),
			);
			const rebuilt = await fixture.compile(
				"rebuild",
				JSON.parse(JSON.stringify(source)),
			);
			expect(rebuilt).toEqual({ source, reusedDocument: true });
			expect(await fixture.document(rebuilt.source)).toBe(html);
			const code = "[00:00.00]修改后的歌词\r\n";
			const revised = await fixture.compile("revise", {
				source,
				changes: [{ id: "public/captions/lyrics.lrc", code }],
			});
			const updated = readStaticDataManifest(
				await fixture.document(revised.source),
			);
			const lyrics = updated.find(
				(file) => file.name === "captions/lyrics.lrc",
			)!;
			expect(
				Buffer.from(lyrics.src.split(",")[1]!, "base64").toString("utf8"),
			).toBe(code);
			expect(
				revised.source.build!.inputs.find((file) =>
					file.id.endsWith("lyrics.lrc"),
				)!.sha256,
			).not.toBe(
				source.build!.inputs.find((file) => file.id.endsWith("lyrics.lrc"))!
					.sha256,
			);
		} finally {
			await removeFixture(root, parent);
		}
	},
	60000,
);

test.skipIf(!toolchain)(
	"Remotion rejects malformed UTF-8 and unknown public binary assets",
	async () => {
		const parent = resolve(tmpdir());
		const root = await mkdtemp(join(parent, "rocut-remotion-static-"));
		try {
			const fixture = await prepareStaticDataFixture(root, toolchain!);
			await writeFile(
				join(
					fixture.specification.sourceDirectory,
					"public/captions/lyrics.txt",
				),
				Buffer.from([0xc3, 0x28]),
			);
			await expect(
				fixture.compile("compile", fixture.specification),
			).rejects.toThrow(/encoded data|encoding|UTF-8/i);
			await writeFile(
				join(
					fixture.specification.sourceDirectory,
					"public/captions/lyrics.txt",
				),
				staticData["captions/lyrics.txt"],
			);
			await writeFile(
				join(fixture.specification.sourceDirectory, "public/payload.bin"),
				Buffer.from([1, 2, 3]),
			);
			await expect(
				fixture.compile("compile", {
					...fixture.specification,
					files: [...fixture.specification.files, "public/payload.bin"],
				}),
			).rejects.toThrow("Unsupported Remotion static asset");
		} finally {
			await removeFixture(root, parent);
		}
	},
	60000,
);
