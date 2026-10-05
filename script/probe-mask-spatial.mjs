import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Independent analytic oracle: all three UI cases author 40% width/height,
// 35 degrees clockwise, center (+8%, -4%). Never read production path data.
export function verifyShapePixels({ pixels, channels, shape, inverted }) {
	const width = 160,
		height = 90;
	assert.equal(pixels.length, width * height * channels);
	const angle = (35 * Math.PI) / 180;
	let checked = 0,
		revealed = 0,
		hidden = 0;
	for (let y = 3; y < height; y += 5) {
		for (let x = 3; x < width; x += 5) {
			const dx = ((x + 0.5) / width - 0.58) * 1920;
			const dy = ((y + 0.5) / height - 0.46) * 1080;
			const u = (dx * Math.cos(angle) + dy * Math.sin(angle)) / 384;
			const v = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / 216;
			const distance =
				shape === "Ellipse"
					? Math.hypot(u, v)
					: shape === "Diamond"
						? Math.abs(u) + Math.abs(v)
						: Math.max(Math.abs(u), Math.abs(v));
			// Exclude only edge pixels affected by resize and antialiasing.
			if (Math.abs(distance - 1) < 0.15) continue;
			const red = distance < 1 !== inverted;
			const i = (y * width + x) * channels;
			const [r, g, b] = pixels.slice(i, i + 3);
			assert(
				red ? r > 170 && g < 65 && b < 65 : r < 35 && g < 35 && b < 35,
				shape +
					" inverted=" +
					inverted +
					" pixel " +
					x +
					"," +
					y +
					" expected " +
					(red ? "red" : "black") +
					" got " +
					[r, g, b],
			);
			checked++;
			if (red) revealed++;
			else hidden++;
		}
	}
	assert(
		checked > 400 && revealed > 20 && hidden > 20,
		"oracle must cover both sides",
	);
	return { checked, revealed, hidden };
}

export async function readShapePreview(page) {
	const png = await page.locator("canvas").first().screenshot();
	return page.evaluate(async (bytes) => {
		const image = await createImageBitmap(
			new Blob([new Uint8Array(bytes)], { type: "image/png" }),
		);
		try {
			const canvas = new OffscreenCanvas(160, 90);
			const ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0, 160, 90);
			return Array.from(ctx.getImageData(0, 0, 160, 90).data);
		} finally {
			image.close();
		}
	}, Array.from(png));
}

export function verifyShapeExport({ file, shape, inverted }) {
	return [0.1, 0.5, 0.9].map((time) => {
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(time),
				"-i",
				file,
				"-frames:v",
				"1",
				"-vf",
				"scale=160:90",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ windowsHide: true },
		);
		const result = verifyShapePixels({ pixels, channels: 3, shape, inverted });
		const rejected = [];
		if (time === 0.5) {
			for (const transform of ["horizontal-mirror", "shift-right-12px"]) {
				const wrong = Buffer.alloc(pixels.length);
				for (let y = 0; y < 90; y++) {
					for (let x = 0; x < 160; x++) {
						const sourceX =
							transform === "horizontal-mirror" ? 159 - x : (x + 148) % 160;
						const source = (y * 160 + sourceX) * 3;
						pixels.copy(wrong, (y * 160 + x) * 3, source, source + 3);
					}
				}
				assert.throws(
					() =>
						verifyShapePixels({ pixels: wrong, channels: 3, shape, inverted }),
					/expected (red|black) got/,
					transform + " must be rejected despite preserving area",
				);
				rejected.push(transform);
			}
		}
		return { time, ...result, rejected };
	});
}
