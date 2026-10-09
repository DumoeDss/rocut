import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgrammaticSourceFields } from "./programmatic-source-fields";
import { ProgrammaticSourceDraft } from "./programmatic-source-draft";

test("external read-only source keeps old draft selectable without presenting it as author code", () => {
	const draft = new ProgrammaticSourceDraft({
		version: 1,
		runtime: "canvas-worker",
		code: "original",
		width: 64,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 90,
		seed: 7,
	});
	draft.edit({ code: "my recoverable draft" });
	const html = renderToStaticMarkup(
		<ProgrammaticSourceFields
			id="source"
			runtime="html-document"
			state={draft.getSnapshot()}
			readOnly="Compile the archived author files."
			onEdit={() => {}}
		/>,
	);
	expect(html).toContain("Previous inline draft (read-only)");
	expect(html).toContain("my recoverable draft");
	expect(html).toContain('readonly=""');
	expect(html).not.toContain('disabled=""');
	expect(html).toContain("select and copy");
});
