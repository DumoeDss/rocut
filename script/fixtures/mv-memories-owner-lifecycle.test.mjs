/** In-memory transpilation of actual production leaves. No fixture is imported
 * by production, no browser/pixel claim, no filesystem/cache writes. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const root = resolve(
	"packages/editor-classic/src/services/renderer/programmatic",
);
const modules = new Map();
const nativeGlobals = {};
function load(file) {
	if (modules.has(file)) return modules.get(file).exports;
	const module = { exports: {} };
	modules.set(file, module);
	const code = ts.transpileModule(readFileSync(file, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
	const require = (id) =>
		load(
			id === "@opencut/editor-contracts"
				? resolve("packages/editor-contracts/src/programmatic-resources.ts")
				: resolve(dirname(file), `${id}.ts`),
		);
	runInNewContext(
		code,
		{
			module,
			exports: module.exports,
			require,
			structuredClone,
			crypto: webcrypto,
			TextEncoder,
			Uint8Array,
			ArrayBuffer,
			Error,
			Map,
			Set,
			JSON,
			Number,
			Promise,
			Object,
			Array,
			String,
			...nativeGlobals,
		},
		{ filename: file },
	);
	return module.exports;
}
const { createMemoriesOwnerProvider } = load(
	resolve(root, "mv-memories-owner-provider.ts"),
);
const sha = "a".repeat(64),
	identity = { ownerId: 1, sessionId: 1 };
const image = (id) => ({
	id,
	kind: "image",
	attachmentKey: id,
	mimeType: "image/png",
	byteLength: 4,
	sha256: sha,
});
const font = (id, weight) => ({
	id,
	kind: "font",
	attachmentKey: id,
	mimeType: "font/ttf",
	byteLength: 4,
	sha256: sha,
	font: { family: "Handwritten", style: "normal", weight },
});
const raster = (part) => ({
	bindingSha256: sha,
	part,
	width: 1,
	height: 1,
	rgbaSha256: sha,
});
const publication = (rasters = []) => ({
	identity,
	plan: { commands: [], rasterBudgetBytes: 4 },
	rasters,
});
function output(data) {
	let freed = false;
	return {
		json: () => JSON.stringify(data),
		bytes: () => new Uint8Array(4),
		free() {
			assert.equal(freed, false);
			freed = true;
		},
	};
}
function setup() {
	const events = [],
		images = ["p0", "p1", "p2", "p3", "character"].map(image),
		fonts = [font("caption", 600), font("date", 400)];
	const measurements = [
		{ font: "caption", fontSize: 40, weight: 600, texts: ["猫", "😀"] },
		{ font: "date", fontSize: 22, weight: 400, texts: ["4.17"] },
	];
	const args = {
		photos: images
			.slice(0, 4)
			.map((r) => ({ bg: r.id, caption: "猫😀", date: "4.17" })),
		char: "character",
		captionFont: "caption",
		dateFont: "date",
	};
	let ticketFreed = false;
	const owner = {
		reserve() {
			events.push("reserve");
			return {
				free() {
					ticketFreed = true;
					events.push("ticket.free");
				},
			};
		},
		diagnosticJson: () => JSON.stringify({ ownerId: 1, disposed: false }),
		prepareReserved(ticket, metadata) {
			const data = JSON.parse(metadata);
			assert.equal(data.images.length, 5);
			assert.deepEqual(
				data.fonts.map((f) => [f.weight, f.fontSize, Object.keys(f.widths)]),
				[
					[600, 40, ["猫", "😀"]],
					[400, 22, ["4.17"]],
				],
			);
			ticket.free();
			events.push("prepare");
			return 1;
		},
		beginStage(session, kind, slot) {
			events.push(`${kind}:${slot}`);
			const planJson = '{"commands":[],"rasterBudgetBytes":1e-07}';
			return output({
				output: publication(),
				size: [1, 1],
				planJson,
				planSha256: createHash("sha256").update(planJson).digest("hex"),
			});
		},
		acceptStage(session, stage) {
			stage.free();
			return undefined;
		},
		cancelStage() {
			throw Error("unexpected cancelStage");
		},
		preparedJson: () =>
			JSON.stringify({
				identity,
				rasters: [
					raster("desk"),
					...args.photos.map((_, i) => raster(`base-${i}`)),
				],
			}),
		preparedBytes: () => new Uint8Array(4),
		frame: () => output(publication([raster("live-frame")])),
		finishFrame(session, out) {
			out.free();
			events.push("finish");
		},
		cancel() {
			events.push("cancel");
			return true;
		},
	};
	const statics = {
		capabilityJson: () =>
			JSON.stringify({ maxOwnerBytes: 256 * 1024 * 1024, opaqueStages: true }),
		sourceRequestsJson: () =>
			JSON.stringify({ images, fonts, measurements, photos: 4 }),
		sourceAdmissionJson: () => JSON.stringify({ width: 1, height: 1 }),
	};
	const native = {
		assets: {},
		async image({ resource }) {
			events.push(`decode:${resource.id}`);
			return new Uint8Array(4);
		},
		async font({ resource }) {
			events.push(`font:${resource.id}`);
		},
		measure(requests) {
			assert.deepEqual(requests, measurements);
			return requests.map((r) => ({
				...r,
				widths: Object.fromEntries(r.texts.map((t) => [t, 10])),
			}));
		},
		async upload({ r }) {
			events.push(`upload:${r.part}`);
		},
		readback() {
			events.push("readback");
			return new Uint8Array(4);
		},
		release(r) {
			events.push(`release:${r.part}`);
		},
		dispose() {
			events.push("native.dispose");
		},
	};
	return {
		events,
		owner,
		statics,
		native,
		args,
		resources: [...images, ...fonts],
		ceilingBytes: 256 * 1024 * 1024,
		loadBytes: async () => new Uint8Array(4),
		ticketFreed: () => ticketFreed,
	};
}
test("stage rejects reserialized plan bytes before native readback", async () => {
	const fixture = setup();
	const begin = fixture.owner.beginStage;
	fixture.owner.beginStage = (...args) => {
		const stage = begin(...args);
		const data = JSON.parse(stage.json());
		data.planJson = JSON.stringify(JSON.parse(data.planJson));
		stage.json = () => JSON.stringify(data);
		return stage;
	};
	let readbacks = 0;
	fixture.native.readback = () => { readbacks++; return new Uint8Array(4); };
	await assert.rejects(createMemoriesOwnerProvider(fixture), /original Rust stage plan digest mismatch/);
	assert.equal(readbacks, 0);
	assert.ok(fixture.events.includes("native.dispose"));
});
test("all four photo stages plus character, exact Rust font requests and local LUT precede desk", async () => {
	const fixture = setup(),
		provider = await createMemoriesOwnerProvider(fixture);
	assert.deepEqual(
		fixture.events.filter((v) => /^(lut|composite|print|desk):/.test(v)),
		[
			"lut:0",
			"composite:0",
			"print:0",
			"composite:1",
			"print:1",
			"composite:2",
			"print:2",
			"composite:3",
			"print:3",
			"desk:0",
		],
	);
	assert.equal(fixture.events.filter((v) => v.startsWith("decode:")).length, 5);
	await provider.frame({
		input: {},
		draw() {
			fixture.events.push("draw");
		},
	});
	assert.ok(fixture.events.indexOf("draw") < fixture.events.indexOf("finish"));
	await provider.dispose();
	assert.deepEqual(fixture.events.slice(-2), ["native.dispose", "cancel"]);
});
test("dispose waits for asynchronous frame upload drain before native close and Rust lease release", async () => {
	const fixture = setup(),
		provider = await createMemoriesOwnerProvider(fixture);
	let complete, started;
	const pending = new Promise((r) => {
			complete = r;
		}),
		ready = new Promise((r) => {
			started = r;
		});
	fixture.native.upload = async ({ r }) => {
		if (r.part === "live-frame") {
			started();
			await pending;
			fixture.events.push("late-upload-done");
		}
	};
	const frame = provider.frame({
		input: {},
		draw() {
			throw Error("cancelled frame must not draw");
		},
	});
	await ready;
	const disposal = provider.dispose();
	await Promise.resolve();
	assert.equal(fixture.events.includes("cancel"), false);
	assert.equal(fixture.events.includes("native.dispose"), false);
	complete();
	await assert.rejects(frame, /cancelled/);
	await disposal;
	assert.ok(
		fixture.events.indexOf("late-upload-done") <
			fixture.events.indexOf("native.dispose"),
	);
	assert.ok(
		fixture.events.indexOf("native.dispose") < fixture.events.indexOf("cancel"),
	);
});
test("abort during asynchronous source load retains reservation until load settles", async () => {
	const fixture = setup(),
		abort = new AbortController();
	let complete, started;
	const pending = new Promise((r) => {
			complete = r;
		}),
		ready = new Promise((r) => {
			started = r;
		});
	fixture.loadBytes = async () => {
		started();
		await pending;
		return new Uint8Array(4);
	};
	const preparing = createMemoriesOwnerProvider({
		...fixture,
		signal: abort.signal,
	});
	await ready;
	abort.abort();
	assert.equal(fixture.ticketFreed(), false);
	complete();
	await assert.rejects(preparing);
	assert.equal(fixture.ticketFreed(), true);
	assert.equal(fixture.events.includes("prepare"), false);
});
test("actual native upload leaf checks SHA/dimensions and resolves only full Rust raster identity",async()=>{
 let uploads=0,closes=0,view;
 nativeGlobals.ImageData=class {constructor(data,width,height){this.data=data;this.width=width;this.height=height;view=data;}};
 nativeGlobals.createImageBitmap=async pixels=>{uploads++;return{width:pixels.width,height:pixels.height,close(){closes++;}};};
 const {createMemoriesNativePlatform}=load(resolve(root,"mv-memories-owner-native.ts"));
 const native=createMemoriesNativePlatform({replay:{},makeSurface(){throw Error("upload must not allocate canvas");},fontSet:{delete(){}}});
 const bytes=new Uint8Array([10,20,30,255]);
 const rgbaSha256=Buffer.from(await webcrypto.subtle.digest("SHA-256",bytes)).toString("hex");
 const r={...raster("actual-upload"),rgbaSha256};
 await assert.rejects(native.upload({r,bytes:new Uint8Array(4)}),/digest/);
 assert.equal(uploads,0);await native.upload({r,bytes});assert.equal(uploads,1);
 assert.equal(view.buffer,bytes.buffer);assert.equal(native.assets.memoriesPixels(r).data,view);
 assert.throws(()=>native.assets.memoriesRaster({...r,bindingSha256:"b".repeat(64)}),/binding/);
 assert.throws(()=>native.assets.memoriesRaster({...r,part:"another-part"}),/binding/);
 native.dispose();assert.equal(closes,1);assert.throws(()=>native.assets.memoriesPixels(r),/binding/);
});
