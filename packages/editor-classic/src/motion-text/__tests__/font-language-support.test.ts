import { describe, expect, test } from "bun:test";
import {
	motionTextFontId,
	type MotionTextFontAssetRef,
} from "@opencut/editor-contracts";

import { assessMotionTextFontLanguage } from "../font-language-support";

const font: MotionTextFontAssetRef = {
	id: motionTextFontId("fixture"),
	source: "builtin",
	family: "Fixture Sans",
	style: "normal",
	weight: 700,
	supportedLanguages: ["ja", "en"],
};

describe("motion-text font language status", () => {
	test("matches the primary language across regional tags", () => {
		expect(
			assessMotionTextFontLanguage({ font, language: "en-US" }).status,
		).toBe("supported");
	});

	test("reports explicit gaps instead of assuming browser fallback fidelity", () => {
		expect(assessMotionTextFontLanguage({ font, language: "zh-Hans" })).toEqual(
			{
				status: "unsupported",
				language: "zh",
				supportedLanguages: ["ja", "en"],
			},
		);
	});

	test("keeps legacy and external font coverage unknown", () => {
		expect(
			assessMotionTextFontLanguage({
				font: { ...font, supportedLanguages: undefined },
				language: "ja",
			}).status,
		).toBe("unknown");
	});
});
