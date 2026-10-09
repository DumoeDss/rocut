import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";

const parent = path.resolve(tmpdir());
const root = await mkdtemp(path.join(parent, "rocut-html-probe-"));
const host = await startHost({
	projectRoot: path.join(root, "project"),
	registry: new TargetRegistry(path.join(root, "registry")),
	staticDir: process.env.ROCUT_PROBE_STATIC_DIR,
});
console.log(JSON.stringify({ editorUrl: host.editorUrl }));
await new Promise<void>((resolve) => {
	process.stdin.once("data", () => resolve());
	process.stdin.once("end", () => resolve());
	process.on("SIGTERM", () => resolve());
});
await host.close();
if (
	path.dirname(root) !== parent ||
	!path.basename(root).startsWith("rocut-html-probe-")
)
	throw Error("Invalid fixture cleanup root");
await rm(root, { recursive: true, force: true });
