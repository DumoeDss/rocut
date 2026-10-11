import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runLiquidProjectHost } from "./liquid-object-project-host";

const [rootArg, creatorArg, threeToolchainArg] = process.argv.slice(2);
if (!rootArg || !creatorArg || !threeToolchainArg) throw Error("usage: bun liquid-object-project-create.ts <root> <creator> <threeToolchain>");
const root = resolve(rootArg);
await mkdir(root, { recursive: true });
const outcome = await runLiquidProjectHost({
	root,
	creator: resolve(creatorArg),
	threeToolchain: resolve(threeToolchainArg),
	executable: "",
});
console.log(JSON.stringify({ ok: outcome.report.ok, projectRoot: outcome.projectRoot, projectSha256: outcome.report.projectSha256 }));
