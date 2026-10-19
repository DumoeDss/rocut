import { expect, test } from "bun:test";
import type { KeyboardEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaCard } from "./media-card";
import {
	clearSelection,
	selectRange,
	toggleSelection,
} from "../../../../../selection/state";

function keyboardEvent({
	key,
	nested = false,
	ctrlKey = false,
	metaKey = false,
	shiftKey = false,
	defaultPrevented = false,
}: {
	key: string;
	nested?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	defaultPrevented?: boolean;
}) {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- identity-only DOM fixture; no DOM APIs are exercised
	const card = {} as HTMLDivElement;
	let prevented = defaultPrevented;
	let stopped = false;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- synthetic event fixture supplies the fields used by the rendered handler
	const event = {
		key,
		target: nested ? {} : card,
		currentTarget: card,
		ctrlKey,
		metaKey,
		shiftKey,
		altKey: false,
		get defaultPrevented() {
			return prevented;
		},
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {
			stopped = true;
		},
	} as KeyboardEvent<HTMLDivElement>;
	return { event, prevented: () => prevented, stopped: () => stopped };
}

test("used state is readable, accessible, and adds no interactive control", () => {
	for (const isUsed of [false, true]) {
		const card = MediaCard({
			id: "a",
			name: "sample",
			isUsed,
			children: <span>preview</span>,
			onPreview: () => {},
		});
		expect(card.props["data-used"]).toBe(isUsed);
		expect(card.props["aria-label"]).toBe("sample");
		expect(card.props["aria-description"]).toStartWith(
			isUsed ? "已使用；" : "未使用；",
		);
		const content = renderToStaticMarkup(<>{card.props.children}</>);
		expect(content.includes("已使用")).toBe(isUsed);
		expect(content).not.toMatch(/button|tabindex|draggable/);
		expect(content).toContain("preview");
	}
});

test("card Enter previews once and exposes a visible focus affordance and keyboard help", () => {
	let previews = 0;
	const card = MediaCard({
		id: "a",
		name: "sample",
		children: null,
		onPreview: () => (previews += 1),
	});
	const key = keyboardEvent({ key: "Enter" });
	card.props.onKeyDown?.(key.event);
	expect(previews).toBe(1);
	expect(key.prevented()).toBe(true);
	expect(key.stopped()).toBe(true);
	expect(card.props["aria-label"]).toBe("sample");
	expect(card.props["aria-description"]).toContain("Shift");
	expect(card.props.className).toContain("focus-visible:ring-2");
});

test("nested add/retry/input controls keep native Enter and Space without card preview", () => {
	let previews = 0;
	const card = MediaCard({
		id: "a",
		name: "sample",
		children: null,
		onPreview: () => (previews += 1),
	});
	for (const key of ["Enter", " "]) {
		const nested = keyboardEvent({ key, nested: true });
		card.props.onKeyDown?.(nested.event);
		expect(nested.prevented()).toBe(false);
		expect(nested.stopped()).toBe(false);
	}
	const consumed = keyboardEvent({ key: "Enter", defaultPrevented: true });
	card.props.onKeyDown?.(consumed.event);
	expect(previews).toBe(0);
});

test("Space and modified Enter remain available to the existing batch-selection owner", () => {
	let previews = 0;
	const card = MediaCard({
		id: "b",
		name: "sample",
		children: null,
		onPreview: () => (previews += 1),
	});
	for (const options of [
		{ key: " " },
		{ key: " ", ctrlKey: true },
		{ key: " ", metaKey: true },
		{ key: " ", shiftKey: true },
		{ key: "Enter", ctrlKey: true },
		{ key: "Enter", shiftKey: true },
	]) {
		const key = keyboardEvent(options);
		card.props.onKeyDown?.(key.event);
		expect(key.prevented()).toBe(false);
	}
	expect(previews).toBe(0);
	// Preserve the existing selection reducer rather than creating a card-local selection.
	const selected = toggleSelection({ state: clearSelection(), id: "a" });
	expect(toggleSelection({ state: selected, id: "b" }).selectedIds).toEqual([
		"a",
		"b",
	]);
	expect(
		selectRange({
			state: selected,
			orderedIds: ["a", "b", "c"],
			targetId: "c",
			isAdditive: false,
		}).selectedIds,
	).toEqual(["a", "b", "c"]);
});
