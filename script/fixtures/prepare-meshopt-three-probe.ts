import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { meshoptModel, meshoptExpectedPositions, threeEnvironment } from "./three-assets";

export async function prepareMeshoptThreeProbe(root: string) {
	await mkdir(root, { recursive: true });
	const scene = [
		"import * as THREE from 'three';",
		"export async function createScene({assets,inputProps,signal}) {",
		"  if(inputProps.stall) await new Promise(()=>{});",
		"  const expected=[0,0,0,300,0,0,0,300,0,300,300,0];",
		"  const loaded=await assets.model(inputProps.model??'assets/meshopt.glb');",
		"  const mesh=loaded.value.children[0];",
		"  const pos=mesh.geometry.getAttribute('position');",
		"  const got=Array.from({length:pos.count},(_,i)=>[pos.getX(i),pos.getY(i),pos.getZ(i)]).flat();",
		"  for(let i=0;i<expected.length;i++) if(got[i]!==expected[i]) throw Error('Meshopt decoded position mismatch at '+i+': '+got[i]+' !== '+expected[i]);",
		"  const scale=inputProps.scale??0.004;",
			"  loaded.value.position.set(-scale*150,-scale*150,0);",
		"  loaded.value.scale.setScalar(scale);",
		"  const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-2,2,1.125,-1.125,.1,20); camera.position.z=5;",
		"  const material=new THREE.MeshBasicMaterial({color:0x33cc66,side:THREE.DoubleSide});",
		"  mesh.material=material;",
		"  if(inputProps.dark) material.color.set(0x224422);",
		"  scene.add(loaded.value);",
		"  const env=await assets.environment('assets/neutral.hdr'); scene.environment=env.value;",
		"  signal.throwIfAborted();",
		"  return {scene,camera,renderFrame(frame){loaded.value.rotation.z=frame.time*(inputProps.spin??0.2);},dispose(){material.dispose();}};",
		"};",
	].join("\n");
	await writeFile(join(root, "scene.ts"), scene, "utf8");
	const definitions = [
		{ name: "meshopt.glb", kind: "model", mimeType: "model/gltf-binary", bytes: meshoptModel() },
		{ name: "meshopt-ext.glb", kind: "model", mimeType: "model/gltf-binary", bytes: meshoptModel("EXT_meshopt_compression") },
		{ name: "neutral.hdr", kind: "environment", mimeType: "image/vnd.radiance", bytes: threeEnvironment(false) },
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
			seed: 19,
			inputProps: {},
		},
		imports: definitions.map(({ name, kind, mimeType }) => ({
			id: "assets/" + name,
			kind,
			mimeType,
			filePath: join(root, name),
		})),
		expectedPositions: meshoptExpectedPositions(),
	};
}

if (import.meta.main) {
	if (!process.argv[2])
		throw Error("Expected a private fixture output directory");
	const result = await prepareMeshoptThreeProbe(join(process.argv[2], "author"));
	await writeFile(
		join(process.argv[2], "compile.json"),
		JSON.stringify(result, null, 2),
		"utf8",
	);
}
