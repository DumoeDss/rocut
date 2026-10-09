import { createHash } from "node:crypto";
import { REMOTION_COMPILER_CHILD } from "./engines/remotion-compiler-child";
import { THREE_PARTICLE_FRAME_DRIVER } from "./engines/three-particle-driver";
import { PARTICLE_BROWSER_RUNTIME_IIFE } from "./particle-browser-bundle.generated";
import { PARTICLE_CAPTURE_BOOTSTRAP } from "./particle-page-bootstrap";
import { htmlCaptureExpression } from "./html-document";

/** Canonical data binds the actual shared HTML/resource/media bootstrap emitted
 * by capture too. Frame/resource values are independently bound per capture. */
export function threeParticleHtmlAdapterMaterial(): string {
	return htmlCaptureExpression(
		"",
		{ index: 0, time: 0, seed: 0 },
		[],
		false,
		true,
	);
}

/** Bind the actual shipped browser implementation, not only its top-level caller. */
export function getThreeParticleAdapterHash(): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				"rocut-three-particle-adapter-v1",
				THREE_PARTICLE_FRAME_DRIVER,
				REMOTION_COMPILER_CHILD,
				PARTICLE_BROWSER_RUNTIME_IIFE,
				PARTICLE_CAPTURE_BOOTSTRAP,
				threeParticleHtmlAdapterMaterial(),
			]),
		)
		.digest("hex");
}
