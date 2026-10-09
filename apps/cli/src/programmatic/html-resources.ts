import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";

/** Only verified attachment bytes are embedded. Escape HTML raw-text delimiters
 * even inside JSON: family names and logical IDs must never end this script.
 */
export function htmlResourceBootstrap(
	resources: readonly ResolvedProgrammaticResource[],
	eagerImages = true,
): string {
	// Documents are executed only through the selected, CSP-isolated srcdoc.
	// Do not duplicate multi-megabyte bundles as resource URLs or font faces.
	const entries = resources
		.filter(({ resource }) =>
			["image", "font", "video", "model", "environment"].includes(
				resource.kind,
			),
		)
		.map(({ resource, body }) => ({
			...resource,
			base64: Buffer.from(body).toString("base64"),
		}));
	const json = JSON.stringify(entries).replace(/</g, "\\u003c");
	return `
const resourceEntries = ${json};
const resourceImages = new Map();
const resourceBinary = new Map(resourceEntries.map(resource => [resource.id, resource.base64]));
const resourceDescriptors = new Map(resourceEntries.map(({base64, ...resource}) => [resource.id, Object.freeze({...resource, ...(resource.font ? {font: Object.freeze({...resource.font, ...(resource.font.axes ? {axes: Object.freeze({...resource.font.axes})} : {})})} : {})})]));
const resourceUrls = new Map(resourceEntries.filter(resource => ['image', 'font', 'video'].includes(resource.kind)).map(resource => [resource.id, 'data:' + resource.mimeType + ';base64,' + resource.base64]));
const resourcesReady = Promise.all(resourceEntries.map(async resource => {
  if (resource.kind === 'image' && ${eagerImages}) {
    const image = new Image(); image.src = resourceUrls.get(resource.id);
    await image.decode(); resourceImages.set(resource.id, image);
  } else if (resource.kind === 'font') {
    // JSON string quoting escapes quote/backslash tags without admitting CSS.
    const axes = Object.entries(resource.font.axes || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const face = new FontFace(resource.font.family, 'url(' + resourceUrls.get(resource.id) + ')', {style: resource.font.style, weight: String(resource.font.weight), ...(axes.length ? {variationSettings: axes.map(([tag, value]) => JSON.stringify(tag) + ' ' + value).join(', ')} : {})});
    await face.load(); document.fonts.add(face);
  }
}));
// Attach a rejection handler immediately; readiness failures are reported by
// the capture bootstrap even if they arrive before DOMContentLoaded.
resourcesReady.catch(() => {});
Object.defineProperty(window, 'rocutResources', {value: Object.freeze({
  ready: resourcesReady,
  url(id) { if (!resourceUrls.has(id)) throw Error('Unknown resource: ' + id); return resourceUrls.get(id); },
  image(id) { if (!resourceImages.has(id)) throw Error('Image not ready or undeclared: ' + id); return resourceImages.get(id); },
  bytes(id) { if (!resourceBinary.has(id)) throw Error('Unknown resource: ' + id); return Uint8Array.from(atob(resourceBinary.get(id)), char => char.charCodeAt(0)).buffer; },
  descriptor(id) { if (!resourceDescriptors.has(id)) throw Error('Unknown resource: ' + id); return resourceDescriptors.get(id); }
})});
`;
}
