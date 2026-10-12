import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { resolveEngineToolchain } from "../programmatic/engines/toolchain-resolver";
import { createProgrammaticBuildService } from "../programmatic/engines/build-service";
import { HYPERFRAMES_TOOLCHAIN, REMOTION_TOOLCHAIN, THREE_TOOLCHAIN } from "../programmatic/engines/engine-versions";
import type { ProgrammaticResourceStore } from "../programmatic/resources";

function fixture() {
	const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, "rocut-toolchain-resolver-"));
	const vendor = join(root, "vendor"), directory = join(root, "prebuilds", "win32-x64", "toolchain");
	mkdirSync(directory, { recursive: true }); mkdirSync(join(vendor, "run"), { recursive: true });
	const entryUrl = pathToFileURL(join(vendor, "run", "rocut.mjs")).href;
	const write = (file: string, value: object | string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); };
	const marker = (engines: string[]) => write(join(directory, "rocut-engine-toolchain.json"), { version: 1, kind: "rocut-engine-toolchain", engines });
	// Structural dependency fixtures, not executable compiler/runtime substitutes.
	const seed = (pins: Record<string, string>) => {
		const packages: Record<string, object> = {};
		for (const [name, version] of Object.entries(pins)) { write(join(directory, "node_modules", name, "package.json"), { name, version }); packages[`node_modules/${name}`] = { version, integrity: "sha512-YQ==" }; }
		write(join(directory, "package-lock.json"), { lockfileVersion: 3, packages });
		for (const file of ["node_modules/esbuild/lib/main.js", "node_modules/@hyperframes/core/dist/compiler/index.js", "node_modules/@hyperframes/core/dist/compiler/htmlDocument.js", "node_modules/acorn/dist/acorn.mjs"]) write(join(directory, file), "// dependency metadata probe only\n");
	};
	return { root, directory, entryUrl, write, marker, seed, cleanup: () => { if (dirname(root) !== parent || !root.startsWith(join(parent, "rocut-toolchain-resolver-"))) throw Error("Unsafe resolver fixture cleanup"); rmSync(root, { recursive: true, force: true }); } };
}

test("fixed platform prebuild discovery admits only marker-declared structurally pinned engines, never claims runtime health", () => {
	const f = fixture(); try {
		f.marker(["three"]); f.seed(THREE_TOOLCHAIN);
		const result = resolveEngineToolchain({ entryUrl: f.entryUrl });
		expect(result.directory).toBe(f.directory); expect(result.source).toBe("bundled"); expect(result.configured).toBe(true);
		expect(result.probes.filter(p => p.ready).map(p => p.engine)).toEqual(["three"]);
		expect(result.probes.find(p => p.engine === "remotion")!.diagnostics).toEqual([{ code: "engine-not-packaged" }]);
	} finally { f.cleanup(); }
});

test("unsupported or injected platform targets fail closed; explicit traditional directories remain target independent", () => {
	const f = fixture(); try {
		f.marker(["three"]); f.seed(THREE_TOOLCHAIN);
		for (const [platform, arch] of [["../win32", "x64"], ["win32", "../x64"], ["unknown", "x64"]]) {
			const result = resolveEngineToolchain({ entryUrl: f.entryUrl, platform, arch });
			expect(result.directory).toBeUndefined(); expect(result.configured).toBe(false);
			expect(result.diagnostics).toEqual([{ code: "bundled-toolchain-platform-unsupported" }]);
			expect(resolveEngineToolchain({ explicit: f.directory, platform, arch }).probes[2].ready).toBe(true);
		}
		for (const [platform, arch] of [["linux", "x64"], ["darwin", "arm64"], ["win32", "arm64"]]) {
			const result = resolveEngineToolchain({ entryUrl: f.entryUrl, platform, arch });
			expect(result.directory).toBe(join(f.root, "prebuilds", `${platform}-${arch}`, "toolchain"));
			expect(result.configured).toBe(false);
			expect(result.diagnostics).toEqual([{ code: "bundled-toolchain-marker-missing" }]);
		}
		const old = join(f.root, "vendor", "toolchain"); mkdirSync(old);
		f.write(join(old, "rocut-engine-toolchain.json"), { version: 1, kind: "rocut-engine-toolchain", engines: ["three"] });
		rmSync(join(f.directory, "rocut-engine-toolchain.json"));
		expect(resolveEngineToolchain({ entryUrl: f.entryUrl, platform: "win32", arch: "x64" }).diagnostics).toEqual([{ code: "bundled-toolchain-marker-missing" }]);
	} finally { f.cleanup(); }
});

test("explicit override wins and invalid or disabled overrides never fall back to a valid bundle", () => {
	const f = fixture(); try {
		f.marker(["three"]); f.seed(THREE_TOOLCHAIN);
		for (const explicit of ["", "relative-path", join(f.root, "missing")]) {
			const result = resolveEngineToolchain({ explicit, entryUrl: f.entryUrl });
			expect(result.source).toBe("explicit"); expect(result.configured).toBe(false); expect(result.probes.some(p => p.ready)).toBe(false);
		}
		rmSync(join(f.directory, "rocut-engine-toolchain.json"));
		const explicit = resolveEngineToolchain({ explicit: f.directory, entryUrl: "https://not-a-module.invalid/" });
		expect(explicit.probes.filter(p => p.ready).map(p => p.engine)).toEqual(["three"]);
		expect(explicit.probes.find(p => p.engine === "remotion")!.diagnostics.some(d => d.package === "remotion")).toBe(true);
	} finally { f.cleanup(); }
});

test("missing, malformed and unsupported bundle markers fail closed without ancestor discovery", () => {
	const f = fixture(); try {
		f.seed(THREE_TOOLCHAIN);
		for (const marker of [undefined, "{broken", { version: 2, kind: "rocut-engine-toolchain", engines: ["three"] }, { version: 1, kind: "rocut-engine-toolchain", engines: ["three", "three"] }, { version: 1, kind: "rocut-engine-toolchain", engines: ["unknown"] }]) {
			if (marker !== undefined) f.write(join(f.directory, "rocut-engine-toolchain.json"), marker);
			const result = resolveEngineToolchain({ entryUrl: f.entryUrl }); expect(result.configured).toBe(false);
			expect(result.diagnostics[0].code).toMatch(/marker/);
		}
		expect(resolveEngineToolchain({ explicit: f.directory }).configured).toBe(false);
	} finally { f.cleanup(); }
});

test("partial directories report exact missing pins; manifest, lock and compiler entry corruption are independently rejected", () => {
	const f = fixture(); try {
		f.marker(["hyperframes", "remotion", "three"]); f.seed(THREE_TOOLCHAIN);
		const partial = resolveEngineToolchain({ entryUrl: f.entryUrl }); expect(partial.probes.filter(p => p.ready).map(p => p.engine)).toEqual(["three"]);
		expect(partial.probes.find(p => p.engine === "hyperframes")!.diagnostics).toContainEqual({ code: "package-missing-or-invalid", package: "@hyperframes/core", expectedVersion: "0.8.139" });
		f.write(join(f.directory, "node_modules/three/package.json"), { name: "three", version: "0.185.0" });
		expect(resolveEngineToolchain({ entryUrl: f.entryUrl }).probes[2].diagnostics).toContainEqual({ code: "package-pin-mismatch", package: "three", expectedVersion: "0.185.1" });
		f.seed(THREE_TOOLCHAIN); f.write(join(f.directory, "package-lock.json"), { packages: { "node_modules/three": { version: "0.185.1" } } });
		expect(resolveEngineToolchain({ entryUrl: f.entryUrl }).probes[2].diagnostics.some(d => d.code === "lock-package-pin-or-integrity-mismatch")).toBe(true);
		f.seed(THREE_TOOLCHAIN); rmSync(join(f.directory, "node_modules/esbuild/lib/main.js"));
		expect(resolveEngineToolchain({ entryUrl: f.entryUrl }).probes[2].diagnostics).toContainEqual({ code: "compiler-entry-missing", file: "node_modules/esbuild/lib/main.js" });
		f.write(join(f.directory, "package-lock.json"), "{bad"); expect(resolveEngineToolchain({ entryUrl: f.entryUrl }).diagnostics).toEqual([{ code: "toolchain-lock-missing-or-invalid" }]);
	} finally { f.cleanup(); }
});

test("all existing exact dependency sets can be probed without expanding pins", () => {
	const f = fixture(); try {
		f.marker(["hyperframes", "remotion", "three"]); f.seed({ ...HYPERFRAMES_TOOLCHAIN, ...REMOTION_TOOLCHAIN, ...THREE_TOOLCHAIN });
		expect(resolveEngineToolchain({ entryUrl: f.entryUrl }).probes.every(p => p.ready)).toBe(true);
	} finally { f.cleanup(); }
});

test("service advertises only available engines and returns structured missing-package 503 before compilation", async () => {
	const f = fixture(); f.seed(THREE_TOOLCHAIN);
	const service = createProgrammaticBuildService({} as ProgrammaticResourceStore, task => task(), f.directory);
	const server = createServer((request, response) => { void service.handle("compile", request, response); });
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	try {
		expect(service.capability.engines).toEqual([{ engine: "three", version: "0.185.1" }]);
		expect(service.capability.remotionInspection.configured).toBe(false);
		expect(service.capability.toolchain.boundary).toContain("not-compile-browser-or-GPU-health");
		const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { method: "POST", body: JSON.stringify({ engine: "remotion" }) });
		expect(response.status).toBe(503); const body = await response.json(); expect(body.engine).toBe("remotion");
		expect(body.diagnostics).toContainEqual({ code: "package-missing-or-invalid", package: "remotion", expectedVersion: "4.0.440" });
	} finally { await service.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); f.cleanup(); }
});
