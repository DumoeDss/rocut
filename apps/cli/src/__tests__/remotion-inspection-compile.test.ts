import { expect, test } from "bun:test";
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { revisionFixture } from "./programmatic-build-revision-fixture";
import { createRemotionInspectionSession } from "../programmatic/remotion-inspection-service";
import {
	loadProgrammaticResource,
	resourceDigest,
} from "../programmatic/resources";

const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR;

test.skipIf(!executable || !toolchainDirectory)(
	"real compile-inspected saves original immutable snapshot after author directory disappears without applying timeline",
	async () => {
		const fixture = await revisionFixture("remotion", toolchainDirectory!);
		const session = createRemotionInspectionSession({
			context: fixture.context,
			executable: executable!,
			toolchainDirectory: toolchainDirectory!,
			enqueue: async <T>(task: () => Promise<T>) => task(),
		});
		try {
			const original = fixture.code.replace(
				"durationInFrames={60}",
				"durationInFrames={60} calculateMetadata={async({props})=>({width:80,height:96,durationInFrames:90,props:{...props,derived:'resolved'}})}",
			);
			await writeFile(
				join(fixture.author, fixture.entryFile),
				original,
				"utf8",
			);
			const recordBefore = await fixture.readRecord();
			const headersBefore = await fixture.headers();
			const clipsBefore = await fixture.host.automation.clips();
			const receipt = await session.perform(
				"inspect",
				{
					version: 1,
					sourceDirectory: fixture.author,
					entryFile: fixture.entryFile,
					files: fixture.spec.files,
					seed: 7,
					inputProps: fixture.spec.inputProps,
				},
				new AbortController().signal,
			);
			if (!("revision" in receipt)) throw Error("Expected inspection receipt");
			expect(receipt.compositions).toMatchObject([
				{
					id: "Rocut",
					width: 80,
					height: 96,
					durationFrames: 90,
					props: {
						caption: "initial-prop",
						preserved: "yes",
						derived: "resolved",
					},
				},
			]);
			expect(await fixture.headers()).toEqual(headersBefore);
			expect(await fixture.readRecord()).toBe(recordBefore);
			await writeFile(
				join(fixture.author, fixture.entryFile),
				"throw Error('changed source must never execute');",
				"utf8",
			);
			await rename(fixture.author, join(fixture.root, "author-removed"));
			const selection = {
				revision: receipt.revision,
				compositionId: "Rocut",
				frameRate: { numerator: 30, denominator: 1 },
			};
			const result = await session.perform(
				"compile-inspected",
				selection,
				new AbortController().signal,
			);
			if (!("source" in result) || !result.source.build)
				throw Error("Expected saved compiled source");
			expect(result.inspectionRevision).toBe(receipt.revision);
			expect(result.metadataStability).toBe(
				"rechecked-before-compile; runtime-geometry-checked; runtime-props-not-pinned",
			);
			expect(result.source).toMatchObject({
				width: 80,
				height: 96,
				durationFrames: 90,
				frameRate: selection.frameRate,
				seed: 7,
				build: {
					engine: "remotion",
					engineVersion: "4.0.440",
					compositionId: "Rocut",
					inputProps: fixture.spec.inputProps,
				},
			});
			expect(result.source.build.inputs).toEqual(receipt.inputs);
			expect(result.source.build.toolchainLock.sha256).toBe(
				receipt.toolchainLockSha256,
			);
			const archived = await loadProgrammaticResource({
				...fixture.context,
				resource: result.source.build.inputs.find(
					(resource) => resource.id === fixture.entryFile,
				)!,
			});
			expect(
				new TextDecoder("utf-8", { fatal: true }).decode(archived.body),
			).toBe(original);
			expect(archived.resource.sha256).toBe(
				resourceDigest(new TextEncoder().encode(original).buffer),
			);
			for (const resource of result.source.build.inputs)
				expect(
					(await loadProgrammaticResource({ ...fixture.context, resource }))
						.resource,
				).toEqual(resource);
			const lock = await loadProgrammaticResource({
				...fixture.context,
				resource: result.source.build.toolchainLock,
			});
			expect(
				JSON.parse(new TextDecoder().decode(lock.body)).adapter,
			).toMatchObject({ id: "rocut-remotion-html", version: 1 });
			const document = await loadProgrammaticResource({
				...fixture.context,
				resource: result.source.resources!.find(
					(resource) => resource.id === result.source.documentId,
				)!,
			});
			const html = new TextDecoder("utf-8", { fatal: true }).decode(
				document.body,
			);
			expect(html).toContain("__rocutRenderRemotionFrame");
			expect(html).not.toContain(fixture.author);
			expect(html).not.toContain("changed source must never execute");
			expect(await fixture.readRecord()).toBe(recordBefore);
			expect(await fixture.host.automation.clips()).toEqual(clipsBefore);
			const headersAfter = await fixture.headers();
			expect(headersAfter.length).toBeGreaterThan(headersBefore.length);
			await expect(
				session.perform(
					"compile-inspected",
					selection,
					new AbortController().signal,
				),
			).rejects.toThrow("revision unavailable");
			expect(await fixture.headers()).toEqual(headersAfter);
			expect(await fixture.readRecord()).toBe(recordBefore);
		} finally {
			session.clear();
			await fixture.cleanup();
		}
	},
	60000,
);
