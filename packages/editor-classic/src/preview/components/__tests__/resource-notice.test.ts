import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

await import("../../../editor/session/__tests__/wasm-test-mock");
const { BaseNode } = await import("../../../services/renderer/nodes/base-node");
const { MotionTextNode } =
	await import("../../../services/renderer/nodes/motion-text-node");
const { collectPreviewResourceIssues } =
	await import("../../resource-diagnostics");
const { PreviewResourceNotice } = await import("../resource-notice");
type Diagnostic =
	import("../../../services/renderer/motion-text/types").MotionTextRenderDiagnostic;

const missing: Diagnostic = {
	code: "missing-glyph",
	severity: "warning",
	fontId: "font:ko",
	message: "Motion-text font font:ko is missing 2 required glyphs.",
	codePoints: [0xbc14, 0xb78c],
};

function node({
	id,
	diagnostics,
}: {
	id: string;
	diagnostics: readonly Diagnostic[];
}) {
	// These tests inspect already-resolved diagnostics, never invoke rendering.
	const result = Object.create(MotionTextNode.prototype);
	return Object.assign(result, {
		params: { sequence: { id } },
		diagnostics,
		children: [],
	});
}

test("collects nested motion resources, deduplicates split clips, retains independent sequences", () => {
	const root = new BaseNode().add(
		new BaseNode().add(node({ id: "one", diagnostics: [missing] })),
	);
	root
		.add(node({ id: "one", diagnostics: [missing] }))
		.add(node({ id: "two", diagnostics: [missing] }));
	const issues = collectPreviewResourceIssues(root);
	expect(issues.map((issue) => issue.sequenceId)).toEqual(["one", "two"]);
	expect(issues[0].diagnostic).toEqual(missing);
	expect(issues[0].diagnostic).not.toBe(missing);
	expect(issues[0].diagnostic.codePoints).not.toBe(missing.codePoints);
});

test("new trees and repaired node diagnostics do not retain old warnings", () => {
	const motion = node({ id: "one", diagnostics: [missing] });
	const root = new BaseNode().add(motion);
	expect(collectPreviewResourceIssues(root)).toHaveLength(1);
	motion.diagnostics = [];
	expect(collectPreviewResourceIssues(root)).toEqual([]);
	expect(collectPreviewResourceIssues(new BaseNode())).toEqual([]);
	expect(
		renderToStaticMarkup(createElement(PreviewResourceNotice, { issues: [] })),
	).toBe("");
});

test("notice exposes missing glyphs, code points and recovery instructions without raw HTML", () => {
	const issues = collectPreviewResourceIssues(
		node({ id: "<script>bad</script>", diagnostics: [missing] }),
	);
	const html = renderToStaticMarkup(
		createElement(PreviewResourceNotice, { issues }),
	);
	expect(html).toContain('role="status"');
	expect(html).toContain("missing 2 required glyphs");
	expect(html).toContain("U+BC14, U+B78C");
	expect(html).toContain(
		"Select the motion-text clip to change its font or text",
	);
	expect(html).toContain("<summary");
	expect(html).not.toContain("<script>");
});
