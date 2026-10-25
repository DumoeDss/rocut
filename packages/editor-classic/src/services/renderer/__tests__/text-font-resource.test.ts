import { expect, test } from "bun:test";
import { pinnedTextFont } from "../nodes/text-font-resource";

test("pinned text adapter transports descriptor and selected family to Rust", () => {
	const font = {
		id: "font",
		source: "project",
		assetId: "attachment",
		family: "Fixture",
	};
	let input: unknown;
	expect(
		pinnedTextFont(
			"descriptor",
			(value) => {
				input = JSON.parse(value);
				return JSON.stringify({ version: 1, font });
			},
			"Fixture",
		),
	).toEqual(font);
	expect(input).toEqual({ version: 1, value: "descriptor", family: "Fixture" });
});

test("unbound text needs no runtime and admission errors stay visible", () => {
	const unavailable = () => {
		throw Error("must not call");
	};
	expect(pinnedTextFont(undefined, unavailable)).toBeUndefined();
	expect(pinnedTextFont("", unavailable)).toBeUndefined();
	expect(() =>
		pinnedTextFont("descriptor", () =>
			JSON.stringify({
				version: 1,
				error: "Invalid pinned text font resource",
			}),
		),
	).toThrow("Invalid pinned text font resource");
	expect(() =>
		pinnedTextFont("descriptor", () => JSON.stringify({ version: 2 })),
	).toThrow("Invalid native text font response");
});
