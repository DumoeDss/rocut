import React from "react";
import { Composition, registerRoot, useCurrentFrame } from "remotion";

function Graphics() {
	const frame = useCurrentFrame();
	return (
		<div
			style={{
				position: "absolute",
				left: frame * 2,
				top: 8,
				width: 8,
				height: 8,
				background: "#3cd691",
			}}
		/>
	);
}

registerRoot(() => (
	<Composition
		id="MixedLyrics"
		component={Graphics}
		width={96}
		height={96}
		fps={25}
		durationInFrames={25}
	/>
));
