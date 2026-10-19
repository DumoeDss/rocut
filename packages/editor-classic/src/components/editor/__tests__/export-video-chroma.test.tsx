import { expect, test } from "bun:test";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DEFAULT_EXPORT_OPTIONS,
	DEFAULT_VIDEO_CHROMA,
	selectedVideoChroma,
} from "../../../export/defaults";
import { ExportVideoChromaControl } from "../export-video-chroma";

test("chroma selection does not change legacy defaults or the chosen quality", () => {
	expect(DEFAULT_EXPORT_OPTIONS).toEqual({
		format: "mp4",
		quality: "high",
		includeAudio: true,
	});
	expect(DEFAULT_VIDEO_CHROMA).toBe("420");
	expect(selectedVideoChroma("420")).toEqual({});
	for (const quality of ["low", "medium", "high", "very_high"])
		expect({ format: "webm", quality, ...selectedVideoChroma("444") }).toEqual({
			format: "webm",
			quality,
			videoChroma: "444",
		});
});

test("both export surfaces share explicit high-fidelity compatibility and no-fallback guidance", () => {
	const markup = renderToStaticMarkup(
		createElement(ExportVideoChromaControl, { value: "444", onChange() {} }),
	);
	expect(markup).toContain('value="444" selected=""');
	expect(markup).toContain("高保真色彩");
	expect(markup).toContain("部分播放器可能无法播放");
	expect(markup).toContain("此选项不会更改质量预设");
	expect(markup).toContain("不支持的编码器会报告错误");
	expect(markup).toMatch(/不会自动回退到\s*4:2:0/);
	expect(markup).toContain("aria-describedby=");
});

function findSelectChange(
	node: ReactNode,
): ((event: { target: { value: string } }) => void) | undefined {
	if (
		!isValidElement<{
			children?: ReactNode;
			onChange?: (event: { target: { value: string } }) => void;
		}>(node)
	)
		return;
	if (node.type === "select") return node.props.onChange;
	for (const child of Children.toArray(node.props.children)) {
		const change = findSelectChange(child);
		if (change) return change;
	}
}

test("the rendered control forwards only supported sampling values and preserves controlled selection", () => {
	for (const value of ["420", "444"] as const) {
		const received: string[] = [];
		let change: ReturnType<typeof findSelectChange>;
		function Probe() {
			const control = ExportVideoChromaControl({
				value,
				onChange: (next) => received.push(next),
			});
			change = findSelectChange(control);
			return control;
		}
		const markup = renderToStaticMarkup(createElement(Probe));
		expect(markup).toContain(`value="${value}" selected=""`);
		expect(markup).toContain("4:2:0 — 标准兼容性");
		expect(markup).toContain("4:4:4 — 高保真色彩");
		if (!change) throw Error("Sampling control has no change handler");
		for (const next of ["444", "420", "invalid", ""])
			change({ target: { value: next } });
		expect(received).toEqual(["444", "420"]);
	}
});
