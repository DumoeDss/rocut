import { installFlameWrapPresentationObserver } from "./flame-wrap-presentation-observer.mjs";

export function flameWrapEditorInit() {
	Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined });
	// Opaque-origin authoring iframes throw even when reading this property.
	// Keep registration blocked without Playwright's unguarded getter injection.
	try {
		const workers = navigator.serviceWorker;
		if (workers)
			workers.register = async () => {
				throw new Error(
					"Private editor probe blocks service worker registration",
				);
			};
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "SecurityError")
			throw error;
	}
}

export async function createFlameWrapEditorPage({
	browser,
	origin,
	report,
	redact,
}) {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1,
		serviceWorkers: "allow",
	});
	await context.addInitScript(flameWrapEditorInit);
	await context.addInitScript(installFlameWrapPresentationObserver, {
		width: 192,
		height: 128,
	});
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (!["http:", "https:"].includes(url.protocol) || url.origin === origin)
			await route.continue();
		else {
			report.externalRequests.push(redact(url.href));
			await route.abort();
		}
	});
	report.browserIsolation = {
		freshContext: true,
		serviceWorkerRegistration: "guarded deny before authored scripts",
		localOriginOnly: true,
		authoringSandboxUnchanged: true,
	};
	const page = await context.newPage();
	page.on("console", (message) =>
		report.console.push({ type: message.type(), text: redact(message.text()) }),
	);
	page.on("pageerror", (error) => report.pageErrors.push(redact(error)));
	page.on("response", (response) => {
		if (response.status() >= 400)
			report.httpFailures.push({
				url: redact(response.url()),
				status: response.status(),
			});
	});
	return page;
}
