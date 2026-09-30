import { drawHorrorFoundFootageLayout } from "./horror-found-footage-layouts";
import { drawHorrorUncannyLayout } from "./horror-uncanny-layouts";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawHorrorLayout(options: TypographyLayoutOptions): boolean {
	return (
		drawHorrorFoundFootageLayout(options) || drawHorrorUncannyLayout(options)
	);
}
