import React from "react";
import { Composition, registerRoot, useCurrentFrame } from "remotion";

function Marker() {
	const frame = useCurrentFrame();
	return (
		<div
			style={{
				position: "absolute",
				left: 8 + (frame % 50) * 2,
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
		id="MultishotMv"
		component={Marker}
		width={160}
		height={90}
		fps={25}
		durationInFrames={150}
	/>
));
