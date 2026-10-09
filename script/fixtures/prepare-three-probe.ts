import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threeEnvironment, threeModel, threePalette } from "./three-assets";

export async function prepareThreeProbe(root: string) {
	await mkdir(root, { recursive: true });
	const scene = `import * as THREE from 'three';
export async function createScene({assets,inputProps,signal}) {
  if(inputProps.stall) await new Promise(()=>{});
  const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-2,2,1.125,-1.125,.1,20); camera.position.z=5;
  const a=await assets.model('assets/model.glb'), b=await assets.model('assets/model.glb');
  const am=a.value.children[0], bm=b.value.children[0];
  if(am.geometry!==bm.geometry || am.material===bm.material || am.material.map===bm.material.map) throw Error('Model instance ownership failed');
  if(!am.material.map?.image?.width) throw Error('Embedded GLB texture missing');
  const texture=await assets.texture('assets/palette.png','color'), data=await assets.texture('assets/palette.png','data');
  if(texture.value.colorSpace!==THREE.SRGBColorSpace || data.value.colorSpace!==THREE.NoColorSpace) throw Error('Texture color/data roles lost');
  const env=await assets.environment(inputProps.environment??'assets/neutral.hdr'); scene.environment=env.value;
  scene.environmentIntensity=inputProps.intensity??1;
  b.value.position.x=.85; b.value.scale.setScalar(.65); bm.material.transparent=true; bm.material.opacity=.5;
  const geometry=new THREE.PlaneGeometry(.4,.4), material=new THREE.MeshBasicMaterial({map:texture.value});
  const palette=new THREE.Mesh(geometry,material); palette.position.y=.85;
  scene.add(a.value,b.value,palette); signal.throwIfAborted();
  return {scene,camera,renderFrame(frame){a.value.position.x=-.85+Math.sin(frame.time*3)*.25;a.value.rotation.y=frame.time*.4;
    a.value.scale.setScalar(inputProps.scale??1);},dispose(){geometry.dispose();material.dispose();}};
}`;
	await writeFile(join(root, "scene.ts"), scene, "utf8");
	const definitions = [
		{
			name: "model.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
			bytes: threeModel(),
		},
		{
			name: "palette.png",
			kind: "image",
			mimeType: "image/png",
			bytes: threePalette(),
		},
		{
			name: "neutral.hdr",
			kind: "environment",
			mimeType: "image/vnd.radiance",
			bytes: threeEnvironment(false),
		},
		{
			name: "neutral.exr",
			kind: "environment",
			mimeType: "image/x-exr",
			bytes: threeEnvironment(true),
		},
		{
			name: "tiny.hdr",
			kind: "environment",
			mimeType: "image/vnd.radiance",
			bytes: threeEnvironment(false, 2, 2),
		},
	] as const;
	for (const item of definitions)
		await writeFile(join(root, item.name), item.bytes);
	return {
		spec: {
			version: 1,
			engine: "three",
			sourceDirectory: root,
			entryFile: "scene.ts",
			files: ["scene.ts"],
			width: 320,
			height: 180,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 60,
			seed: 17,
			inputProps: {},
		},
		imports: definitions.map(({ name, kind, mimeType }) => ({
			id: "assets/" + name,
			kind,
			mimeType,
			filePath: join(root, name),
		})),
	};
}

if (import.meta.main) {
	if (!process.argv[2])
		throw Error("Expected a private fixture output directory");
	const result = await prepareThreeProbe(join(process.argv[2], "author"));
	await writeFile(
		join(process.argv[2], "compile.json"),
		JSON.stringify(result, null, 2),
		"utf8",
	);
}
