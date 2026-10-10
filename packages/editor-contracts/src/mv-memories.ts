/** Authored controls only. Pixels, measured fonts and native dimensions are owner facts. */
export type MvMemoriesPhoto = {
	bg: string;
	caption?: string;
	date?: string;
	view?: { x?: number; y?: number; zoom?: number };
	char?: boolean | string;
};

export type MvMemories = {
	photos: readonly MvMemoriesPhoto[];
	char?: string;
	charIn?: number;
	order?: readonly number[];
	dropBeats?: readonly number[];
	burnBeats?: readonly number[];
	pushAt?: number;
	endZoom?: number;
	seed?: number;
	captionFont: string;
	dateFont: string;
};
