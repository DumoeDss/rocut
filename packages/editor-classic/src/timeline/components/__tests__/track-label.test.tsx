import { expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TimelineTrackLabel } from "../track-label";
import type { TimelineTrack } from "../../types";
import { trackLockValidator } from "../../../editor/transactions/opencut/track-lock-runtime";
import * as lockRuntime from "../../../editor/transactions/opencut/track-lock-runtime";

function render(track: TimelineTrack) {
	return renderToStaticMarkup(
		createElement(TimelineTrackLabel, {
			track,
			onToggleMute: () => {},
			onToggleVisibility: () => {},
		}),
	);
}

test("track names and empty state are visible instead of anonymous icon rows", () => {
	const html = render({
		id: "fg",
		name: "FG 前景遮挡",
		type: "video",
		hidden: false,
		muted: false,
		elements: [],
	});
	expect(html).toContain("FG 前景遮挡");
	expect(html).toContain("空轨道");
	expect(html).toContain('data-track-id="fg"');
	expect(html).toContain('data-empty="true"');
	expect(html).toContain('aria-label="隐藏 FG 前景遮挡"');
	expect(html).toContain('aria-label="静音 FG 前景遮挡"');
	expect(html.match(/<button /g)).toHaveLength(2);
});

test("graphic tracks expose visibility but not inapplicable audio controls", () => {
	const html = render({
		id: "lyrics",
		name: "Lyrics",
		type: "graphic",
		hidden: true,
		elements: [],
	});
	expect(html).toContain('aria-label="显示 Lyrics"');
	expect(html).toContain('aria-pressed="true"');
	expect(html).not.toContain("静音 Lyrics");
	expect(html.match(/<button /g)).toHaveLength(1);
});

test("audio tracks expose mute but no inapplicable visibility controls", () => {
	const html = render({
		id: "song",
		name: "Song",
		type: "audio",
		muted: true,
		elements: [],
	});
	expect(html).toContain('aria-label="取消静音 Song"');
	expect(html).not.toContain("隐藏 Song");
});

test("visual layer order controls identify direction and disable the top boundary", () => {
	const html = renderToStaticMarkup(
		createElement(TimelineTrackLabel, {
			track: {
				id: "lyrics",
				name: "Lyrics",
				type: "graphic",
				hidden: false,
				elements: [],
			},
			onToggleMute: () => {},
			onToggleVisibility: () => {},
			order: { canMoveUp: false, canMoveDown: true, onMove: () => {} },
		}),
	);
	expect(html).toContain('aria-label="上移 Lyrics"');
	expect(html).toContain('aria-label="下移 Lyrics"');
	expect(html).toContain("置于前方");
	expect(html.match(/disabled=""/g)).toHaveLength(1);
});

test("locked lanes expose unlock or upgrade and disable reorder without disabling audio/visibility", () => {
	const supported = !!trackLockValidator();
	const html = renderToStaticMarkup(
		createElement(TimelineTrackLabel, {
			track: {
				id: "locked",
				name: "Locked",
				type: "video",
				hidden: false,
				muted: false,
				locked: true,
				elements: [],
			},
			onToggleLock: () => {},
			onToggleMute: () => {},
			onToggleVisibility: () => {},
			order: { canMoveUp: true, canMoveDown: true, onMove: () => {} },
		}),
	);
	expect(html).toContain('data-locked="true"');
	expect(html).toContain(
		supported ? 'aria-label="解锁 Locked"' : "轨道锁定需要升级 Rocut WASM",
	);
	expect(html.match(/disabled=""/g)).toHaveLength(supported ? 2 : 3);
	expect(html).toContain('aria-label="静音 Locked"');
	expect(html).toContain('aria-label="隐藏 Locked"');
});

function buttonAttributes({ html, label }: { html: string; label: string }) {
	const button = html
		.match(/<button\b[^>]*>/g)
		?.find((attributes) => attributes.includes(`aria-label="${label}"`));
	if (!button) throw new Error(`Missing track button: ${label}`);
	return button;
}

test("an older WASM exposes an unavailable lock button with explicit Chinese upgrade guidance", () => {
	const capability = spyOn(lockRuntime, "trackLockValidator").mockReturnValue(
		undefined,
	);
	try {
		const html = renderToStaticMarkup(
			createElement(TimelineTrackLabel, {
				track: {
					id: "fg",
					name: "前景",
					type: "video",
					hidden: false,
					muted: false,
					elements: [],
				},
				onToggleMute: () => {},
				onToggleVisibility: () => {},
				onToggleLock: () => {},
			}),
		);
		const lock = buttonAttributes({
			html,
			label: "轨道锁定需要升级 Rocut WASM",
		});
		expect(lock).toContain('disabled=""');
		expect(lock).toContain('aria-pressed="false"');
		expect(lock).toContain('title="轨道锁定需要升级 Rocut WASM"');
		expect(html).toContain('data-locked="false"');
		expect(buttonAttributes({ html, label: "静音 前景" })).not.toContain(
			'disabled=""',
		);
		expect(buttonAttributes({ html, label: "隐藏 前景" })).not.toContain(
			'disabled=""',
		);
	} finally {
		capability.mockRestore();
	}
});

test("lock-capable UI labels reflect the lock state and prevent both reorder directions", () => {
	// UI-only feature branch: native lock validation itself is covered by Rust tests.
	const capability = spyOn(lockRuntime, "trackLockValidator").mockReturnValue(
		(input) => input,
	);
	try {
		for (const locked of [false, true]) {
			const html = renderToStaticMarkup(
				createElement(TimelineTrackLabel, {
					track: {
						id: "fg",
						name: "前景",
						type: "video",
						hidden: false,
						muted: false,
						locked,
						elements: [],
					},
					onToggleMute: () => {},
					onToggleVisibility: () => {},
					onToggleLock: () => {},
					order: { canMoveUp: true, canMoveDown: true, onMove: () => {} },
				}),
			);
			const lock = buttonAttributes({
				html,
				label: `${locked ? "解锁" : "锁定"} 前景`,
			});
			expect(lock).not.toContain('disabled=""');
			expect(lock).toContain(`aria-pressed="${locked}"`);
			expect(html).toContain(`data-locked="${locked}"`);
			for (const label of ["上移 前景", "下移 前景"]) {
				const attributes = buttonAttributes({ html, label });
				expect(attributes.includes('disabled=""')).toBe(locked);
			}
			expect(buttonAttributes({ html, label: "静音 前景" })).not.toContain(
				'disabled=""',
			);
			expect(buttonAttributes({ html, label: "隐藏 前景" })).not.toContain(
				'disabled=""',
			);
		}
	} finally {
		capability.mockRestore();
	}
});
