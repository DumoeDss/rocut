/**
 * s05-second-host — the production store-bridge proof (task 4.6).
 *
 * The conformance and migration evidence runs `NodeFsStoreBridge` directly
 * under `bun test`, where there is no Electron. This script proves the OTHER
 * half of design E4's "two implementations, deliberately": the same bridge
 * class serving the real production path — sandboxed preload
 * (`window.opencutStore`) → `opencut-store:<operation>` IPC → main-process
 * handlers over `node:fs` — against a disposable `OPENCUT_STORE_ROOT`.
 *
 * What must hold for the proof to pass:
 *  - every operation round-trips through the page's own bridge (typed values
 *    included: a Date in an opaque record payload, an attachment body);
 *  - the on-disk layout under the override root is exactly design E4 (the
 *    same layout the bun probes assert), including the boot-written
 *    `store.json`;
 *  - `clearFiles({kind: "all"})` empties the root.
 *
 * Run after `bun run --cwd apps/electron-host build` (the renderer dist from
 * Group 3 plus the `dist-main/main-store-ipc.cjs` seam this proof exercises).
 */
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const mainPath = join(appRoot, "electron", "main.cjs");

const consoleErrors = [];

function fail(message) {
	console.error("STORE BRIDGE PROOF FAILED:", message);
	console.error("console errors:", JSON.stringify(consoleErrors, null, 2));
	process.exit(1);
}

async function main() {
	const seamBundle = join(appRoot, "dist-main", "main-store-ipc.cjs");
	if (!existsSync(seamBundle)) {
		fail("dist-main/main-store-ipc.cjs is missing — run `bun run --cwd apps/electron-host build` first");
	}

	const root = mkdtempSync(join(tmpdir(), "opencut-fs-bridge-proof-"));
	const app = await electron.launch({
		executablePath: require("electron"),
		args: [mainPath, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
		env: { ...process.env, OPENCUT_STORE_ROOT: root },
	});
	const page = await app.firstWindow();
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

	await page.getByRole("button", { name: "New project" }).waitFor({ timeout: 120_000 });

	// Every step runs inside the page against the page's own bridge; the
	// result crosses back as plain JSON (Dates etc. are compared in-page).
	const pageResult = await page.evaluate(async () => {
		const store = window.opencutStore;
		const out = { steps: [] };
		const step = (name, ok, detail) =>
			out.steps.push({ name, ok: Boolean(ok), detail: String(detail) });
		if (!store) {
			out.fatal = "window.opencutStore is not exposed";
			return out;
		}
		try {
			const empty = await store.listRecords();
			step("listRecords-empty", empty.length === 0, `count=${empty.length}`);

			const when = new Date("2026-08-15T00:00:00.000Z");
			await store.saveRecord({
				record: {
					id: "bridge-proof",
					schemaVersion: 1,
					data: { note: "store-bridge-proof", when, tags: ["ipc", "fs"] },
				},
				summary: {
					id: "bridge-proof",
					name: "Bridge proof",
					createdAt: "2026-08-15T00:00:00.000Z",
					updatedAt: "2026-08-15T00:00:00.000Z",
				},
			});
			const loaded = await store.loadRecord("bridge-proof");
			step(
				"record-roundtrip",
				loaded && loaded.record.id === "bridge-proof" && loaded.record.schemaVersion === 1,
				`schemaVersion=${loaded?.record.schemaVersion}`,
			);
			const data = loaded?.record.data;
			step(
				"opaque-date-survives",
				data?.when instanceof Date && data.when.getTime() === when.getTime(),
				`when=${String(data?.when)}`,
			);

			await store.saveLibraryRecord({
				namespace: "proof-ns",
				key: "proof-key",
				schemaVersion: 1,
				data: { keep: true },
			});
			const library = await store.loadLibraryRecord("proof-ns", "proof-key");
			step(
				"library-roundtrip",
				library?.data?.keep === true && library.key === "proof-key",
				`key=${library?.key}`,
			);

			await store.saveAttachment(
				"bridge-proof",
				"probe-body",
				{ origin: "store-bridge-proof" },
				new Uint8Array([9, 8, 7, 6]).buffer,
			);
			const attachment = await store.loadAttachment("bridge-proof", "probe-body");
			const bytes = attachment ? Array.from(new Uint8Array(attachment.body)).join(",") : "";
			step(
				"attachment-roundtrip",
				attachment && attachment.body.byteLength === 4 && bytes === "9,8,7,6",
				`bytes=${bytes}`,
			);
			const attachments = await store.listAttachments("bridge-proof");
			step(
				"listAttachments",
				attachments.length === 1 && attachments[0].key === "probe-body",
				`count=${attachments.length}`,
			);

			const listings = await store.listRecords();
			step(
				"listRecords-one",
				listings.length === 1 && listings[0].id === "bridge-proof",
				`count=${listings.length}`,
			);

			const inspection = await store.inspectFiles();
			step(
				"inspectFiles",
				typeof inspection.usedBytes === "number" && inspection.usedBytes > 0,
				`usedBytes=${inspection.usedBytes}`,
			);

			await store.removeAttachment("bridge-proof", "probe-body");
			const afterRemove = await store.listAttachments("bridge-proof");
			step("removeAttachment", afterRemove.length === 0, `count=${afterRemove.length}`);
		} catch (error) {
			out.fatal = String(error);
		}
		return out;
	});

	await app.close();

	// Node-side: the on-disk layout under the override root is design E4 —
	// proof the main process ran the same bridge class to the same layout the
	// bun probes assert. removeAttachment unlinks the body and meta files; the
	// now-empty attachments/ directory legitimately remains.
	const attachmentDir = join(root, "projects", "bridge-proof", "attachments");
	const attachmentLeftovers = existsSync(attachmentDir)
		? readdirSync(attachmentDir).filter((name) => name.startsWith("probe-body"))
		: [];
	const layout = {
		storeJson: existsSync(join(root, "store.json")),
		record: existsSync(join(root, "projects", "bridge-proof", "record.json")),
		libraryRecord: existsSync(join(root, "library", "proof-ns", "proof-key.json")),
		attachmentRemoved: attachmentLeftovers.length === 0,
	};
	let storeIdentity = null;
	if (layout.storeJson) {
		const envelope = JSON.parse(readFileSync(join(root, "store.json"), "utf8"));
		storeIdentity = envelope.identity ?? null;
	}

	// clearFiles({kind:"all"}) was NOT exercised in-page (it would race the
	// window close); do it through a fresh launch so the durable clearing path
	// is proven too — one extra launch, same root.
	const clearApp = await electron.launch({
		executablePath: require("electron"),
		args: [mainPath, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
		env: { ...process.env, OPENCUT_STORE_ROOT: root },
	});
	const clearPage = await clearApp.firstWindow();
	await clearPage.getByRole("button", { name: "New project" }).waitFor({ timeout: 120_000 });
	const clearResult = await clearPage.evaluate(async () => {
		await window.opencutStore.clearFiles({ kind: "all" });
		const listings = await window.opencutStore.listRecords();
		return { remaining: listings.length };
	});
	await clearApp.close();

	const afterClear = existsSync(join(root, "projects"));
	rmSync(root, { recursive: true, force: true });

	const verdict = {
		pageResult,
		layout,
		storeIdentity,
		clearResult,
		afterClearProjectsExist: afterClear,
		consoleErrors,
	};
	console.log(JSON.stringify(verdict, null, 2));

	if (pageResult.fatal) fail(`in-page bridge failure: ${pageResult.fatal}`);
	for (const step of pageResult.steps ?? []) {
		if (!step.ok) fail(`step "${step.name}" did not hold (${step.detail})`);
	}
	if (!layout.storeJson) fail("boot bookkeeping store.json was not written");
	if (storeIdentity !== "opencut-fs-production") fail(`store.json identity is ${storeIdentity}`);
	if (!layout.record) fail("projects/bridge-proof/record.json was not written");
	if (!layout.libraryRecord) fail("library/proof-ns/proof-key.json was not written");
	if (!layout.attachmentRemoved) fail(`removeAttachment left ${attachmentLeftovers.join(", ")} behind`);
	if (clearResult.remaining !== 0) fail(`clearFiles left ${clearResult.remaining} listing(s)`);
	if (afterClear) fail("projects tree survived clearFiles({kind:'all'})");
	const bridgeErrors = consoleErrors.filter((line) => /opencut[- ]store/i.test(line));
	if (bridgeErrors.length > 0) fail(`bridge-related console errors: ${bridgeErrors.join(" | ")}`);
	console.log("STORE BRIDGE PROOF PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("STORE BRIDGE PROOF FAILED:", err);
	console.error("console errors:", JSON.stringify(consoleErrors, null, 2));
	process.exit(1);
});
