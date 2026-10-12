import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, wasm, topLevelAwait } from "./browser-probe-toolchain.mjs";
import { createHtmlProbeWasmPlugin, HTML_PRIVATE_WASM_ID } from "./html-probe-wasm-binding.mjs";
import { resolveRequiredProbeWasmBinding } from "./fixtures/browser-probe-identity.mjs";

/** Use one genuine initialized WASM in the entire browser module graph. */
export async function buildNativeAudioExportProbe(root, isolated, output, fixture = "native-audio-export-browser", { base = "/" } = {}) {
  const require = createRequire(join(root, "packages/editor-classic/package.json"));
  const binding = resolveRequiredProbeWasmBinding({ directory: isolated, expectedWasmSha256: process.env.ROCUT_PROBE_WASM_SHA256 });
  await build({ root, base, configFile: false, logLevel: "error",
    plugins: [createHtmlProbeWasmPlugin(binding), { name: "native-audio-isolated-wasm",
      generateBundle() {
        for (const id of this.getModuleIds()) if (/[/\\]node_modules[/\\]opencut-wasm[/\\]/.test(id))
          throw Error("Audio fixture resolved a shared stale WASM instead of its isolated build");
      },
    }, wasm(), topLevelAwait()],
    resolve: { alias: { "opencut-wasm": HTML_PRIVATE_WASM_ID, mediabunny: join(dirname(require.resolve("mediabunny")), "../modules/src/index.js") } },
    build: { outDir: output, emptyOutDir: false, target: "esnext", reportCompressedSize: false,
      rollupOptions: { input: join(root, `script/fixtures/${fixture}.html`) } },
  });
}
