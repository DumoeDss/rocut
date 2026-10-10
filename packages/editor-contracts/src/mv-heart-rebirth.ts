/** Authoring only. Character/native dimensions and retained sessions are owner facts. */
export type MvHeartGather = {
	mode: "gather";
	heart: string;
	char: string;
	bg?: string;
	firefly?: boolean;
	n?: number;
	charH?: number;
	charX?: number;
	charY?: number;
	target?: readonly [number, number];
};

export type MvHeartSun = {
	mode: "sun";
	heart: string;
	char: string;
	fuseAt?: number;
	fuseBeat?: number;
	sunX?: number;
	sunY?: number;
	sunR?: number;
	charH?: number;
	charX?: number;
	charY?: number;
};

export type MvSkyShatter = {
	bg: string;
	char: string;
	night?: string;
	seed?: number;
	impact?: readonly [number, number];
	releaseBeat?: number;
	bands?: number;
	charX?: number;
	charH?: number;
};
