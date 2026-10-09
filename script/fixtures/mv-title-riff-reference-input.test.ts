import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { snapshotTitleRiffFrame, snapshotTitleRiffSong, titleRiffRequiredImages } from "./mv-title-riff-reference-input";
import { titleRiffTestFrame, titleRiffTestSong } from "./mv-title-riff-reference-cases";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity";
import { snapshotTitleRiffAssets, verifyTitleRiffAssetHashes } from "./mv-title-riff-reference-assets";
import type { TitleRiffFont, TitleRiffImage } from "./mv-title-riff-reference-contract";

test("complete explicit intro/outro and song inputs snapshot without aliasing", () => {
	const song = titleRiffTestSong(), snapshot = snapshotTitleRiffSong(song);
	Object.assign(song, { credit: "changed", bpm: 200 });
	expect(snapshot.credit).toBe("LOCAL ORACLE"); expect(snapshot.bpm).toBe(120); expect(snapshot.downbeatIndex0).toBe(2);
	for (const variant of ["intro", "outro"] as const) {
		const original = titleRiffTestFrame(variant), copy = snapshotTitleRiffFrame(original);
		Object.assign(original.args.cues, { lock: 19 }); Object.assign(original.args.hud, { title: "changed" });
		expect(copy.args.cues.lock).toBe(variant === "intro" ? 12 : 8); expect(copy.args.hud.title).not.toBe("changed");
		expect(titleRiffRequiredImages(copy)).toEqual(variant === "intro" ? ["character.png", "sky.png"] : ["character.png", "sky.png", "dawn.png"]);
	}
});

test("no implicit clock origin/downbeat, malformed beats or unknown song field", () => {
	for (const key of ["beats", "bpm", "downbeatIndex0", "credit"]) {
		const song = titleRiffTestSong(); Reflect.deleteProperty(song, key); expect(() => snapshotTitleRiffSong(song)).toThrow();
	}
	for (const patch of [{ beats: [1, 1] }, { beats: [2, 1] }, { beats: [NaN] }, { beats: [-1] }, { bpm: 0 }, { bpm: Infinity },
		{ downbeatIndex0: 1.5 }, { downbeatIndex0: -1 }, { downbeatIndex0: 1000 }, { phase: 0 }, { credit: "\ud800" }])
		expect(() => snapshotTitleRiffSong(Object.assign(titleRiffTestSong(), patch))).toThrow();
	expect(snapshotTitleRiffSong({ beats: [], bpm: 120, downbeatIndex0: 0, credit: "" }).beats).toEqual([]);
});

test("shot time, all cue/HUD fields and variant resources are explicit", () => {
	for (const key of ["time", "shotStart", "duration", "args"]) {
		const frame = titleRiffTestFrame("intro"); Reflect.deleteProperty(frame, key); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
	for (const patch of [{ time: 0 }, { time: 99 }, { time: NaN }, { shotStart: -1 }, { duration: 0 }, { duration: Infinity }, { sourceTime: 0 }])
		expect(() => snapshotTitleRiffFrame(Object.assign(titleRiffTestFrame("intro"), patch))).toThrow();
	for (const field of ["char", "sky", "cues", "hud", "glyphs", "ruby", "sub", "grain", "exit"]) {
		const frame = titleRiffTestFrame("intro"); Reflect.deleteProperty(frame.args, field); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
	for (const field of Object.keys(titleRiffTestFrame("intro").args.cues)) {
		const frame = titleRiffTestFrame("intro"); Reflect.deleteProperty(frame.args.cues, field); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
	for (const field of ["recap", "final"]) {
		const frame = titleRiffTestFrame("outro"); Reflect.deleteProperty(frame.args, field); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
});

test("bounded geometry and Unicode are checked without altering original exit:false semantics", () => {
	for (const patch of [{ grain: -1 }, { grain: 1.01 }, { ruby: null }, { glyphs: ["A"] }, { glyphs: ["", "B"] }, { glyphs: ["\ud800", "B"] }, { final: "ignored.png" }]) {
		const frame = titleRiffTestFrame("intro"); Object.assign(frame.args, patch); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
	for (const patch of [{ neg: -2 }, { sun: -1 }, { sil: 12 }, { exit: 12 }, { ko: 20 }, { sun: 0.5 }, { unknown: 3 }]) {
		const frame = titleRiffTestFrame("intro"); Object.assign(frame.args.cues, patch); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
	const frame = titleRiffTestFrame("intro"); Object.assign(frame.args, { exit: false, ruby: false, sub: "" });
	expect(snapshotTitleRiffFrame(frame).args.cues.exit).toBe(15);
	for (const patch of [{ zoom: 0 }, { x: NaN }, { rot: Infinity }, { alternate: 1 }]) {
		const frame = titleRiffTestFrame("outro"); Object.assign(frame.args.recap![0]!.view, patch); expect(() => snapshotTitleRiffFrame(frame)).toThrow();
	}
});

const bytes = (path: string | URL) => { const value = readFileSync(path); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; };
const local = (name: string) => bytes(new URL(`../../apps/web/public/motion-text/fonts/${name}`, import.meta.url));
test("real local SFNT family/weight proof refuses Black900 relabeled Medium500", () => {
	expect(titleRiffFontIdentity(local("zen-old-mincho-black.ttf"), "Zen Old Mincho", 900).staticWeight).toBe(900);
	expect(titleRiffFontIdentity(local("noto-serif-jp-variable.ttf"), "Noto Serif JP", 300).weightRange).toEqual([200, 900]);
	expect(() => titleRiffFontIdentity(local("zen-kaku-gothic-new-black.ttf"), "Zen Kaku Gothic New", 500)).toThrow("weight");
	expect(() => titleRiffFontIdentity(local("dot-gothic-16-regular.ttf"), "Zen Old Mincho", 900)).toThrow("family");
	expect(() => titleRiffFontIdentity(new ArrayBuffer(8), "DotGothic16", 400)).toThrow();
});

test.skipIf(!process.env.ROCUT_TEST_TITLE_RIFF_GOTHIC500)("complete actual byte identities snapshot and reject missing/hash/alpha declarations", async () => {
	const specs = [["Zen Old Mincho", 900, local("zen-old-mincho-black.ttf")], ["DotGothic16", 400, local("dot-gothic-16-regular.ttf")],
		["Noto Serif JP", 300, local("noto-serif-jp-variable.ttf")], ["Zen Kaku Gothic New", 500, bytes(process.env.ROCUT_TEST_TITLE_RIFF_GOTHIC500!)]] as const;
	const fonts: TitleRiffFont[] = specs.map(([family, weight, body], i) => ({ id: `font${i}`, family, weight, body, mimeType: "font/ttf", byteLength: body.byteLength, sha256: createHash("sha256").update(new Uint8Array(body)).digest("hex") }));
	const body = new Uint8Array([1, 2, 3]).buffer;
	const images: TitleRiffImage[] = [{ id: "marker.png", mimeType: "image/png", body, byteLength: 3, sha256: createHash("sha256").update(new Uint8Array(body)).digest("hex"), width: 2, height: 3, hasTransparency: true }];
	const copy = snapshotTitleRiffAssets(fonts, images); await verifyTitleRiffAssetHashes(copy);
	new Uint8Array(body)[0] = 9; expect(new Uint8Array(copy.images[0]!.body)[0]).toBe(1);
	expect(() => snapshotTitleRiffAssets(fonts.slice(1), images)).toThrow();
	expect(() => snapshotTitleRiffAssets(fonts, [{ ...images[0]!, byteLength: 2 }])).toThrow();
	expect(() => snapshotTitleRiffAssets(fonts, [{ ...images[0]!, width: 0 }])).toThrow();
	Object.assign(copy.images[0]!, { sha256: "0".repeat(64) }); await expect(verifyTitleRiffAssetHashes(copy)).rejects.toThrow("identity");
});
