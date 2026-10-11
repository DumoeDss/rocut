import assert from "node:assert/strict";
import {
	assertGlassBrowserIdentity,
	installGlassWasmObserver,
} from "./glass-current-baseline-observer.mjs";

// Persistent contexts are not chromium.launch browsers. Install before the
// original probe receives its context; never change flags, URLs, or deadlines.
export function installExtendedEffectsBrowserPins(
	chromium,
	{ expectedSha256, writeReceipt },
) {
	assert(/^[a-f0-9]{64}$/.test(expectedSha256));
	const launch = chromium.launchPersistentContext.bind(chromium);
	let launches = 0;
	let written = false;
	const report = {
		ok: false,
		pid: process.pid,
		expectedSha256,
		served: [],
		loaded: [],
		errors: [],
		startedAt: new Date().toISOString(),
		role: "standalone extended-effects persistent Chromium",
		servedCollection: "actual Response.clone bytes before application scripts",
		limitations: [
			"No Host/Electron witness",
			"Unknown precompiled modules and synchronous constructors cannot establish loaded authority",
		],
	};
	const finish = async () => {
		if (written) return;
		written = true;
		try {
			report.identity = assertGlassBrowserIdentity(report, expectedSha256);
			report.ok = launches === 1 && !report.failure;
		} catch (error) {
			report.failure ??= String(error);
		}
		report.launches = launches;
		report.finishedAt = new Date().toISOString();
		await writeReceipt(report);
	};
	chromium.launchPersistentContext = async (...args) => {
		let context;
		try {
			launches++;
			assert.equal(
				launches,
				1,
				"One fixed case must launch exactly one persistent context",
			);
			context = await launch(...args);
			report.browserVersion = context.browser()?.version();
			await context.exposeBinding("__rocutGlassWasmPin", (_source, entry) => {
				if (entry?.kind === "served") report.served.push(entry);
				else if (entry?.kind === "loaded") report.loaded.push(entry);
				else report.errors.push(entry ?? { message: "Missing observer event" });
			});
			await context.addInitScript(installGlassWasmObserver);
			const close = context.close.bind(context);
			context.close = async (...options) => {
				try {
					return await close(...options);
				} catch (error) {
					report.failure = String(error);
					throw error;
				} finally {
					await finish();
				}
			};
			return context;
		} catch (error) {
			report.failure = String(error);
			if (context) {
				try {
					await context.close();
				} catch (closeError) {
					report.errors.push({ message: String(closeError) });
				}
			}
			await finish();
			throw error;
		}
	};
	return report;
}
