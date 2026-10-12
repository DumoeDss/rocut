import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tunnelFileIdentity } from "./mv-tunnel-native-identities.mjs";

/** Save the actual gate failure, plus separately labelled follow-up renders. */
export async function saveTunnelRaceArtifacts({ page, artifact, globalKey = "__tunnelRaceFailure", prefix = "race" }) {
	const metadata = await page.evaluate(key => globalThis[key]?.metadata, globalKey);
	if (!metadata) return undefined;
	const owners = await page.evaluate(key => Object.keys(globalThis[key].buffers), globalKey);
	const files = [];
	const length = 1920 * 1080 * 4;
	for (const owner of owners) for (const layer of ["pixels", "postPixels"]) {
		const buffer = Buffer.alloc(length);
		for (let offset = 0; offset < length; offset += 256 * 1024) {
			const count = Math.min(256 * 1024, length - offset);
			const encoded = await page.evaluate(({ owner, layer, offset, count, length, globalKey }) => {
				const bytes = globalThis[globalKey].buffers[owner][layer];
				if (bytes.length !== length) throw Error("Invalid retained failure RGBA");
				let binary = "";
				for (let i = offset; i < offset + count; i += 8192)
					binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, offset + count)));
				return btoa(binary);
			}, { owner, layer, offset, count, length, globalKey });
			const bytes = Buffer.from(encoded, "base64");
			assert.equal(bytes.length, count);
			bytes.copy(buffer, offset);
		}
		const file = `${prefix}-${owner}-${layer}.rgba`;
		await writeFile(join(artifact, file), buffer, { flag: "wx" });
		files.push({ file, ...await tunnelFileIdentity(join(artifact, file)) });
	}
	const metadataFile = globalKey === "__tunnelRaceFailure" && prefix === "race"
		? "race-failure.json" : `${prefix}-diagnostic.json`;
	await writeFile(join(artifact, metadataFile), JSON.stringify({ metadata, files }, null, 2), { flag: "wx" });
	return { metadata, files };
}
