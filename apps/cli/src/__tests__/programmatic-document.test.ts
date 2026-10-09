import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { isProgrammaticSource } from "../../../../packages/editor-contracts/src/programmatic";
import { FileProjectStore } from "../file-store";
import { importProgrammaticResource } from "../programmatic/resource-import";
import { loadProgrammaticResources } from "../programmatic/resources";
import { resolveHtmlDocumentCode } from "../programmatic/document-resource";
import { htmlResourceBootstrap } from "../programmatic/html-resources";

test("large compiled HTML is portable, verified, strict UTF-8 and not duplicated as a font/URL", async () => {
	const parent = path.resolve(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-document-test-"));
	try {
		const filePath = path.join(root, "index.html");
		const code = `<script>/*${"x".repeat(600000)}*/</script><div>编译产物</div>`;
		await writeFile(filePath, code, "utf8");
		const options = { root: path.join(root, "project"), schemaVersion: 1 };
		const context = { store: new FileProjectStore(options), projectId: "fixture" };
		const input = { filePath, id: "build/index.html", kind: "document", mimeType: "text/html" };
		const { resource } = await importProgrammaticResource({ ...context, input });
		const source: ProgrammaticSource = {
			version: 1, runtime: "html-document", code: "", documentId: resource.id,
			width: 64, height: 64, durationFrames: 30, frameRate: { numerator: 30, denominator: 1 },
			seed: 1, resources: [resource],
		};
		expect(isProgrammaticSource(source)).toBe(true);
		expect(isProgrammaticSource({ ...source, documentId: null })).toBe(false);
		const loaded = await loadProgrammaticResources(
			{ ...context, store: new FileProjectStore(options) }, source.resources!, new AbortController().signal,
		);
		expect(resolveHtmlDocumentCode(source, loaded)).toBe(code);
		expect(htmlResourceBootstrap(loaded)).not.toContain(resource.id);
		expect(() => resolveHtmlDocumentCode(source, [])).toThrow("Missing HTML document");
		expect(resolveHtmlDocumentCode({ ...source, documentId: undefined, code: "<p>inline</p>" }, [])).toBe("<p>inline</p>");
		for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from("  \n")]) {
			await writeFile(filePath, bytes);
			await expect(importProgrammaticResource({ ...context, input })).rejects.toThrow();
		}
	} finally {
		if (path.dirname(root) !== parent || !path.basename(root).startsWith("rocut-document-test-"))
			throw Error("Unsafe document fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
