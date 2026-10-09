import React, { useEffect, useState } from "react";
import {
	Composition,
	continueRender,
	cancelRender,
	delayRender,
	getStaticFiles,
	registerRoot,
	staticFile,
	useCurrentFrame,
} from "remotion";
import config from "./remotion-static-data-config.json";

interface Props {
	expected: Record<string, string>;
	mode?: "missing" | "network";
}

// Deliberate RGB calibration markers, matching the existing Remotion diagnostic
// fixture. No promotional layout, substitute fonts or unrelated motion.
function StaticData({ expected, mode }: Props) {
	const frame = useCurrentFrame();
	const [handle] = useState(() => delayRender("Archived text/caption assets"));
	const [colors, setColors] = useState<string[]>([]);
	useEffect(() => {
		void (async () => {
			if (!config.importedAsObject || config.marker !== 37)
				throw Error("JSON source imports no longer return objects");
			if (mode === "missing") staticFile("not-declared.json");
			if (mode === "network")
				await fetch("https://rocut-denied.invalid/data.json");
			const inventory = getStaticFiles();
			if (inventory.length !== Object.keys(expected).length)
				throw Error("Static-file inventory changed");
			for (const [name, text] of Object.entries(expected)) {
				const file = inventory.find((entry) => entry.name === name);
				if (
					!file ||
					file.src !== staticFile(name) ||
					file.sizeInBytes !== new TextEncoder().encode(text).byteLength ||
					file.lastModified !== 0 ||
					(await (await fetch(file.src)).text()) !== text
				)
					throw Error(`Archived static data differs: ${name}`);
			}
			const data = await (await fetch(staticFile("data/palette.json"))).json();
			if (data.text !== JSON.parse(expected["data/palette.json"]!).text)
				throw Error("Escaped JSON content changed");
			setColors(data.colors);
			continueRender(handle);
		})().catch(cancelRender);
	}, [expected, handle, mode]);
	return <div style={{ width: 32, height: 32, background: colors[frame] }} />;
}

registerRoot(() => (
	<Composition
		id="StaticData"
		component={StaticData}
		width={32}
		height={32}
		fps={30}
		durationInFrames={3}
		defaultProps={{ expected: {} }}
	/>
));
