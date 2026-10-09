export function createScene({ THREE, frame, inputProps, renderer }: any) {
	const mode = inputProps.mode ?? "success";
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.1, 10);
	camera.position.z = 4;
	renderer.toneMapping = THREE.NoToneMapping;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(
			mode === "rust-error"
				? [0, 0, 0, 0, 0, 0, 0, 0, 0]
				: [-0.6, -0.6, 0, 0.6, -0.6, 0, 0, 0.6, 0],
			3,
		),
	);
	const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
	const mesh =
		mode === "geometry-error"
			? new THREE.InstancedMesh(geometry, material, 1)
			: new THREE.Mesh(geometry, material);
	scene.add(mesh);
	let points: any;
	return {
		scene,
		camera,
		renderFrame(value: any) {
			if (!Number.isInteger(value.index) || value.seed !== 7391)
				throw Error("Expected unchanged Rust frame and seed");
			mesh.position.x = value.index === 0 ? -0.75 : 0.75;
		},
		async particleFrame({ frame: value, particles }: any) {
			if (value.index !== frame.index) throw Error("Frame phase mismatch");
			const pending = particles.sampleSurface(mesh, {
				count: 4096,
				underflow: "reject",
				maxAllocationBytes: 1_000_000,
			});
			if (mode === "forgot-await") {
				void pending.catch(() => {});
				return;
			}
			const { buffers, primitives, materials } = await pending;
			if (
				buffers.count !== 4096 ||
				primitives.length !== 1 ||
				materials[0] !== material
			)
				throw Error("Primitive/material association lost");
			const expected = value.index === 0 ? -0.75 : 0.75;
			for (let i = 0; i < buffers.count; i++) {
				if (
					buffers.position[i * 3] < expected - 0.61 ||
					buffers.position[i * 3] > expected + 0.61 ||
					buffers.primitiveIndex[i] !== 0 ||
					buffers.materialIndex[i] !== 0 ||
					buffers.materialPresent[i] !== 1
				)
					throw Error("Sampling did not observe the posed world-space mesh");
			}
			mesh.visible = false;
			const sampled = new THREE.BufferGeometry();
			sampled.setAttribute(
				"position",
				new THREE.BufferAttribute(buffers.position, 3),
			);
			points = new THREE.Points(
				sampled,
				new THREE.PointsMaterial({
					color: 0x22ddff,
					size: 2,
					sizeAttenuation: false,
					depthTest: false,
				}),
			);
			scene.add(points);
		},
		dispose() {
			geometry.dispose();
			material.dispose();
			points?.geometry.dispose();
			points?.material.dispose();
			if (mode === "cleanup-error") throw Error("C2 author cleanup sentinel");
		},
	};
}
