/**
 * Decorative copy that carries no lyric meaning: an index ("No.01", "#03", "128")
 * or a running time ("00:12.34", "REC 1:05"). Some layouts stamp these; when a
 * project asks for them to be dropped they should disappear, while any number
 * that is really part of the lyric stays.
 */

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;

const TIME_SHAPE = /^[A-Za-z]{0,4}[\s.#]*[\d:：.;'"\s/+\-–—]+[A-Za-z]{0,3}$/u;
const TIME_HAS_CLOCK = /\d{1,2}[:：]\d{2}/u;
const INDEX_SHAPE = /^[A-Za-z#№.\s\d/+\-–—×x%,:'°]+$/u;

export type DecorativeCopyKind = "index" | "time";

/**
 * Classifies `text` as decorative copy, or `null` when it is ordinary content.
 * Anything containing CJK is treated as content: a lyric line such as "第12話"
 * must never be mistaken for a stamp.
 */
export function decorativeCopyKind(text: string): DecorativeCopyKind | null {
	const trimmed = text.trim();
	if (trimmed.length === 0 || !/\d/u.test(trimmed) || CJK.test(trimmed)) {
		return null;
	}
	if (TIME_HAS_CLOCK.test(trimmed) && TIME_SHAPE.test(trimmed)) return "time";
	const letters = (trimmed.match(/[A-Za-z]/gu) ?? []).length;
	if (letters <= 5 && INDEX_SHAPE.test(trimmed)) return "index";
	return null;
}

/**
 * Whether `text` should be skipped because the project hides stamps of its kind.
 * The lyric always wins: a stamp that reproduces lyric text is kept.
 */
export function shouldHideDecorativeCopy({
	text,
	lyric,
	hideIndex,
	hideTime,
}: {
	readonly text: string;
	readonly lyric: string | null;
	readonly hideIndex: boolean;
	readonly hideTime: boolean;
}): boolean {
	if (!hideIndex && !hideTime) return false;
	const kind = decorativeCopyKind(text);
	if (kind === null) return false;
	if (kind === "index" ? !hideIndex : !hideTime) return false;
	return !(lyric ?? "").includes(text.trim());
}
