import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createHtmlProbePhaseReporter, observeHtmlProbeExporter } from "./html-probe-native-exports.ts";

function recording(run) {
	const originalLog = console.log;
	const logs = [];
	console.log = (value) => logs.push(value);
	try { run(logs); } finally { console.log = originalLog; }
}

test("phase records are synchronous, ordered and bound to the original probe clock", () => {
	const originalTime = Date.now;
	const oldStart = Reflect.get(globalThis, "__htmlProbeStartedAt");
	const oldPhase = Reflect.get(globalThis, "__htmlProbePhase");
	Reflect.set(globalThis, "__htmlProbeStartedAt", 1000);
	Date.now = () => 1234;
	try {
		recording((logs) => {
			const phase = createHtmlProbePhaseReporter();
			phase("encode-started");
			phase("decode-started", { hasVideo: true });
			assert.equal(logs.length, 2);
			assert.match(logs[0], /"sequence":1,"probeElapsedMs":234/);
			assert.match(logs[1], /"sequence":2,"probeElapsedMs":234,"hasVideo":true/);
			assert.equal(Reflect.get(globalThis, "__htmlProbePhase"), "decode-started");
		});
	} finally {
		Date.now = originalTime;
		Reflect.set(globalThis, "__htmlProbeStartedAt", oldStart);
		Reflect.set(globalThis, "__htmlProbePhase", oldPhase);
	}
});

test("existing exporter events do not claim awaited export promise settlement", () => {
	recording((logs) => {
		const exporter = new EventEmitter();
		observeHtmlProbeExporter({ exporter, phase: createHtmlProbePhaseReporter(), prefix: "export" });
		assert.equal(logs.length, 0);
		exporter.emit("progress", 0);
		exporter.emit("progress", 0.5);
		exporter.emit("complete", new ArrayBuffer(7));
		assert.equal(logs.length, 3);
		assert.match(logs[1], /"progress":0.5,"progressEvents":2/);
		assert.match(logs[2], /export-complete-event .*"encodedBytes":7/);
		assert.ok(logs.every((line) => !line.includes("promise-resolved")));
	});
});

test("error observation retains only error class, not payload paths or private URLs", () => {
	recording((logs) => {
		const exporter = new EventEmitter();
		observeHtmlProbeExporter({ exporter, phase: createHtmlProbePhaseReporter(), prefix: "export" });
		exporter.emit("error", new Error("http://private.invalid/capability C:/private/user-file"));
		exporter.emit("cancelled");
		assert.equal(logs.length, 2);
		assert.match(logs[0], /"errorName":"Error"/);
		assert.ok(logs.every((line) => !/private|capability|user-file/.test(line)));
		assert.match(logs[1], /export-cancelled-event/);
	});
});

test("browser and launcher retain every original await operand and watchdog", async () => {
	const originalRoot = process.env.ROCUT_CPU_ORIGINAL_ROOT;
	assert.ok(originalRoot, "Explicit read-only original root is required for this CPU check");
	const require = createRequire(join(originalRoot, "package.json"));
	const ts = require("typescript");
	const printer = ts.createPrinter();
	function waits(source, file) {
		const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		assert.equal(ast.parseDiagnostics.length, 0);
		const result = [];
		function visit(node) {
			if (ts.isAwaitExpression(node)) result.push(printer.printNode(ts.EmitHint.Expression, node.expression, ast));
			ts.forEachChild(node, visit);
		}
		visit(ast);
		return result;
	}
	for (const file of ["script/fixtures/html-frame-browser-probe.ts", "script/probe-html-frames.mjs"]) {
		const before = await readFile(join(originalRoot, file), "utf8");
		const after = await readFile(new URL(file.startsWith("script/fixtures/") ? "./html-frame-browser-probe.ts" : "../probe-html-frames.mjs", import.meta.url), "utf8");
		assert.deepEqual(waits(after, file), waits(before, file), file + " must not add or alter awaited operations");
		if (file.endsWith(".mjs")) {
			assert.match(after, /timeout: styledThree \? 300000 : 180000/);
			assert.match(after, /await saveHtmlProbeFailure\(/);
		}
	}
	const helper = await readFile(new URL("./html-probe-native-exports.ts", import.meta.url), "utf8");
	assert.deepEqual(waits(helper, "helper.ts"), []);
	assert.doesNotMatch(helper, /setTimeout|Promise|initializeGpu\(|getCanvas\(/);
});
