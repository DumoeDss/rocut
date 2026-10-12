import assert from "node:assert/strict";
import { lstat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { chromium } from "../browser-probe-toolchain.mjs";
import { installExtendedEffectsBrowserPins } from "./extended-effects-browser-observer.mjs";

const receipt = process.env.ROCUT_GLASS_BROWSER_PIN_RECEIPT;
assert(
	isAbsolute(receipt ?? "") && basename(receipt) === "browser-pins-export.json",
);
const owner = await lstat(dirname(receipt));
assert(owner.isDirectory() && !owner.isSymbolicLink());
installExtendedEffectsBrowserPins(chromium, {
	expectedSha256: process.env.ROCUT_GLASS_EXPECTED_WASM_SHA256,
	writeReceipt: (report) =>
		writeFile(receipt, JSON.stringify(report, null, 2) + "\n", {
			encoding: "utf8",
			flag: "wx",
		}),
});
