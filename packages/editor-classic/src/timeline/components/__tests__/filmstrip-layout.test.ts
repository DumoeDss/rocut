import { describe, expect, test } from "bun:test";
import { getVisibleFilmstripTiles } from "../filmstrip-layout";

describe("filmstrip visible geometry", () => {
	test("scrolling keeps source tile offsets rather than restarting from the poster", () => {
		expect(
			getVisibleFilmstripTiles({
				clipLeft: -250,
				clipWidth: 1000,
				viewportLeft: 0,
				viewportRight: 200,
				tileWidth: 100,
			}),
		).toEqual([200, 300, 400]);
	});
	test("offscreen clips schedule no frames", () => {
		expect(
			getVisibleFilmstripTiles({
				clipLeft: 600,
				clipWidth: 1000,
				viewportLeft: 0,
				viewportRight: 500,
				tileWidth: 100,
			}),
		).toEqual([]);
		expect(
			getVisibleFilmstripTiles({
				clipLeft: -1600,
				clipWidth: 1000,
				viewportLeft: 0,
				viewportRight: 500,
				tileWidth: 100,
			}),
		).toEqual([]);
	});
	test("zoomed and partial final tiles stay within the clip and bound work", () => {
		expect(
			getVisibleFilmstripTiles({
				clipLeft: -50,
				clipWidth: 220,
				viewportLeft: 0,
				viewportRight: 300,
				tileWidth: 80,
			}),
		).toEqual([0, 80, 160]);
		expect(
			getVisibleFilmstripTiles({
				clipLeft: 0,
				clipWidth: 1000000,
				viewportLeft: 0,
				viewportRight: 1000000,
				tileWidth: 1,
			}),
		).toHaveLength(64);
	});
});
