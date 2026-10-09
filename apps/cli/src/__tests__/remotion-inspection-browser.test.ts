import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRemotionProject } from "../programmatic/remotion-inspection-project";
import {
	selectInspectedComposition,
	assertInspectionMetadataUnchanged,
} from "../programmatic/remotion-inspection-snapshot";

const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR;
const configured = !!executable && !!toolchainDirectory;

test.skipIf(!configured)(
	"native Folder discovery resolves async metadata and reinspection never rereads changed author files",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "rocut-inspection-browser-"));
		try {
			await writeFile(
				join(root, "index.tsx"),
				`import React from 'react';
import {registerRoot,Composition,Folder} from 'remotion';
const Picture=()=> <div>frame</div>;
registerRoot(()=> <><Folder name="Examples"><Composition id="First" component={Picture}
 width={64} height={64} fps={30} durationInFrames={10} defaultProps={{label:'default',base:1}}
 calculateMetadata={async({props})=>{await new Promise(r=>setTimeout(r,20));return {durationInFrames:60,props:{...props,derived:2}};}}/>
 </Folder><Composition id="Second" component={Picture} width={80} height={90} fps={24} durationInFrames={48}/></>);`,
				"utf8",
			);
			const input = {
				version: 1,
				sourceDirectory: root,
				entryFile: "index.tsx",
				files: ["index.tsx"],
				seed: 7,
				inputProps: { label: "input" },
			};
			const args = {
				input,
				executable: executable!,
				toolchainDirectory: toolchainDirectory!,
				signal: new AbortController().signal,
			};
			const snapshot = await inspectRemotionProject(args);
			expect(snapshot.compositions.map((c) => c.id)).toEqual([
				"First",
				"Second",
			]);
			expect(snapshot.compositions[0]).toMatchObject({
				width: 64,
				height: 64,
				fps: 30,
				durationFrames: 60,
				props: { label: "input", base: 1, derived: 2 },
			});
			await writeFile(
				join(root, "index.tsx"),
				"throw Error('changed author must not execute');",
				"utf8",
			);
			const current = await inspectRemotionProject({
				...args,
				input: undefined,
				prepared: snapshot,
			});
			assertInspectionMetadataUnchanged(snapshot, current, "First");
			expect(
				selectInspectedComposition(snapshot, {
					revision: snapshot.revision,
					compositionId: "Second",
					frameRate: { numerator: 24, denominator: 1 },
				}).source.durationFrames,
			).toBe(48);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	60000,
);

test.skipIf(!configured)(
	"native metadata rejection and denied external fetch fail inspection",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "rocut-inspection-browser-"));
		try {
			for (const metadata of [
				"throw Error('metadata rejected')",
				"await fetch('https://example.com/forbidden');return {}",
			]) {
				await writeFile(
					join(root, "index.tsx"),
					`import React from 'react';import {registerRoot,Composition} from 'remotion';
registerRoot(()=> <Composition id="Failure" component={()=>null} width={64} height={64} fps={30} durationInFrames={60}
calculateMetadata={async()=>{${metadata}}}/>);`,
					"utf8",
				);
				await expect(
					inspectRemotionProject({
						input: {
							version: 1,
							sourceDirectory: root,
							entryFile: "index.tsx",
							files: ["index.tsx"],
							seed: 7,
						},
						executable: executable!,
						toolchainDirectory: toolchainDirectory!,
						signal: new AbortController().signal,
					}),
				).rejects.toThrow();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	60000,
);
