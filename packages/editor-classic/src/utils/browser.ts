import type { SessionResources } from "../editor/session/resources";

export function downloadBlob({
	blob,
	filename,
	resources,
}: {
	blob: Blob;
	filename: string;
	resources: Pick<SessionResources, "createObjectUrl">;
}): void {
	const urlHandle = resources.createObjectUrl({ blob });
	let anchor: HTMLAnchorElement | null = null;
	try {
		anchor = document.createElement("a");
		anchor.href = urlHandle.url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
	} finally {
		try {
			if (anchor?.parentNode === document.body) {
				document.body.removeChild(anchor);
			}
		} finally {
			urlHandle.revoke();
		}
	}
}

export function findScrollParent({
	element,
}: {
	element: HTMLElement;
}): HTMLElement | null {
	let parent = element.parentElement;
	while (parent) {
		const { overflow, overflowX } = window.getComputedStyle(parent);
		if (/auto|scroll/.test(overflow + overflowX)) return parent;
		parent = parent.parentElement;
	}
	return null;
}

export function isTypableDOMElement({
	element,
}: {
	element: HTMLElement;
}): boolean {
	if (element.isContentEditable) return true;

	if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
		return !element.matches(":disabled");
	}

	return false;
}
