import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_ASSET_FILTERS_TEST !== "1") {
	test("native asset filters expose a single reset action", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_ASSET_FILTERS_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	await import("../../../../../editor/session/__tests__/wasm-test-mock");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { MediaFilters } = await import("./assets");

	test("one clear click restores all three controls for combined and individual filters", () => {
		for (const initial of [
			{ search: "mountain", typeFilter: "video", usedOnly: true },
			{ search: "   ", typeFilter: "all", usedOnly: false },
			{ search: "", typeFilter: "audio", usedOnly: false },
			{ search: "", typeFilter: "all", usedOnly: true },
		]) {
			const state = { ...initial };
			const onSearchChange = (value: string) => (state.search = value);
			const onTypeFilterChange = (value: string) => (state.typeFilter = value);
			const onUsedOnlyChange = (value: boolean) => (state.usedOnly = value);
			const render = () =>
				MediaFilters({
					...state,
					onSearchChange,
					onTypeFilterChange,
					onUsedOnlyChange,
				});
			const control = render().props.children.at(-1);
			expect(control.props.disabled).toBe(false);
			expect(control.props.children).toBe("清除筛选");
			control.props.onClick();
			expect(state).toEqual({ search: "", typeFilter: "all", usedOnly: false });
			const reset = render();
			expect(reset.props.children.at(-1).props.disabled).toBe(true);
			const html = renderToStaticMarkup(reset);
			expect(html).toContain('type="search"');
			expect(html).toContain('value="all" selected=""');
			expect(html).not.toContain('checked=""');
			expect(html).toContain("<button");
			expect(html).toContain('type="button"');
		}
	});
}
