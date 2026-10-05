import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLinkedTone } from "../probe-linked-range-media.mjs";

test("range audio oracle rejects the beginning of the file, silence and changed gain", () => {
	const tone = (frequency, amplitude = 0.125) => {
		const pcm = Buffer.alloc(48000 * 4);
		for (let i = 0; i < 48000; i++)
			pcm.writeFloatLE(
				amplitude * Math.sin((2 * Math.PI * frequency * i) / 48000),
				i * 4,
			);
		return pcm;
	};
	assert(Math.abs(verifyLinkedTone(tone(880), 0.2, 880).frequency - 880) < 25);
	assert.throws(() => verifyLinkedTone(tone(440), 0.2, 880), /source offset/);
	assert.throws(() => verifyLinkedTone(tone(880, 0), 0.2, 880));
	assert.throws(() => verifyLinkedTone(tone(880, 0.04), 0.2, 880), /amplitude/);
	assert.throws(() => verifyLinkedTone(tone(880), 0.95, 880));
});
