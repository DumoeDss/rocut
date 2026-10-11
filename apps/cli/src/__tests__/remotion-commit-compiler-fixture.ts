import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { REMOTION_COMPILER_CHILD } from "../programmatic/engines/remotion-compiler-child";

export const nativeCommitFixtureSource = `var OffthreadVideoForRendering = async () => {
  const res = await fetch(actualSrc, {});
};
// src/Composition.tsx
var InnerComposition = () => {
  if (environment.isStudio && video) return jsx22(Comp, {});
  if (environment.isRendering && video && video.component === lazy && video.id === id) {
    return jsx22(Suspense, {
      fallback: /* @__PURE__ */ jsx22(Fallback, {}),
      children: /* @__PURE__ */ jsx22(Comp, {
          ...resolved.result.props ?? {}
        })
    });
  }
  return null;
};
var Composition = () => {};
`;

export const nativeCommitToolchain =
	process.env.ROCUT_TEST_REMOTION_COMMIT_TOOLCHAIN;

/** Keep unrelated fail-closed native guards genuine instead of mocking them.
 * The small composition fixture remains independently mutable for its controls. */
export async function pinnedNativeCommitFixtureSource() {
	if (!nativeCommitToolchain)
		throw Error("Missing private pinned CPU toolchain");
	const pinnedRequire = createRequire(
		join(nativeCommitToolchain, "package.json"),
	);
	if (pinnedRequire("remotion/package.json").version !== "4.0.440")
		throw Error("Native commit CPU fixture requires Remotion 4.0.440");
	const body = await readFile(
		join(nativeCommitToolchain, "node_modules/remotion/dist/esm/index.mjs"),
	);
	const source = new TextDecoder("utf-8", { fatal: true }).decode(body);
	const marker = "var roundTo6Commas = ";
	const start = source.indexOf(marker);
	const end = source.indexOf("\nvar VideoForRendering = ", start);
	if (start < 0 || end < start || source.split(marker).length !== 2)
		throw Error("Pinned native video fixture section changed");
	return (
		source.slice(start, end) +
		"\nvar VideoForRendering = () => {};\n" +
		nativeCommitFixtureSource
	);
}

/** Capture the genuine compiler onLoad seam without executing authored code or
 * any browser entry. Every fake package/output remains in this owned CPU root. */
export async function captureNativeCommitSeam({
	native,
	version = "4.0.440",
}: { native?: string; version?: string } = {}) {
	native ??= await pinnedNativeCommitFixtureSource();
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-native-commit-cpu-"));
	try {
		const toolchain = join(root, "toolchain"),
			project = join(root, "author");
		const upstream = join(
			toolchain,
			"node_modules/remotion/dist/esm/index.mjs",
		);
		await mkdir(dirname(upstream), { recursive: true });
		await mkdir(project);
		await writeFile(upstream, native, "utf8");
		await writeFile(
			join(toolchain, "node_modules/remotion/package.json"),
			JSON.stringify({ version }),
			"utf8",
		);
		const captured = join(root, "native-captured.mjs");
		const fakeCompiler = join(root, "compiler.mjs");
		await writeFile(
			fakeCompiler,
			`import {writeFile} from 'node:fs/promises';
export async function build(options) {
  let load;
  options.plugins[0].setup({onResolve(){},onLoad(spec,handler){if(spec.namespace==='file')load=handler;}});
  const output=await load({path:${JSON.stringify(upstream)}});
  await writeFile(${JSON.stringify(captured)},output.contents,'utf8');
  return {outputFiles:[{path:'bundle.js',text:'window.cpuFixture=true;'}],metafile:{inputs:{}}};
}`,
			"utf8",
		);
		const result = spawnSync("node", ["-e", REMOTION_COMPILER_CHILD], {
			windowsHide: true,
			timeout: 10000,
			encoding: "utf8",
			maxBuffer: 16000,
			input: JSON.stringify({
				engine: "remotion",
				compilerEntry: pathToFileURL(fakeCompiler).href,
				toolchainRoot: toolchain,
				project,
				files: [],
				driver: "",
				inspection: true,
				environment: "",
				spec: {},
				outputFile: join(root, "cpu.html"),
			}),
		});
		return {
			code: result.status,
			error: result.stderr,
			native: result.status === 0 ? await readFile(captured, "utf8") : null,
		};
	} finally {
		if (
			dirname(resolve(root)) !== parent ||
			!basename(root).startsWith("rocut-native-commit-cpu-")
		)
			throw Error("Unsafe native commit CPU fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}
