import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function verifyStrokePixels({ pixels, channels, align, inverted }) {
	assert.equal(pixels.length, 160 * 90 * channels);
	const offset = { inside: -50, center: 0, outside: 50 }[align];
	assert(Number.isFinite(offset));
	const outer = { x: 530 + offset, y: 320 + offset };
	const inner = { x: 430 + offset, y: 220 + offset };
	const counts = { red: 0, green: 0, black: 0 };
	// Keep samples inside the video image, away from the CSS canvas border.
	for (let y = 2; y < 88; y += 3) {
		for (let x = 2; x < 158; x += 3) {
			const dx = Math.abs((x + 0.5) * 12 - 960),
				dy = Math.abs((y + 0.5) * 12 - 540);
			if (
				[480, outer.x, inner.x].some((edge) => Math.abs(dx - edge) < 20) ||
				[270, outer.y, inner.y].some((edge) => Math.abs(dy - edge) < 20)
			)
				continue;
			const stroke =
				dx < outer.x && dy < outer.y && !(dx < inner.x && dy < inner.y);
			const visible = (dx < 480 && dy < 270) !== inverted;
			const expected = stroke ? "green" : visible ? "red" : "black";
			const i = (y * 160 + x) * channels;
			const [r, g, b] = pixels.slice(i, i + 3);
			const pass =
				expected === "green"
					? g > 190 && r < 45 && b < 45
					: expected === "red"
						? r > 190 && g < 45 && b < 45
						: r < 30 && g < 30 && b < 30;
			assert(
				pass,
				align +
					" inverted=" +
					inverted +
					" pixel " +
					x +
					"," +
					y +
					" expected " +
					expected +
					" got " +
					[r, g, b],
			);
			counts[expected]++;
		}
	}
	assert(
		Object.values(counts).every((count) => count > 30),
		"stroke oracle needs all three colors",
	);
	return counts;
}

export function verifyStrokeExport({ file, align, inverted }) {
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
		const counts = verifyStrokePixels({ pixels, channels: 3, align, inverted });
		const wrong = align === "inside" ? "outside" : "inside";
		assert.throws(
			() => verifyStrokePixels({ pixels, channels: 3, align: wrong, inverted }),
			/expected .* got/,
			"wrong alignment must be rejected",
		);
		return { time, counts, rejectedAlignment: wrong };
	});
}

export function strokeRedArea({ align, inverted }) {
	const offset = { inside: -50, center: 0, outside: 50 }[align];
	return inverted
		? 1 -
				(2 * Math.max(480, 530 + offset) * 2 * Math.max(270, 320 + offset)) /
					(1920 * 1080)
		: (2 * Math.min(480, 430 + offset) * 2 * Math.min(270, 220 + offset)) /
				(1920 * 1080);
}
