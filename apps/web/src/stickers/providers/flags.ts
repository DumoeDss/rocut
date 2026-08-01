import { buildStickerId, parseStickerId } from "../sticker-id";
import type {
	StickerBrowseResult,
	StickerItem,
	StickerProvider,
	StickerSearchResult,
} from "../types";
import { REGIONS, REGION_GROUPS } from "./countries-data";
import type { CountryRecord, RegionId } from "./countries-data";
import type { AssetResolver } from "@/editor/ports";

const FLAGS_PROVIDER_ID = "flags";
const DEFAULT_SEARCH_LIMIT = 100;

let countriesPromise: Promise<CountryRecord[]> | null = null;

export function buildFlagUrl({
	code,
	assets,
}: {
	code: string;
	assets?: AssetResolver;
}): string {
	const normalizedCode = code.toLowerCase();
	const path = `flags/${encodeURIComponent(normalizedCode)}.svg`;
	return assets ? assets.resolve({ ref: { path } }) : path;
}

async function loadCountries(): Promise<CountryRecord[]> {
	if (countriesPromise) {
		return countriesPromise;
	}

	countriesPromise = import("./countries-data")
		.then((m) => m.COUNTRIES)
		.catch((error) => {
			console.error("Failed to load countries dataset:", error);
			return [];
		});

	return countriesPromise;
}

function toStickerItem({
	country,
	assets,
}: {
	country: CountryRecord;
	assets?: AssetResolver;
}): StickerItem {
	const normalizedCode = country.code.toUpperCase();
	return {
		id: buildStickerId({
			providerId: FLAGS_PROVIDER_ID,
			providerValue: normalizedCode,
		}),
		provider: FLAGS_PROVIDER_ID,
		name: country.name,
		previewUrl: buildFlagUrl({ code: normalizedCode, assets }),
		metadata: {
			code: normalizedCode,
			region: country.region ?? null,
			languages: country.languages ?? [],
			flagColors: country.flag_colors ?? [],
		},
	};
}

function normalizeQuery({ query }: { query: string }): string {
	return query.trim().toLowerCase();
}

function findMatchingRegions({
	query,
}: {
	query: string;
}): (typeof REGIONS)[number][] {
	return REGIONS.filter(
		(r) =>
			r.id.toLowerCase() === query ||
			r.aliases.some((alias) => alias === query),
	);
}

export function resolveQueryToRegions({
	query,
}: {
	query: string;
}): Set<RegionId> | null {
	const group = REGION_GROUPS[query];
	if (group) {
		return new Set(group);
	}

	const matched = findMatchingRegions({ query });
	return matched.length > 0 ? new Set(matched.map((r) => r.id)) : null;
}

export function getRegionLabel({ query }: { query: string }): string {
	if (REGION_GROUPS[query]) {
		return query
			.split(" ")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" ");
	}

	const matched = findMatchingRegions({ query });
	return matched[0]?.id ?? query;
}

function filterCountriesByQuery({
	countries,
	query,
}: {
	countries: CountryRecord[];
	query: string;
}): CountryRecord[] {
	if (!query) {
		return countries;
	}

	const regionIds = resolveQueryToRegions({ query });

	if (regionIds) {
		return countries.filter((country) => country.region && regionIds.has(country.region));
	}

	return countries.filter((country) => {
		const normalizedName = country.name.toLowerCase();
		const normalizedCode = country.code.toLowerCase();
		return normalizedName.includes(query) || normalizedCode.includes(query);
	});
}

function paginateCountries({
	countries,
	options,
}: {
	countries: CountryRecord[];
	options?: { page?: number; limit?: number };
}): { items: CountryRecord[]; hasMore: boolean; total: number } {
	if (options?.limit === undefined) {
		return { items: countries, hasMore: false, total: countries.length };
	}
	const page = Math.max(1, options.page ?? 1);
	const limit = Math.max(1, options.limit);
	const startIndex = (page - 1) * limit;
	const endIndex = startIndex + limit;
	return {
		items: countries.slice(startIndex, endIndex),
		hasMore: endIndex < countries.length,
		total: countries.length,
	};
}

export const flagsProvider: StickerProvider = {
	id: FLAGS_PROVIDER_ID,
	async search({
		query,
		options,
		assets,
	}: {
		query: string;
		options?: { limit?: number };
		assets?: AssetResolver;
	}): Promise<StickerSearchResult> {
		const countries = await loadCountries();
		const normalizedQuery = normalizeQuery({ query });
		const filteredCountries = filterCountriesByQuery({
			countries,
			query: normalizedQuery,
		});
		const paged = paginateCountries({
			countries: filteredCountries,
			options: {
				page: 1,
				limit: options?.limit ?? DEFAULT_SEARCH_LIMIT,
			},
		});
		return {
			items: paged.items.map((country) => toStickerItem({ country, assets })),
			total: paged.total,
			hasMore: paged.hasMore,
		};
	},
	async browse({
		options,
		assets,
	}: {
		options?: { page?: number; limit?: number };
		assets?: AssetResolver;
	}): Promise<StickerBrowseResult> {
		const countries = await loadCountries();
		const paged = paginateCountries({ countries, options });
		return {
			sections: [
				{
					id: "all",
					items: paged.items.map((country) => toStickerItem({ country, assets })),
					hasMore: paged.hasMore,
					layout: "grid",
				},
			],
		};
	},
	resolveUrl({
		stickerId,
		assets,
	}: {
		stickerId: string;
		options?: { width?: number; height?: number };
		assets?: AssetResolver;
	}): string {
		const { providerValue } = parseStickerId({ stickerId });
		return buildFlagUrl({ code: providerValue, assets });
	},
};
