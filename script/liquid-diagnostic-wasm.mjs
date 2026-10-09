import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Vite's module transforms find an out-of-drive diagnostic package, while its
 * raw static-file middleware returns 404 for the resulting /@fs/C:/... URL.
 * Serve exactly that one already-validated binary; never resolve request paths.
 */
export async function liquidDiagnosticWasmRoute(packageDirectory) {
	const filename = join(packageDirectory, "opencut_wasm_bg.wasm");
	const assetUrl = `/@fs/${filename.replaceAll("\\", "/")}`;
	const bytes = await readFile(filename);
	return {
		name: "liquid-diagnostic-wasm-binary",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (
					(request.originalUrl ?? request.url) !== assetUrl ||
					!["GET", "HEAD"].includes(request.method)
				)
					return next();
				response.setHeader("Content-Type", "application/wasm");
				response.setHeader("Content-Length", bytes.length);
				response.setHeader("Cache-Control", "no-store");
				response.end(request.method === "HEAD" ? undefined : bytes);
			});
		},
	};
}
