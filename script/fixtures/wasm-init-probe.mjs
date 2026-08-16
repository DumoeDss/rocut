/**
 * Initializes `opencut-wasm` through a given specifier and reports what happened, as one JSON line
 * on stdout. Runs unchanged under node and bun; `script/check-wasm-init.mjs` executes it once per
 * (runtime, specifier) pair and reads the line.
 *
 *   --specifier=opencut-wasm                    bare — the condition-routed entry
 *   --specifier=opencut-wasm/sync               the declared explicit-instantiation subpath
 *   --specifier=opencut-wasm/opencut_wasm.js    the --target bundler entry, by deep path
 */
const argument = process.argv.find((value) => value.startsWith("--specifier="));
const specifier = argument ? argument.slice("--specifier=".length) : "opencut-wasm";

const report = {
	runtime:
		typeof Bun === "undefined"
			? `node ${process.version}`
			: `bun ${Bun.version}`,
	specifier,
	resolved: null,
	exports: 0,
	ticksPerSecond: null,
	mediaTimeFromSeconds2: null,
	roundToFrame: null,
	error: null,
};

try {
	report.resolved = import.meta.resolve(specifier);
} catch (error) {
	report.resolved = `<unresolvable: ${error instanceof Error ? error.message : String(error)}>`;
}

try {
	const wasm = await import(specifier);
	report.exports = Object.keys(wasm).length;
	report.ticksPerSecond = wasm.TICKS_PER_SECOND();
	report.mediaTimeFromSeconds2 = wasm.mediaTimeFromSeconds({ seconds: 2 });
	report.roundToFrame = wasm.roundToFrame({
		time: 12345,
		rate: { numerator: 30, denominator: 1 },
	});
} catch (error) {
	report.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(report));
