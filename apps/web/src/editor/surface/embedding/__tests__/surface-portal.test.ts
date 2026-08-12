import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSurfacePortalContainer } from "../surface-portal";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMBEDDING_ROOT = resolve(HERE, "..");

function source(path: string) {
	return readFileSync(resolve(EMBEDDING_ROOT, path), "utf8");
}

/**
 * `resolveSurfacePortalContainer` only ever compares identities, so the DOM types
 * in its signature need distinct object identities rather than real behaviour —
 * and bun's runner has no DOM to build real nodes from. `Object.create` yields
 * `any`, so the stub takes its type from the declared return type instead of a
 * narrowing `as` assertion.
 */
function domIdentity<T>(): T {
	return Object.create(null);
}

describe("Surface portal ownership", () => {
	test("prefers the live owner and preserves the outside-Surface fallback", () => {
		const owner = domIdentity<HTMLElement>();
		const explicit = domIdentity<DocumentFragment>();
		expect(resolveSurfacePortalContainer({ owner, explicit })).toBe(owner);
		expect(resolveSurfacePortalContainer({ owner: null, explicit })).toBe(
			explicit,
		);
		expect(resolveSurfacePortalContainer({ owner: null })).toBeUndefined();
	});

	test("waits for owner readiness so Surface children cannot escape to body", () => {
		const provider = source("surface-portal.tsx");
		expect(provider).toContain("{owner ? children : null}");
		expect(provider).toContain("data-editor-surface-portal");
		expect(provider).not.toMatch(/document\.(?:body|documentElement)/);
	});

	test("routes wrappers, tooltip, and direct overlays through the private owner", () => {
		const repoRoot = resolve(HERE, "../../../../../../..");
		for (const file of [
			"alert-dialog.tsx",
			"context-menu.tsx",
			"dialog.tsx",
			"dropdown-menu.tsx",
			"menubar.tsx",
			"popover.tsx",
			"select.tsx",
			"sheet.tsx",
			"tooltip.tsx",
		]) {
			const wrapper = readFileSync(
				resolve(repoRoot, "apps/web/src/components/ui", file),
				"utf8",
			);
			expect(wrapper).toContain("useSurfacePortalContainer");
		}
		const direct = readFileSync(
			resolve(
				repoRoot,
				"apps/web/src/components/editor/panels/assets/draggable-item.tsx",
			),
			"utf8",
		);
		expect(direct).toContain("portalOwner &&");
		expect(direct).toContain("createPortal(");
		expect(direct).not.toContain("document.body");
	});
});
