import { surfaceBackendChecks } from "./mv-surface-checks";

async function run() {
	const response = await fetch("/surface-font.ttf");
	if (!response.ok) throw Error("Missing declared real surface font fixture");
	const bytes = await response.arrayBuffer();
	const font = new FontFace("SurfaceFixture", bytes, {
		style: "normal",
		weight: "400",
		variationSettings: '"TEST" 550',
	});
	await font.load();
	document.fonts.add(font);
	try {
		if (font.status !== "loaded" || !document.fonts.has(font))
			throw Error("Independent oracle font failed to load");
		const backends = [];
		for (const backend of ["worker", "html"] as const)
			backends.push(await surfaceBackendChecks({ backend, bytes }));
		return {
			passed: backends.every((backend) => backend.passed),
			backends,
			scope:
				"Controlled hand-authored internal-plan raster primitives against independent handwritten HTMLCanvas oracles. Worker Offscreen and explicit HTML 2D factory; not native author ingress, titleRiff, Host persistence, export or group/master post acceptance.",
		};
	} finally {
		document.fonts.delete(font);
	}
}
declare global {
	var __mvSurface:
		| Awaited<ReturnType<typeof run>>
		| { passed: false; error: string }
		| undefined;
}
run()
	.then((result) => {
		globalThis.__mvSurface = result;
	})
	.catch((error) => {
		globalThis.__mvSurface = { passed: false, error: String(error) };
	});
