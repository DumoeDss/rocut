import { expect, mock, test } from "bun:test";
import { readMediaCropParams, resolveMediaCrop } from "../media-crop";

const crop = { left: 0.25, top: 0, right: 0.75, bottom: 1 };
const geometry = {
	sourceX: 250,
	sourceY: 0,
	sourceWidth: 500,
	sourceHeight: 500,
	width: 500,
	height: 500,
};

test("transports static bounds and dimensions to native geometry without computing a second formula", () => {
	const core = mock((input: string) => {
		expect(JSON.parse(input)).toEqual({
			version: 1,
			sourceWidth: 1000,
			sourceHeight: 500,
			crop,
		});
		return JSON.stringify({ version: 1, geometry });
	});
	expect(
		resolveMediaCrop({ crop, sourceWidth: 1000, sourceHeight: 500, core }),
	).toEqual(geometry);
	expect(core).toHaveBeenCalledTimes(1);
});

test("full-source defaults need no new native capability and malformed values are not defaulted", () => {
	const core = mock(() => {
		throw new Error("must not run");
	});
	expect(
		resolveMediaCrop({
			crop: readMediaCropParams({ params: {} }),
			sourceWidth: 1000,
			sourceHeight: 500,
			core,
		}),
	).toBeUndefined();
	expect(core).not.toHaveBeenCalled();
	expect(
		readMediaCropParams({ params: { "crop.left": null } }).left,
	).toBeNull();
});

test("rejects native admission errors and malformed geometry responses", () => {
	for (const output of [
		{ version: 1, error: { path: "crop", message: "invalid" } },
		{ version: 2, geometry },
		{ version: 1, geometry: { ...geometry, sourceX: "0" } },
	]) {
		expect(() =>
			resolveMediaCrop({
				crop,
				sourceWidth: 1000,
				sourceHeight: 500,
				core: () => JSON.stringify(output),
			}),
		).toThrow();
	}
});
