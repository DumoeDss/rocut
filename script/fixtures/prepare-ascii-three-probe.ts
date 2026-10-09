import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threeEnvironment, threeModel } from "./three-assets";

/** Six textured GLB planes form a closed cube, with correct face normals. */
export function asciiCubeModel() {
	const base = threeModel(),
		jsonLength = base.readUInt32LE(12);
	const model = JSON.parse(base.subarray(20, 20 + jsonLength).toString("utf8"));
	const q = Math.SQRT1_2;
	model.nodes = [
		{ mesh: 0, translation: [0, 0, 0.6] },
		{ mesh: 0, translation: [0, 0, -0.6], rotation: [0, 1, 0, 0] },
		{ mesh: 0, translation: [0.6, 0, 0], rotation: [0, q, 0, q] },
		{ mesh: 0, translation: [-0.6, 0, 0], rotation: [0, -q, 0, q] },
		{ mesh: 0, translation: [0, 0.6, 0], rotation: [-q, 0, 0, q] },
		{ mesh: 0, translation: [0, -0.6, 0], rotation: [q, 0, 0, q] },
	];
	model.scenes = [{ nodes: [0, 1, 2, 3, 4, 5] }];
	const text = Buffer.from(JSON.stringify(model)),
		json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
	text.copy(json);
	const tail = base.subarray(20 + jsonLength),
		header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + json.length + tail.length, 8);
	header.writeUInt32LE(json.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	return Buffer.concat([header, json, tail]);
}

export async function prepareAsciiThreeProbe(root: string) {
	await mkdir(root, { recursive: true });
	const scene = `import * as THREE from 'three';
export async function createScene({assets,inputProps,signal,renderer}) {
  const size=renderer.getSize(new THREE.Vector2());
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(37,size.x/size.y,.1,30);
  camera.position.set(inputProps.cameraX??2.5,1.8,4.3); camera.lookAt(0,0,0);
  const model=await assets.model('assets/cube.glb'), half=await assets.model('assets/cube.glb');
  const env=await assets.environment('assets/neutral.hdr'); scene.environment=env.value;
  scene.environmentIntensity=inputProps.intensity??0.75;
  model.value.traverse(o=>{if(o.isMesh){o.material.roughness=inputProps.roughness??.35;o.material.metalness=.1;if(inputProps.tint)o.material.color.set(inputProps.tint);}});
  half.value.position.set(-1.3,0,0); half.value.scale.setScalar(.5);
  half.value.traverse(o=>{if(o.isMesh){o.material.transparent=true;o.material.opacity=.4;}});
  const key=new THREE.DirectionalLight(0xffffff,3); key.position.set(2,4,3);
  const fill=new THREE.DirectionalLight(0x77bbff,1); fill.position.set(-3,0,1);
  scene.add(model.value,half.value,key,fill); signal.throwIfAborted();
  return {scene,camera,renderFrame(frame){model.value.rotation.set(.2+frame.time*.3,.35+frame.time*1.2,0);
    model.value.scale.setScalar(inputProps.scale??1);half.value.rotation.y=-frame.time*.7;}};
}`;
	await writeFile(join(root, "scene.ts"), scene, {
		encoding: "utf8",
		flag: "wx",
	});
	await writeFile(join(root, "cube.glb"), asciiCubeModel(), { flag: "wx" });
	await writeFile(join(root, "neutral.hdr"), threeEnvironment(false), {
		flag: "wx",
	});
	return {
		spec: {
			version: 1,
			engine: "three",
			sourceDirectory: root,
			entryFile: "scene.ts",
			files: ["scene.ts"],
			width: 640,
			height: 360,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 60,
			seed: 19,
			inputProps: {},
		},
		imports: [
			{
				id: "assets/cube.glb",
				kind: "model",
				mimeType: "model/gltf-binary",
				filePath: join(root, "cube.glb"),
			},
			{
				id: "assets/neutral.hdr",
				kind: "environment",
				mimeType: "image/vnd.radiance",
				filePath: join(root, "neutral.hdr"),
			},
		],
	};
}
if (import.meta.main) {
	if (!process.argv[2]) throw Error("Expected private artifact directory");
	await writeFile(
		join(process.argv[2], "compile.json"),
		JSON.stringify(
			await prepareAsciiThreeProbe(join(process.argv[2], "author")),
			null,
			2,
		),
		{ encoding: "utf8", flag: "wx" },
	);
}
