import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

/** The oracle executes extracted original code, not a rewritten Rust formula. */
export async function lightLeakReference(referenceRoot: string) {
	const engine = join(
		referenceRoot,
		"skills/vocaloid-style-mv/template/engine",
	);
	const [util, meta] = await Promise.all([
		readFile(join(engine, "core/util.js"), "utf8"),
		readFile(join(engine, "scenes/meta.js"), "utf8"),
	]);
	const segment = (text: string, begin: string, end: string) => {
		assert.equal(
			text.split(begin).length,
			2,
			`Reference anchor changed: ${begin}`,
		);
		const from = text.indexOf(begin),
			to = text.indexOf(end, from + begin.length);
		assert.ok(to > from, `Reference end anchor changed: ${end}`);
		return text.slice(from, to);
	};
	const oneLine = (anchor: string) => segment(util, anchor, "\n");
	const code = `(function(){const Z={};
${oneLine("  Z.lerp =")}
${oneLine("  Z.hex =")}
${oneLine("  Z.rgba =")}
${segment(util, "  Z.hash =", "  Z.rng =")}
${oneLine("  Z.noise1 =")}
return function(ctx,t,amount,seed,W,H){
${segment(meta, "  function lightLeak(", "\n  async function drawSeq(")}
lightLeak(ctx,t,amount,seed);
};})()`;
	const draw = runInNewContext(code) as (
		ctx: unknown,
		t: number,
		amount: number,
		seed: number,
		width: number,
		height: number,
	) => void;
	const provenance = {
		metaSha256: createHash("sha256").update(meta).digest("hex"),
		utilSha256: createHash("sha256").update(util).digest("hex"),
		extractedSha256: createHash("sha256").update(code).digest("hex"),
		scope:
			"Original meta.js seq lightLeak + util.js hash/rnds/noise1; not gl.js",
	};
	return {
		code,
		provenance,
		geometry(
			t: number,
			amount: number,
			seed: number,
			width: number,
			height: number,
		) {
			const gradients: {
				center: number[];
				radius: number;
				stops: { offset: number; color: number[] }[];
			}[] = [];
			const draws: string[] = [];
			const ctx = {
				globalCompositeOperation: "source-over",
				fillStyle: undefined as unknown,
				save() {},
				restore() {},
				createRadialGradient(
					x: number,
					y: number,
					inner: number,
					x2: number,
					y2: number,
					radius: number,
				) {
					assert.equal(inner, 0);
					assert.equal(x2, x);
					assert.equal(y2, y);
					const gradient = {
						center: [x, y],
						radius,
						stops: [] as { offset: number; color: number[] }[],
					};
					gradients.push(gradient);
					return {
						addColorStop(offset: number, css: string) {
							const match = /^rgba\((.*)\)$/.exec(css);
							assert.ok(match);
							gradient.stops.push({
								offset,
								color: match[1]!.split(",").map(Number),
							});
						},
					};
				},
				fillRect(x: number, y: number, w: number, h: number) {
					assert.deepEqual([x, y, w, h], [0, 0, width, height]);
					draws.push(this.globalCompositeOperation);
				},
			};
			draw(ctx, t, amount, seed, width, height);
			assert.deepEqual(draws, ["screen", "screen"]);
			return gradients;
		},
	};
}
