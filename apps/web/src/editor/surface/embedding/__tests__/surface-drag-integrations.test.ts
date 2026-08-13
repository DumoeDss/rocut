import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../..");

function source(path: string) {
	return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("Surface drag integrations", () => {
	test("all concrete Surface continuations register with the coordinator", () => {
		for (const path of [
			"apps/web/src/components/ui/number-field.tsx",
			"apps/web/src/components/ui/color-picker.tsx",
			"apps/web/src/components/editor/panels/assets/draggable-item.tsx",
			"apps/web/src/timeline/bookmarks/hooks/use-bookmark-drag.ts",
			"apps/web/src/timeline/hooks/use-timeline-resize.ts",
			"apps/web/src/timeline/hooks/element/use-element-interaction.ts",
			"apps/web/src/timeline/hooks/element/use-keyframe-drag.ts",
		]) {
			expect(source(path)).toContain("dragCoordinator.start(");
		}
	});

	test("number scrub preserves pointer ownership and finish/cancel semantics", () => {
		const numberField = source("apps/web/src/components/ui/number-field.tsx");
		expect(numberField).toContain("useOptionalSurfaceDragCoordinator()");
		expect(numberField).toContain("const pointerId = event.pointerId;");
		expect(numberField).toMatch(
			/finish:\s*handlePointerUp,[\s\S]*cancel:\s*handlePointerCancel/,
		);
		// Finish AND cancel both commit. `onScrub` applies every intermediate value,
		// so a drag that ends through `cancel` — which the single-slot per-Surface
		// coordinator makes reachable by pre-empting an in-flight scrub — must still
		// close the transaction. Extract each handler body rather than matching
		// `[\s\S]*` across the file, which would pass on tokens in unrelated scopes.
		const handlerBody = (name: string) => {
			const start = numberField.indexOf(`const ${name} = (`);
			expect(start, `${name} exists`).toBeGreaterThan(-1);
			const end = numberField.indexOf("\n\t\t};", start);
			expect(end, `${name} body terminates`).toBeGreaterThan(start);
			return numberField.slice(start, end);
		};
		expect(numberField.match(/onScrubEnd\?\.\(\)/g)).toHaveLength(2);
		expect(handlerBody("handlePointerUp")).toContain("onScrubEnd?.()");
		expect(handlerBody("handlePointerCancel")).toContain("onScrubEnd?.()");
		expect(handlerBody("handlePointerUp")).toContain("exitPointerLock()");
		expect(handlerBody("handlePointerCancel")).toContain("exitPointerLock()");
		for (const type of ["pointermove", "pointerup", "pointercancel"]) {
			expect(numberField.match(new RegExp(`addEventListener\\("${type}"`, "g"))).toHaveLength(1);
			expect(numberField.match(new RegExp(`removeEventListener\\("${type}"`, "g"))).toHaveLength(1);
		}
	});

	test("controller finish paths preserve their established mouse-up commit handlers", () => {
		for (const path of [
			"apps/web/src/timeline/controllers/element-interaction-controller.ts",
			"apps/web/src/timeline/controllers/keyframe-drag-controller.ts",
			"apps/web/src/timeline/controllers/resize-controller.ts",
		]) {
			const controller = source(path);
			expect(controller).toContain("startMouseDrag({");
			expect(controller).toMatch(/finish:\s*this\.handleMouseUp/);
			expect(controller).toMatch(/cancel:\s*\(\) => this\.cancel\(\)/);
		}
	});

	test("bookmark commits only from coordinator finish and cancellation only clears state", () => {
		const bookmark = source(
			"apps/web/src/timeline/bookmarks/hooks/use-bookmark-drag.ts",
		);
		expect(bookmark.match(/moveBookmark\(/g)).toHaveLength(1);
		expect(bookmark).toContain("finish: () => {");
		expect(bookmark).toContain("cancel: clear");
		expect(bookmark).not.toMatch(/document\.addEventListener\("mouse(?:move|up)"/);
	});
});
