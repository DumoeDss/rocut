/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Isolated component boundary fixtures deliberately supply only consumed editor collaborators. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_PRESENTATION_AUDIT !== "1") {
	test("actual editor presentation follows the host locale", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, EDITOR_PRESENTATION_AUDIT: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode)
			throw Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	await import("../session/__tests__/wasm-test-mock");
	const React = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	let selectionCount = 0;
	let locked = false,
		animated = false;
	const editor: any = {
		project: {
			getActiveOrNull: () => ({ metadata: { name: "Fixture" } }),
			getActive: () => ({ metadata: { name: "Fixture" } }),
		},
		selection: {
			getSelectedElements: () => Array.from({ length: selectionCount }),
		},
		timeline: {
			getElementsWithTracks: () => [
				{
					track: { locked },
					element: {
						id: "one",
						type: "text",
						params: { content: "Fixture", opacity: 1 },
						animations: animated ? { opacity: {} } : undefined,
					},
				},
			],
		},
		media: { getFolders: () => [], isFolderEditingAvailable: () => false },
	};
	mock.module("../use-editor", () => ({
		useEditorInstance: () => editor,
		useEditor: (select: any) => select(editor),
	}));
	mock.module("../../selection", () => ({
		useSelection: () => ({ selectedIds: ["fixture-asset"] }),
	}));
	const { EditorHostProvider, EditorLocaleProvider } =
		await import("../host/editor-host-context");
	const { EditorFocusTabs } = await import("./editor-focus-tabs");
	const { ExportButton } =
		await import("../../components/editor/export-button");
	const { CommonProperties } =
		await import("../../components/editor/panels/properties/common-properties");
	const { MultipleSelectionSummary } =
		await import("../../components/editor/panels/properties/multiple-selection-summary");
	const { MediaFolders, MoveMediaSelection, ALL_MEDIA } =
		await import("../../components/editor/panels/assets/views/media-folders");
	const { TimelineToolbar } =
		await import("../../timeline/components/timeline-toolbar");
	const { EditorHeader } =
		await import("../../components/editor/editor-header");
	const host = { locale: "zh-CN", services: {} } as never;
	function render(locale: string, child: React.ReactNode) {
		return renderToStaticMarkup(
			<EditorHostProvider host={host}>
				<EditorLocaleProvider locale={locale}>{child}</EditorLocaleProvider>
			</EditorHostProvider>,
		);
	}
	const hasChinese = (html: string) => /[\u3400-\u9fff]/u.test(html);
	const fixtures = [
		[
			"focus tabs",
			<EditorFocusTabs key="focus" value="assets" onChange={() => {}} />,
		],
		["export trigger", <ExportButton key="export" />],
		["common properties", <CommonProperties key="common" />],
		[
			"selection summary",
			<MultipleSelectionSummary
				key="summary"
				count={2}
				elementTypes={["text", "audio"]}
			/>,
		],
		[
			"media folders",
			<MediaFolders key="folders" active={ALL_MEDIA} onSelect={() => {}} />,
		],
		["move selection", <MoveMediaSelection key="move" />],
	] as const;
	for (const [name, child] of fixtures) {
		test(`${name} consumes the actual locale provider in both directions`, () => {
			const english = render("en", child);
			expect(hasChinese(english)).toBe(false);
			const chinese = render("zh-CN", child);
			expect(chinese).not.toBe(english);
			expect(hasChinese(chinese)).toBe(true);
			expect(render("en", child)).toBe(english);
		});
	}
	test("localized focus tabs preserve accessible identity and navigation handlers", () => {
		let tabs: any;
		const changes: string[] = [];
		function Probe() {
			tabs = EditorFocusTabs({
				value: "assets",
				onChange: (value) => changes.push(value),
			});
			return tabs;
		}
		const html = render("en", <Probe />);
		expect((html.match(/role="tab"/gu) ?? []).length).toBe(3);
		const buttons = React.Children.toArray(tabs.props.children) as any[];
		expect(buttons[0].props["aria-selected"]).toBe(true);
		expect(buttons[1].props["aria-controls"]).toBe("editor-preview");
		buttons[1].props.onClick();
		buttons[0].props.onKeyDown({ key: "End", preventDefault() {} });
		expect(changes).toEqual(["preview", "properties"]);
	});
	test("common property lock and animation explanations are localized", () => {
		for (const mode of ["locked", "animated"]) {
			locked = mode === "locked";
			animated = mode === "animated";
			const english = render("en", <CommonProperties />);
			expect(hasChinese(english)).toBe(false);
			expect(english).toContain("disabled");
			expect(render("zh-CN", <CommonProperties />)).not.toBe(english);
		}
		locked = animated = false;
	});
	test("actual fit controls retain selection state and scope handlers in English", () => {
		selectionCount = 0;
		const scopes: string[] = [];
		let controls: any;
		function Probe() {
			const tree = TimelineToolbar({
				zoomLevel: 1,
				minZoom: 0.1,
				setZoomLevel: () => {},
				onFit: (scope) => scopes.push(scope),
			});
			controls = React.Children.toArray(tree.props.children).find(
				(child: any) => child.type === "div",
			);
			return controls;
		}
		const html = render("en", <Probe />);
		expect(hasChinese(html)).toBe(false);
		expect(html).toContain('data-testid="timeline-fit-project"');
		expect(html).toContain('data-testid="timeline-fit-selection"');
		const buttons = React.Children.toArray(controls.props.children) as any[];
		expect(buttons[1].props.disabled).toBe(true);
		buttons[0].props.onClick();
		selectionCount = 1;
		render("en", <Probe />);
		const enabled = React.Children.toArray(controls.props.children) as any[];
		expect(enabled[1].props.disabled).toBe(false);
		enabled[1].props.onClick();
		expect(scopes).toEqual(["project", "selection"]);
	});
	test("header wrapping has intrinsic height and export cannot wrap internally", () => {
		let header: any;
		function Probe() {
			header = EditorHeader({ hostOwnsChrome: true });
			return React.cloneElement(header, {}, null);
		}
		render("en", <Probe />);
		expect(header.props.className).toContain("flex-wrap");
		expect(header.props.className).not.toMatch(/(?:^|\s)h-\d+(?:\s|$)/u);
		const html = render("en", <ExportButton />);
		expect(html.includes("whitespace-nowrap")).toBe(true);
	});
	test("project name accessible label follows locale changes in both directions", () => {
		function ProjectNameProbe() {
			const header = EditorHeader({ hostOwnsChrome: true });
			const group = React.Children.toArray(header.props.children)[0] as any;
			return React.Children.toArray(group.props.children)[0];
		}
		const english = render("en", <ProjectNameProbe />);
		expect(english).toContain('aria-label="Project name"');
		expect(english).toContain('value="Fixture"');
		expect(hasChinese(english)).toBe(false);
		const chinese = render("zh-CN", <ProjectNameProbe />);
		expect(chinese).toContain('aria-label="工程名称"');
		expect(chinese).toContain('value="Fixture"');
		expect(render("en", <ProjectNameProbe />)).toBe(english);
	});
}
