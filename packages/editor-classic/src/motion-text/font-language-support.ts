import type {
	MotionTextFontAssetRef,
	MotionTextSequence,
} from "@opencut/editor-contracts";

export type MotionTextFontLanguageStatus =
	| "supported"
	| "unsupported"
	| "unknown";

export interface MotionTextFontLanguageAssessment {
	readonly status: MotionTextFontLanguageStatus;
	readonly language: string;
	readonly supportedLanguages: readonly string[];
}

function primaryLanguage(value: string): string {
	return value.trim().split(/[-_]/u)[0]?.toLocaleLowerCase() ?? "";
}

export function assessMotionTextFontLanguage({
	font,
	language,
}: {
	readonly font: MotionTextFontAssetRef | undefined;
	readonly language: string;
}): MotionTextFontLanguageAssessment {
	const normalizedLanguage = primaryLanguage(language);
	const supportedLanguages = font?.supportedLanguages ?? [];
	if (!font || supportedLanguages.length === 0) {
		return {
			status: "unknown",
			language: normalizedLanguage,
			supportedLanguages,
		};
	}
	return {
		status: supportedLanguages.some(
			(candidate) => primaryLanguage(candidate) === normalizedLanguage,
		)
			? "supported"
			: "unsupported",
		language: normalizedLanguage,
		supportedLanguages,
	};
}

export function resolveMotionTextFontLanguageAssessment({
	sequence,
	fontId,
}: {
	readonly sequence: MotionTextSequence;
	readonly fontId: string;
}): MotionTextFontLanguageAssessment {
	const resolvedFontId =
		fontId === "" || fontId === "inherit" ? sequence.defaults.fontId : fontId;
	return assessMotionTextFontLanguage({
		font: sequence.fonts.find((font) => font.id === resolvedFontId),
		language: sequence.language,
	});
}
