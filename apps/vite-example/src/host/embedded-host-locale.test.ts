import { describe, expect, test } from "bun:test";
import { subscribeEmbeddedHostLocale } from "./embedded-host-locale";

function fixture() {
	const handlers = new Set<
		(event: { source: unknown; origin: string; data: unknown }) => void
	>();
	const sent: { data: Record<string, unknown>; origin: string }[] = [];
	const parent = {
		postMessage(...[data, origin]: [unknown, string]) {
			if (!data || typeof data !== "object")
				throw new Error("Invalid discovery");
			sent.push({ data: { ...data }, origin });
		},
	};
	const target = {
		parent,
		addEventListener(
			...[_type, handler]: [
				string,
				(event: { source: unknown; origin: string; data: unknown }) => void,
			]
		) {
			handlers.add(handler);
		},
		removeEventListener(
			...[_type, handler]: [
				string,
				(event: { source: unknown; origin: string; data: unknown }) => void,
			]
		) {
			handlers.delete(handler);
		},
	};
	const locales: string[] = [];
	const dispose = subscribeEmbeddedHostLocale({
		target,
		onLocale: (locale) => locales.push(locale),
	});
	const emit = ({
		data,
		origin = "https://host.example",
		source = parent,
	}: {
		data: object;
		origin?: string;
		source?: unknown;
	}) => {
		for (const handler of handlers) handler({ data, origin, source });
	};
	const change = ({
		locale,
		origin,
		source,
		requestId = sent[0].data.requestId,
	}: {
		locale: unknown;
		origin?: string;
		source?: unknown;
		requestId?: unknown;
	}) =>
		emit({
			data: {
				type: "elftia:tool-host-locale-changed",
				version: 1,
				requestId,
				locale,
			},
			origin,
			source,
		});
	return { sent, emit, change, locales, dispose, handlers };
}

describe("embedded host locale", () => {
	test("initial discovery and live preferences are pinned to the parent and correlation id", () => {
		const f = fixture();
		f.change({ locale: "zh", source: {} });
		f.change({ locale: "zh", origin: "null" });
		f.change({ locale: "zh", requestId: "wrong" });
		f.change({ locale: "not a locale" });
		expect(f.locales).toEqual([]);
		f.change({ locale: "en" });
		f.change({ locale: "zh-CN", origin: "https://evil.example" });
		f.change({ locale: "zh-CN" });
		expect(f.locales).toEqual(["en", "zh-CN"]);
		f.dispose();
		f.change({ locale: "ja" });
		expect(f.handlers.size).toBe(0);
		expect(f.locales).toEqual(["en", "zh-CN"]);
	});

	test("load-time rediscovery recovers when the host retires the previous registration", () => {
		const f = fixture();
		f.change({ locale: "en" });
		f.emit({ data: { type: "elftia:tool-host-locale-request", version: 1 } });
		expect(f.sent[1]).toEqual({
			data: f.sent[0].data,
			origin: "https://host.example",
		});
		f.change({ locale: "zh" });
		expect(f.locales).toEqual(["en", "zh"]);
		f.dispose();
	});

	test("old hosts leave the configured fallback untouched and independent panes cannot cross-update", () => {
		const a = fixture();
		const b = fixture();
		expect(a.locales).toEqual([]);
		b.change({ locale: "en", requestId: a.sent[0].data.requestId });
		expect(b.locales).toEqual([]);
		a.change({ locale: "en" });
		b.change({ locale: "zh" });
		expect(a.locales).toEqual(["en"]);
		expect(b.locales).toEqual(["zh"]);
		a.dispose();
		b.dispose();
	});
});
