import { createHash } from "node:crypto";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const p1dError = error => String(error instanceof Error ? error.stack : error);

// Diagnostic samples are raw observations, never substitutes for the oracle.
export function p1dRawSamples(image) {
	return { width: image.width, height: image.height, rgbaSha256: sha256(image.pixels),
		samples: [[2, 2], [32, 32], [20, 32], [50, 32], [16, 16]].map(([x, y]) => ({ x, y,
			rgba: [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)] })) };
}

/** @param {{png: Buffer, name: string, write: (name: string, body: Buffer | string) => unknown,
 * decode: (png: Buffer) => {width: number, height: number, pixels: Uint8Array}, attempt: any,
 * observe?: () => any, validate: (image: any, observed: any) => any}} options */
export async function preserveP1dCapture({ png, name, write, decode, attempt, observe, validate }) {
	attempt.passed = false;
	try {
		attempt.stage = "png-save";
		await write(`${name}.png`, png);
		attempt.png = { path: `${name}.png`, bytes: png.length, sha256: sha256(png) };
		attempt.stage = "png-decode";
		const image = decode(png), samples = p1dRawSamples(image);
		attempt.stage = "raw-samples-save";
		await write(`${name}.samples.json`, JSON.stringify({ context: attempt, ...samples }, null, 2) + "\n");
		attempt.rawSamples = { path: `${name}.samples.json`, ...samples };
		let observed;
		if (observe) {
			attempt.stage = "observation-capture"; observed = await observe();
			attempt.stage = "observation-save";
			await write(`${name}.observation.json`, JSON.stringify({ context: attempt, observed }, null, 2) + "\n");
			attempt.observationPath = `${name}.observation.json`;
		}
		attempt.stage = "assertions";
		const checked = await validate(image, observed);
		attempt.stage = "complete"; attempt.passed = true;
		return checked;
	} catch (error) { attempt.error = p1dError(error); throw error; }
}

// Cleanup failures must not erase the first assertion/capture/storage failure.
export async function withP1dCleanup(operation, cleanup, recordCleanupError) {
	let failed = false;
	try { return await operation(); }
	catch (error) { failed = true; throw error; }
	finally {
		try { await cleanup(); }
		catch (error) { recordCleanupError(p1dError(error)); if (!failed) throw error; }
	}
}
