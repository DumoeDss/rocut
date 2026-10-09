import {
	evaluateThreeParticleMaterials as evaluate,
	snapshotThreeParticleMaterials as snapshot,
	THREE_PARTICLE_MATERIAL_LIMITS as CAPS,
} from "../programmatic/engines/three-particle-materials";

interface ThreeBrowserFixtureApi {
	MeshBasicMaterial: new () => { map: unknown; transparent: boolean };
	Texture: new (image: CanvasImageSource) => {
		flipY: boolean;
		colorSpace: string;
	};
	SRGBColorSpace: string;
}

/** Bundle into a controlled browser with the pinned Three namespace as argument. */
export async function runThreeParticleMaterialBrowserFixture(
	THREE: ThreeBrowserFixtureApi,
) {
	let assertions = 0;
	const assert = (condition: boolean, reason: string) => {
		assertions++;
		if (!condition) throw Error(`material browser fixture: ${reason}`);
	};
	const rejects = (operation: () => unknown, reason: string) => {
		let message = "";
		try {
			operation();
		} catch (error) {
			message = String(error);
		}
		assert(
			message.includes(reason),
			`expected rejection containing ${reason}, got ${message}`,
		);
	};
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 2;
	const context = canvas.getContext("2d", {
		colorSpace: "srgb",
		willReadFrequently: true,
	})!;
	const input = new Uint8ClampedArray([
		128, 64, 32, 255, 31, 79, 143, 127, 255, 0, 0, 0, 255, 255, 255, 255,
	]);
	context.putImageData(new ImageData(input, 2, 2), 0, 0);
	const reference = Array.from(
		context.getImageData(0, 0, 2, 2, { colorSpace: "srgb" }).data,
	);
	const outputOptions = {
		maxAllocationBytes: 65536,
		underflow: "reject" as const,
	};
	const linear = (byte: number) => {
		const c = byte / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const makeMaterial = (image: CanvasImageSource) => {
		const texture = new THREE.Texture(image);
		texture.flipY = false;
		texture.colorSpace = THREE.SRGBColorSpace;
		const material = new THREE.MeshBasicMaterial();
		material.map = texture;
		material.transparent = true;
		return { material, texture };
	};
	const verify = (image: CanvasImageSource, expected: readonly number[]) => {
		const { material } = makeMaterial(image);
		const state = snapshot([material]);
		const result = evaluate(
			[
				{ materialIndex: 0, uv: [0.25, 0.25] },
				{ materialIndex: 0, uv: [0.75, 0.25] },
				{ materialIndex: 0, uv: [0.25, 0.75] },
				{ materialIndex: 0, uv: [0.75, 0.75] },
			],
			state,
			outputOptions,
		);
		assert(
			state.browserPixels === "srgb-rgba8-unpremultiplied-readback",
			"explicit browser readback semantics",
		);
		assert(
			state.allocatedBytes ===
				CAPS.bookkeepingBytes + CAPS.materialBytes + CAPS.textureBytes + 32,
			"canvas plus readback reservation",
		);
		for (let channel = 0; channel < 16; channel++) {
			const want =
				channel % 4 === 3 ? expected[channel] / 255 : linear(expected[channel]);
			assert(
				Math.abs(result.color[channel] - want) < 1e-6,
				`RGBA channel ${channel}`,
			);
		}
		return { material, state, result };
	};
	const original = verify(canvas, reference);
	context.clearRect(0, 0, 2, 2);
	assert(
		evaluate(
			[{ materialIndex: 0, uv: [0.25, 0.25] }],
			original.state,
			outputOptions,
		).color[0] === original.result.color[0],
		"source canvas mutation cannot change prior snapshot",
	);
	context.putImageData(new ImageData(input, 2, 2), 0, 0);
	const image = new Image();
	image.src = canvas.toDataURL("image/png");
	await image.decode();
	verify(image, reference);
	const bitmap = await createImageBitmap(canvas, {
		premultiplyAlpha: "none",
		colorSpaceConversion: "none",
	});
	try {
		verify(bitmap, reference);
		const flipped = makeMaterial(bitmap);
		flipped.texture.flipY = true;
		rejects(
			() => snapshot([flipped.material]),
			"ImageBitmap requires flipY=false",
		);
	} finally {
		bitmap.close();
	}
	const offscreen = new OffscreenCanvas(2, 2);
	offscreen.getContext("2d")!.drawImage(canvas, 0, 0);
	verify(offscreen, reference);
	const beforeDraw = makeMaterial(canvas);
	const admission =
		CAPS.bookkeepingBytes + CAPS.materialBytes + CAPS.textureBytes + 31;
	const contextPrototype = OffscreenCanvasRenderingContext2D.prototype;
	const originalDraw = contextPrototype.drawImage;
	let draws = 0;
	contextPrototype.drawImage = function (...args: unknown[]) {
		draws++;
		return Reflect.apply(originalDraw, this, args);
	};
	try {
		rejects(
			() => snapshot([beforeDraw.material], { maxAllocationBytes: admission }),
			"budget",
		);
		assert(draws === 0, "budget rejection occurs before canvas draw");
	} finally {
		contextPrototype.drawImage = originalDraw;
	}
	const originalRead = contextPrototype.getImageData;
	const readFailure = new DOMException(
		"fixture taint-style readback failure",
		"SecurityError",
	);
	contextPrototype.getImageData = () => {
		throw readFailure;
	};
	try {
		let caught: unknown;
		try {
			snapshot([beforeDraw.material]);
		} catch (error) {
			caught = error;
		}
		assert(
			caught instanceof Error && caught.cause === readFailure,
			"readback failure preserves the SecurityError cause",
		);
	} finally {
		contextPrototype.getImageData = originalRead;
	}
	const pendingImage = makeMaterial(new Image());
	rejects(() => snapshot([pendingImage.material]), "texture width");
	const video = makeMaterial(document.createElement("video"));
	rejects(
		() => snapshot([video.material]),
		"decoded image, canvas or ImageBitmap",
	);
	return {
		assertions,
		inputRgba8: Array.from(input),
		browserReadbackRgba8: reference,
		inputByteExact: input.every((value, index) => value === reference[index]),
		semantics:
			"sRGB unpremultiplied RGBA8 browser readback; transparent RGB/alpha precision may differ from source bytes",
	};
}
