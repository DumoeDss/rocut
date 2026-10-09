// The probe packages the real browser fixture as this explicit author input.
import { runThreeParticleMaterialBrowserFixture } from "./material-checks.js";

export async function createScene({ THREE, frame, inputProps, renderer }: any) {
	if (inputProps.mode === "browser-textures") {
		const result = await runThreeParticleMaterialBrowserFixture(THREE);
		if (result.assertions < 70)
			throw Error("Browser material checks did not execute");
	}
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-3, 3, 2.25, -2.25, 0.1, 20);
	camera.position.z = 8;
	renderer.toneMapping = THREE.NoToneMapping;
	const geometry = new THREE.PlaneGeometry(1.5, 1.5);
	const texture = new THREE.DataTexture(
		new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
		2,
		1,
		THREE.RGBAFormat,
		THREE.UnsignedByteType,
	);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	if (inputProps.mode === "unsupported-uv") texture.channel = 1;
	const material = new THREE.MeshBasicMaterial({ map: texture });
	const mesh = new THREE.Mesh(geometry, material);
	scene.add(mesh);
	let points: any;
	return {
		scene,
		camera,
		async particleFrame({ particles }: any) {
			const { buffers, materialBuffers, estimatedAllocationBytes } =
				await particles.sampleSurface(mesh, {
					count: 4096,
					underflow: "allow-zero",
					maxAllocationBytes: 1_000_000,
					material: { mode: "base-color", sampling: "nearest-base-level" },
					motion: {
						version: 1,
						scatterStartTicks: 0,
						scatterDurationTicks: 120000,
						holdDurationTicks: 120000,
						returnDurationTicks: 120000,
						scatterDistance: inputProps.mode === "rust-motion-error" ? -1 : 1.5,
						driftAmplitude: 0,
						driftFrequency: 1,
						size: 2.5,
						sizeVariance: 0.3,
					},
				});
			if (
				!buffers.motionPosition ||
				!buffers.size ||
				!materialBuffers ||
				estimatedAllocationBytes > 1_000_000
			)
				throw Error("Missing C3 bounded output");
			let red = 0,
				green = 0,
				moving = 0,
				minSize = Infinity,
				maxSize = 0;
			for (let i = 0; i < buffers.count; i++) {
				const c = i * 4,
					p = i * 3;
				if (!materialBuffers.visible[i] || materialBuffers.color[c + 3] !== 1)
					throw Error("Unexpected particle alpha");
				if (buffers.uv[i * 2] < 0.5) {
					if (
						materialBuffers.color[c] !== 1 ||
						materialBuffers.color[c + 1] !== 0
					)
						throw Error("Left texture sample is not red");
					red++;
				} else {
					if (
						materialBuffers.color[c] !== 0 ||
						materialBuffers.color[c + 1] !== 1
					)
						throw Error("Right texture sample is not green");
					green++;
				}
				if (buffers.position[p] !== buffers.motionPosition[p]) moving++;
				minSize = Math.min(minSize, buffers.size[i]);
				maxSize = Math.max(maxSize, buffers.size[i]);
			}
			if (red < 1500 || green < 1500 || maxSize - minSize < 0.5)
				throw Error("Missing texture distribution or Rust size variation");
			if (
				(frame.sourceTime === 0 || frame.sourceTime >= 360000) &&
				moving !== 0
			)
				throw Error("Rest/return did not preserve Rust sampled position");
			if (frame.sourceTime === 120000 && moving < 4000)
				throw Error("Scatter did not move sampled positions");
			mesh.visible = false;
			const sampled = new THREE.BufferGeometry();
			sampled.setAttribute(
				"position",
				new THREE.BufferAttribute(buffers.motionPosition, 3),
			);
			sampled.setAttribute(
				"particleSize",
				new THREE.BufferAttribute(buffers.size, 1),
			);
			sampled.setAttribute(
				"particleColor",
				new THREE.BufferAttribute(materialBuffers.color, 4),
			);
			const shader = new THREE.ShaderMaterial({
				depthTest: false,
				transparent: true,
				vertexShader: `attribute float particleSize;
attribute vec4 particleColor; varying vec4 tint;
void main() { tint = particleColor; gl_PointSize = particleSize;
gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
				fragmentShader: `varying vec4 tint;
void main() { gl_FragColor = tint;
#include <colorspace_fragment>
}`,
			});
			points = new THREE.Points(sampled, shader);
			scene.add(points);
		},
		dispose() {
			geometry.dispose();
			material.dispose();
			texture.dispose();
			points?.geometry.dispose();
			points?.material.dispose();
		},
	};
}
