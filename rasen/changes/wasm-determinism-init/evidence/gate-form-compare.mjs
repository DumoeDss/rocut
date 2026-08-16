/** Compares the old `indexOf` gate-location form against the new `run:` regex form. */
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/bun-ci.yml", "utf8");
const gate = "script/check-wasm-init.mjs";
const escaped = gate.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const oldAt = (w) => w.indexOf(gate);
const newAt = (w) => w.search(new RegExp(`run:\\s*node ${escaped}\\s*$`, "m"));
const installAt = (w) => w.search(/run:\s*bun install/);

function verdict(w, label) {
	const o = oldAt(w);
	const n = newAt(w);
	const i = installAt(w);
	const oldPasses = o !== -1 && i !== -1 && o > i;
	const newPasses = n !== -1 && i !== -1 && n > i;
	console.log(
		`${label.padEnd(48)} old=${oldPasses ? "PASSES" : "catches"}  new=${newPasses ? "PASSES" : "catches"}`,
	);
}

const stepLine = /^([ \t]*)run: node script\/check-wasm-init\.mjs[ \t]*$/m;

verdict(workflow, "unmodified workflow (both must PASS)");
verdict(
	workflow.replace(stepLine, "$1run: echo skipped"),
	"step gutted, comment still names the gate",
);
verdict(
	workflow.replace(stepLine, "$1run: echo skipped").replaceAll(gate, "gone.mjs"),
	"step gutted and every mention removed",
);
verdict(
	workflow.replace(stepLine, "$1run: node script/check-wasm-init.mjs --quiet"),
	"gate invoked with an extra flag",
);
// Move the gate before `bun install` by swapping the two run lines.
const moved = workflow
	.replace(stepLine, "$1run: __SENTINEL__")
	.replace(/run: bun install/, "run: node script/check-wasm-init.mjs")
	.replace("run: __SENTINEL__", "run: bun install");
verdict(moved, "gate moved before `bun install`");
