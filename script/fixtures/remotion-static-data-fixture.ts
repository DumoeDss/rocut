import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";

export const staticData = {
	"data/palette.json": JSON.stringify({
		colors: ["#ff0000", "#00ff00", "#0000ff"],
		text: "归档字幕 </script> & <script>throw Error('not executable')</script>",
	}),
	"captions/lyrics.txt": "第一行\r\n第二行\n",
	"captions/cues.csv": 'start,end,text\n0,1,"你好,世界"\n',
	"captions/lyrics.srt": "1\r\n00:00:00,000 --> 00:00:01,000\r\n字幕\r\n",
	"captions/lyrics.vtt": "WEBVTT\n\n00:00.000 --> 00:01.000\n字幕\n",
	"captions/lyrics.lrc": "[00:00.00]歌词\n",
} as const;

export async function prepareStaticDataFixture(
	root: string,
	toolchain: string,
) {
	const sourceDirectory = join(root, "author");
	for (const dir of ["src", "public/data", "public/captions"])
		await mkdir(join(sourceDirectory, dir), { recursive: true });
	await copyFile(
		join(dirname(fileURLToPath(import.meta.url)), "remotion-static-data.tsx"),
		join(sourceDirectory, "src/index.tsx"),
	);
	await copyFile(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"remotion-static-data-config.json",
		),
		join(sourceDirectory, "src/remotion-static-data-config.json"),
	);
	for (const [name, content] of Object.entries(staticData))
		await writeFile(join(sourceDirectory, "public", name), content, "utf8");
	const specification = {
		version: 1,
		engine: "remotion",
		sourceDirectory,
		entryFile: "src/index.tsx",
		files: [
			"src/index.tsx",
			"src/remotion-static-data-config.json",
			...Object.keys(staticData).map((name) => `public/${name}`),
		],
		compositionId: "StaticData",
		inputProps: { expected: staticData },
		width: 32,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 3,
		seed: 17,
	};
	const context = {
		store: new FileProjectStore({
			root: join(root, "store"),
			schemaVersion: 1,
		}),
		projectId: "remotion-static-data",
	};
	const compile = (action: "compile" | "rebuild" | "revise", input: unknown) =>
		compileProgrammaticProject({
			action,
			input,
			toolchainDirectory: toolchain,
			context,
			signal: AbortSignal.timeout(30000),
			enqueue: (task) => task(),
		});
	const document = async (source: ProgrammaticSource) => {
		const resource = source.resources!.find((r) => r.id === source.documentId)!;
		const [loaded] = await loadProgrammaticResources(
			context,
			[resource],
			AbortSignal.timeout(5000),
		);
		return new TextDecoder("utf-8", { fatal: true }).decode(loaded!.body);
	};
	return { specification, context, compile, document };
}

/** Read compiler bootstrap data only; do not execute authored browser code in Node. */
export function readStaticDataManifest(html: string) {
	const begin = html.indexOf("window.remotion_staticFiles=");
	const end = html.indexOf(";\nwindow.rocut=", begin);
	if (begin < 0 || end < begin)
		throw Error("Missing compiled static-file inventory");
	return JSON.parse(
		html.slice(begin + "window.remotion_staticFiles=".length, end),
	) as {
		name: string;
		src: string;
		sizeInBytes: number;
		lastModified: number;
	}[];
}
