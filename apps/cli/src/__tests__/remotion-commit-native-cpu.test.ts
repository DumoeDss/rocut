import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { captureNativeCommitSeam } from "./remotion-commit-compiler-fixture";

// Optional pinned CPU DOM seam, not a Chromium/browser or pixel test. No install
// is performed: callers provide an existing private React 18 + linkedom tree.
const toolchain = process.env.ROCUT_TEST_REMOTION_COMMIT_TOOLCHAIN;
(toolchain ? test : test.skip)(
	"pinned native sentinel cannot commit suspended content and accepts empty output with stable state",
	async () => {
		if (!toolchain) throw Error("Missing private pinned CPU toolchain");
		const pinnedRequire = createRequire(join(toolchain, "package.json"));
		expect(pinnedRequire("remotion/package.json").version).toBe("4.0.440");
		expect(pinnedRequire("react/package.json").version).toBe("18.3.1");
		const original = await readFile(
			join(toolchain, "node_modules/remotion/dist/esm/index.mjs"),
			"utf8",
		);
		const captured = await captureNativeCommitSeam({ native: original });
		expect(captured.code).toBe(0);
		expect(captured.error).toBe("");
		const { window } = pinnedRequire("linkedom").parseHTML(
			"<!doctype html><html><body><div id='root'></div></body></html>",
		);
		window.HTMLIFrameElement ??= class extends window.HTMLElement {};
		const globals = ["window", "document", "navigator"];
		const previous = globals.map((name) =>
			Object.getOwnPropertyDescriptor(globalThis, name),
		);
		for (const [name, value] of [
			["window", window],
			["document", window.document],
			["navigator", { userAgent: "node-cpu-dom" }],
		])
			Object.defineProperty(globalThis, name, {
				value,
				configurable: true,
				writable: true,
			});
		let root: { render(value: unknown): void; unmount(): void } | undefined;
		try {
			const module = {
				exports: {} as {
					__cpuCommit?: unknown;
					__rocutCompositionCommitContext?: unknown;
				},
			};
			const source =
				captured.native + "\nexport {RocutCompositionCommit as __cpuCommit};";
			const code = transformSync(source, {
				loader: "js",
				format: "cjs",
				target: "esnext",
			}).code;
			new Function("require", "module", "exports", code)(
				pinnedRequire,
				module,
				module.exports,
			);
			const React = pinnedRequire("react"),
				{ flushSync } = pinnedRequire("react-dom");
			const { createRoot } = pinnedRequire("react-dom/client");
			const Commit = module.exports.__cpuCommit;
			const Context = module.exports.__rocutCompositionCommitContext;
			let commits = 0,
				cleanups = 0,
				mounts = 0,
				observedState = 0;
			const observer = (id: string) => {
				expect(id).toBe("Main");
				commits++;
				return () => {
					cleanups++;
				};
			};
			let fulfill!: (value: unknown) => void;
			const promise = new Promise((resolve) => {
				fulfill = resolve;
			});
			let Lazy = React.lazy(() => promise);
			function Empty() {
				const [state] = React.useState(42);
				observedState = state;
				React.useLayoutEffect(() => {
					mounts++;
				}, []);
				return null;
			}
			const tree = () =>
				React.createElement(
					Context.Provider,
					{ value: observer },
					React.createElement(
						React.Suspense,
						{ fallback: null },
						React.createElement(
							Commit,
							{ id: "Main" },
							React.createElement(Lazy),
						),
					),
				);
			const mount = window.document.getElementById("root");
			root = createRoot(mount);
			flushSync(() => root!.render(tree()));
			for (let i = 0; i < 5; i++) {
				await Promise.resolve();
				flushSync(() => root!.render(tree()));
			}
			expect(commits).toBe(0);
			expect(mount.childNodes.length).toBe(0);
			fulfill({ default: Empty });
			await promise;
			await Promise.resolve();
			flushSync(() => root!.render(tree()));
			expect(commits).toBe(1);
			expect(mount.childNodes.length).toBe(0);
			expect(observedState).toBe(42);
			flushSync(() => root!.render(tree()));
			expect(commits).toBe(1);
			expect(mounts).toBe(1);
			let fulfillAgain!: (value: unknown) => void;
			const again = new Promise((resolve) => {
				fulfillAgain = resolve;
			});
			Lazy = React.lazy(() => again);
			flushSync(() => root!.render(tree()));
			expect(commits).toBe(1);
			expect(cleanups).toBe(1);
			fulfillAgain({ default: Empty });
			await again;
			await Promise.resolve();
			flushSync(() => root!.render(tree()));
			expect(commits).toBe(2);
			flushSync(() => root!.unmount());
			root = undefined;
			expect(cleanups).toBe(2);
		} finally {
			root?.unmount();
			globals.forEach((name, index) => {
				const descriptor = previous[index];
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			});
		}
	},
	10000,
);
