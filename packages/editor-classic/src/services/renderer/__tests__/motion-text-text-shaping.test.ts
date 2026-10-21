import { describe, expect, test } from "bun:test";

import {
	balancedWordLines,
	chunkText,
	isLatinText,
} from "../motion-text/core-layout-utils";
import {
	decorativeCopyKind,
	shouldHideDecorativeCopy,
} from "../motion-text/decorative-copy";

describe("balancedWordLines", () => {
	test("never breaks inside a word", () => {
		const words = ["never-ending", "story", "of", "the", "distant", "harbour"];
		const lines = balancedWordLines({ lineCount: 3, words });
		expect(lines.join(" ")).toBe(words.join(" "));
		for (const line of lines) {
			for (const word of line.split(" ")) {
				expect(words).toContain(word);
			}
		}
	});

	test("never produces more lines than words", () => {
		expect(
			balancedWordLines({ lineCount: 5, words: ["one", "two"] }),
		).toHaveLength(2);
	});

	test("balances by character count, not by word count", () => {
		// Three words each: even word distribution would put "I am a" against
		// "devastatingly long", which overflows. Character balance splits later.
		const lines = balancedWordLines({
			lineCount: 2,
			words: ["I", "am", "a", "devastatingly", "long", "word"],
		});
		expect(lines).toHaveLength(2);
		const [first, second] = lines;
		expect(first.length).toBeLessThan(second.length + 12);
		expect(lines.join(" ")).toBe("I am a devastatingly long word");
	});

	test("keeps a single word whole", () => {
		expect(balancedWordLines({ lineCount: 3, words: ["solitary"] })).toEqual([
			"solitary",
		]);
	});
});

describe("chunkText", () => {
	test("splits Latin text between words", () => {
		const chunks = chunkText({ count: 3, text: "ALPHA BETA GAMMA DELTA" });
		expect(chunks.join(" ")).toBe("ALPHA BETA GAMMA DELTA");
		for (const chunk of chunks) {
			for (const word of chunk.split(" ")) {
				expect(["ALPHA", "BETA", "GAMMA", "DELTA"]).toContain(word);
			}
		}
	});

	test("splits CJK text between glyphs", () => {
		const chunks = chunkText({ count: 2, text: "夜明けの色を" });
		expect(chunks.join("")).toBe("夜明けの色を");
		expect(chunks).toHaveLength(2);
	});
});

describe("isLatinText", () => {
	test("separates Latin lyrics from CJK", () => {
		expect(isLatinText("MIDNIGHT DRIVE")).toBe(true);
		expect(isLatinText("夜明けの色を")).toBe(false);
		expect(isLatinText("")).toBe(false);
	});
});

describe("decorativeCopyKind", () => {
	test("recognises index and time stamps", () => {
		expect(decorativeCopyKind("No.01")).toBe("index");
		expect(decorativeCopyKind("#03")).toBe("index");
		expect(decorativeCopyKind("128")).toBe("index");
		expect(decorativeCopyKind("00:12.34")).toBe("time");
		expect(decorativeCopyKind("REC 1:05")).toBe("time");
	});

	test("leaves ordinary copy alone", () => {
		expect(decorativeCopyKind("MIDNIGHT DRIVE")).toBeNull();
		expect(decorativeCopyKind("24 HOURS OF LIGHT")).toBeNull();
		// CJK text is content even when it contains digits.
		expect(decorativeCopyKind("第12話")).toBeNull();
	});
});

describe("shouldHideDecorativeCopy", () => {
	test("does nothing unless the project asks for it", () => {
		expect(
			shouldHideDecorativeCopy({
				hideIndex: false,
				hideTime: false,
				lyric: "MIDNIGHT DRIVE",
				text: "No.01",
			}),
		).toBe(false);
	});

	test("hides only the requested kind", () => {
		expect(
			shouldHideDecorativeCopy({
				hideIndex: true,
				hideTime: false,
				lyric: "MIDNIGHT DRIVE",
				text: "No.01",
			}),
		).toBe(true);
		expect(
			shouldHideDecorativeCopy({
				hideIndex: true,
				hideTime: false,
				lyric: "MIDNIGHT DRIVE",
				text: "00:12.34",
			}),
		).toBe(false);
		expect(
			shouldHideDecorativeCopy({
				hideIndex: false,
				hideTime: true,
				lyric: "MIDNIGHT DRIVE",
				text: "00:12.34",
			}),
		).toBe(true);
	});

	test("keeps a stamp that reproduces the lyric", () => {
		expect(
			shouldHideDecorativeCopy({
				hideIndex: true,
				hideTime: true,
				lyric: "MEET ME AT 00:12",
				text: "00:12",
			}),
		).toBe(false);
	});
});
