import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { imageSequencePng } from "../../../../script/fixtures/image-sequence-png";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

export interface BuildResult {
	source: ProgrammaticSource;
	reusedDocument: boolean;
}

export async function revisionFixture(
	engine: "hyperframes" | "remotion",
	toolchainDirectory: string,
) {
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-build-revision-"));
	const author = join(root, "author");
	await mkdir(author);
	const entryFile = engine === "hyperframes" ? "index.html" : "index.tsx";
	const code =
		engine === "hyperframes"
			? '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><div data-composition-id="root" data-start="0" data-duration="2" data-width="64" data-height="64">original-marker</div></body></html>'
			: 'import React from "react"; import {Composition,registerRoot} from "remotion"; import "./style.css"; const Scene=(props:{caption:string})=><div>original-marker {props.caption}</div>; registerRoot(()=><Composition id="Rocut" component={Scene} width={64} height={64} fps={30} durationInFrames={60} defaultProps={{caption:"default"}}/>);';
	await writeFile(join(author, entryFile), code, "utf8");
	await writeFile(
		join(author, "style.css"),
		"body{margin:0;background:transparent}",
		"utf8",
	);
	await writeFile(join(author, "pixel.png"), imageSequencePng(0));
	const projectRoot = join(root, "project");
	const host = await startHost({
		projectRoot,
		registry: new TargetRegistry(join(root, "registry")),
		engineToolchainDirectory: toolchainDirectory,
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	});
	const context = {
		store: new FileProjectStore({
			root: projectRoot,
			schemaVersion: CURRENT_PROJECT_VERSION,
		}),
		projectId: host.automation.projectId,
	};
	const post = (action: string, input: unknown) =>
		fetch(new URL(`api/programmatic/build/${action}`, host.editorUrl), {
			method: "POST",
			body: JSON.stringify(input),
		});
	const success = async (
		action: string,
		input: unknown,
	): Promise<BuildResult> => {
		const response = await post(action, input),
			result: BuildResult = await response.json();
		if (!response.ok) throw Error(JSON.stringify(result));
		return result;
	};
	return {
		root,
		author,
		entryFile,
		code,
		host,
		context,
		post,
		success,
		readRecord: () => readFile(join(projectRoot, "project.json"), "utf8"),
		headers: async () =>
			(
				await context.store.listAttachmentHeaders({
					projectId: context.projectId,
				})
			)
				.map(({ key }) => key)
				.sort(),
		spec: {
			version: 1,
			engine,
			sourceDirectory: author,
			entryFile,
			files: [entryFile, "style.css", "pixel.png"],
			width: 64,
			height: 64,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 60,
			seed: 7,
			...(engine === "remotion"
				? {
						compositionId: "Rocut",
						inputProps: { caption: "initial-prop", preserved: "yes" },
					}
				: {}),
		},
		cleanup: async () => {
			await host.close();
			if (
				dirname(root) !== parent ||
				!basename(root).startsWith("rocut-build-revision-")
			)
				throw Error("Unsafe revision fixture cleanup");
			await rm(root, { recursive: true, force: true });
		},
	};
}
