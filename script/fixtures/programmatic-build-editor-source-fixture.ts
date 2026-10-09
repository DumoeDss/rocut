import { constants } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Deliberately simple real engine documents: red HyperFrames, blue Remotion. */
export async function writeBuildEditorSources(
	authorDirectory: string,
	toolchainDirectory: string,
) {
	const shared = {
		version: 1,
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
	};
	const hyperframesDirectory = join(authorDirectory, "hyperframes");
	const remotionDirectory = join(authorDirectory, "remotion");
	await mkdir(hyperframesDirectory);
	await mkdir(remotionDirectory);
	const hyperframes = `<!doctype html>
<html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}</style></head><body>
<div id="scene" data-composition-id="root" data-start="0" data-duration="2" data-width="64" data-height="64"
 style="width:64px;height:64px;background:#ff0000"></div>
<script src="gsap.js"></script>
<script>
window.__timelines = window.__timelines || {};
window.__timelines.root = gsap.timeline({paused:true})
  .to("#scene", {opacity:1, duration:2, ease:"none"}, 0);
</script>
</body></html>
`;
	const remotion = `import React from "react";
import {Composition, registerRoot} from "remotion";
import "./style.css";
const Scene = ({color}: {color: string}) => <div style={{width: 64, height: 64, background: color}} />;
registerRoot(() => <Composition id="Rocut" component={Scene} width={64} height={64}
 fps={30} durationInFrames={60} defaultProps={{color: "#0000ff"}} />);
`;
	const style =
		"html,body{margin:0;width:100%;height:100%;background:transparent}\n";
	await writeFile(join(hyperframesDirectory, "index.html"), hyperframes, {
		encoding: "utf8",
		flag: "wx",
	});
	await writeFile(join(remotionDirectory, "index.tsx"), remotion, {
		encoding: "utf8",
		flag: "wx",
	});
	await copyFile(
		join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"),
		join(hyperframesDirectory, "gsap.js"),
		constants.COPYFILE_EXCL,
	);
	await writeFile(join(remotionDirectory, "style.css"), style, {
		encoding: "utf8",
		flag: "wx",
	});
	return [
		{
			name: "HyperFrames",
			spec: {
				...shared,
				engine: "hyperframes",
				sourceDirectory: hyperframesDirectory,
				entryFile: "index.html",
				files: ["index.html", "gsap.js"],
			},
		},
		{
			name: "Remotion",
			spec: {
				...shared,
				engine: "remotion",
				sourceDirectory: remotionDirectory,
				entryFile: "index.tsx",
				files: ["index.tsx", "style.css"],
				compositionId: "Rocut",
				inputProps: { color: "#0000ff" },
			},
		},
	];
}
