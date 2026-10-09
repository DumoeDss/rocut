/**
 * Loads classic's real 32-step migration chain — no `evidence/wasm-test-mock`, no
 * `mock.module` — and reports what came back, as one JSON line on stdout.
 *
 * This is the entry S05 recorded as unloadable: the chain reaches `opencut-wasm` transitively
 * (`migrations/transformers/v27-to-v28.ts` and `services/storage/service.ts` both import from
 * `src/wasm`, whose module body calls `TICKS_PER_SECOND()` at evaluation time), so a wasm module
 * that will not initialize takes the whole chain down with it. TypeScript source, so bun only.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const report: {
	runtime: string;
	currentProjectVersion: number | null;
	transformers: number | null;
	firstTransformer: string | null;
	error: string | null;
} = {
	runtime: typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`,
	currentProjectVersion: null,
	transformers: null,
	firstTransformer: null,
	error: null,
};

try {
	// Resolve the public export from its actual consumer, not accidental root hoisting.
	const consumer = createRequire(new URL("../../apps/cli/package.json", import.meta.url));
	const chain = await import(pathToFileURL(consumer.resolve("@opencut/editor-classic/storage/migrations")).href);
	report.currentProjectVersion = chain.CURRENT_PROJECT_VERSION;
	report.transformers = chain.migrations.length;
	report.firstTransformer = chain.migrations[0]?.constructor.name ?? null;
} catch (error) {
	report.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(report));
