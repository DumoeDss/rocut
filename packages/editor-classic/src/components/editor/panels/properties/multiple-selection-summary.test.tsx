import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import {
	EditorHostProvider,
	EditorLocaleProvider,
} from "../../../../editor/host/editor-host-context";
import { MultipleSelectionSummary } from "./multiple-selection-summary";

function render(child: ReactNode) {
	return renderToStaticMarkup(
		// This presentation fixture consumes only the host locale.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
		<EditorHostProvider host={{ locale: "zh-CN" } as never}>
			<EditorLocaleProvider locale="en">{child}</EditorLocaleProvider>
		</EditorHostProvider>,
	);
}

describe("multiple-selection properties summary", () => {
	it("counts the resolved types and keeps the selection order out of the display", () => {
		const html = render(
			<MultipleSelectionSummary
				count={4}
				elementTypes={["audio", "video", "text", "video"]}
			/>,
		);
		expect(html).toContain("Selected clips: 4");
		expect(html).toContain("Video 2 · Audio 1 · Text 1");
		expect(html).toContain('data-testid="multi-selection-types"');
		expect(html).toContain("Edit shared properties below");
		expect(html).not.toContain("Images");
	});

	it("names every supported timeline element without exposing internal type IDs", () => {
		const html = render(
			<MultipleSelectionSummary
				count={8}
				elementTypes={[
					"effect",
					"sticker",
					"graphic",
					"motion-text",
					"text",
					"audio",
					"image",
					"video",
				]}
			/>,
		);
		expect(html).toContain(
			"Video 1 · Images 1 · Audio 1 · Text 1 · Motion text 1 · Graphics 1 · Stickers 1 · Effects 1",
		);
		expect(html).not.toContain("motion-text");
	});

	it("does not invent a type for a selection that no longer resolves", () => {
		const html = render(
			<MultipleSelectionSummary count={2} elementTypes={[]} />,
		);
		expect(html).toContain("Selected clips: 2");
		expect(html).not.toContain('data-testid="multi-selection-types"');
	});
});
