/** Offline procedural Three author source; no downloaded model or texture. */
export function createScene({ THREE, inputProps, renderer }: any) {
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 20);
	camera.position.set(0, 0, 5);
	renderer.setClearColor(0x000000, 0);
	renderer.toneMapping = THREE.NoToneMapping;
	const geometry = new THREE.IcosahedronGeometry(0.78, 0);
	const material = new THREE.MeshNormalMaterial({ flatShading: true });
	const object = new THREE.Mesh(geometry, material);
	object.position.x = 0.7;
	scene.add(object);
	const wireGeometry = new THREE.EdgesGeometry(geometry);
	const wireMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
	const wire = new THREE.LineSegments(wireGeometry, wireMaterial);
	object.add(wire);
	return {
		scene,
		camera,
		renderFrame(frame: any) {
			object.rotation.set(frame.index * 0.009, frame.index * (inputProps.spin ?? 0.02), 0.2);
			object.scale.setScalar(inputProps.scale ?? 1);
		},
		dispose() {
			geometry.dispose();
			material.dispose();
			wireGeometry.dispose();
			wireMaterial.dispose();
		},
	};
}
