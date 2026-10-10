import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "bun:test";
import { glassObjectAssets } from "./glass-object-assets";
const directory = process.env.ROCUT_GLASS_THREE_TOOLCHAIN;
const check = test.skipIf(!directory);
if (directory) assert(isAbsolute(directory));
check(
	"real pinned Three physical material preserves fractional Glass coefficients without renderer",
	async () => {
		const manifest = JSON.parse(
			await readFile(
				join(directory!, "node_modules/three/package.json"),
				"utf8",
			),
		);
		assert.equal(manifest.version, "0.185.1");
		const THREE = await import(
			pathToFileURL(
				join(directory!, "node_modules/three/build/three.module.js"),
			).href
		);
		const material = new THREE.MeshPhysicalMaterial({
			transmission: 0.875,
			ior: 1.625,
			dispersion: 0.125,
			roughness: 0.123456789012345,
		});
		assert.equal(material.transmission, 0.875);
		assert.equal(material.ior, 1.625);
		assert.equal(material.dispersion, 0.125);
		assert.equal(material.roughness, 0.123456789012345);
		material.dispose();
	},
);
check(
	"actual fixture GLB/PNG structure and Three HDR loader satisfy controlled-driver environment minimum",
	async () => {
		const assets = glassObjectAssets();
		assert.deepEqual(
			assets.map((asset) => asset.kind),
			["model", "environment", "image"],
		);
		assert.equal(assets[0].body.readUInt32LE(0), 0x46546c67);
		assert.equal(assets[0].body.readUInt32LE(4), 2);
		assert.equal(assets[0].body.readUInt32LE(8), assets[0].body.length);
		const { HDRLoader } = await import(
			pathToFileURL(
				join(
					directory!,
					"node_modules/three/examples/jsm/loaders/HDRLoader.js",
				),
			).href
		);
		const body = assets[1].body;
		const decoded = new HDRLoader().parse(
			body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
		);
		assert.equal(decoded.width, 64);
		assert.equal(decoded.height, 32);
		assert.equal(decoded.data.length, 64 * 32 * 4);
		assert.equal(decoded.data[0], 15360);
		assert.equal(assets[2].body.readUInt32BE(16), 2);
		assert.equal(assets[2].body.readUInt32BE(20), 2);
	},
);
