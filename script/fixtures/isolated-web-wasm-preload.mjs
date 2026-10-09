// A wasm-pack --target web test artifact. Never replace shared dependency copies.
import { mock } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const directory = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!directory || !isAbsolute(directory)) throw Error("Expected absolute isolated WASM test directory");
const actual = await import(pathToFileURL(join(directory, "opencut_wasm.js")).href);
actual.initSync({ module: readFileSync(join(directory, "opencut_wasm_bg.wasm")) });
mock.module("opencut-wasm", () => actual);
for (const owner of ["", "packages/editor-classic/", "packages/editor-contracts/", "apps/vite-example/", "apps/cli/"]) {
  const entry = fileURLToPath(new URL(`../../${owner}node_modules/opencut-wasm/opencut_wasm_sync.js`, import.meta.url));
  if (existsSync(entry)) mock.module(entry, () => actual);
}
