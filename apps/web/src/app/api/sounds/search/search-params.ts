import { z } from "zod";

const searchParamsSchema = z.object({
	q: z.string().max(500, "Query too long").optional(),
	type: z.enum(["songs", "effects"]).optional(),
	page: z.coerce.number().int().min(1).max(1000).default(1),
	page_size: z.coerce.number().int().min(1).max(150).default(20),
	sort: z
		.enum(["downloads", "rating", "created", "score"])
		.default("downloads"),
	min_rating: z.coerce.number().min(0).max(5).default(3),
	// Boolean("false") is true. Decode the URL spelling, not its truthiness.
	commercial_only: z
		.enum(["true", "false"])
		.default("true")
		.transform((value) => value === "true"),
});

export function parseSoundSearchParameters(params: URLSearchParams) {
	return searchParamsSchema.safeParse({
		q: params.get("q") || undefined,
		type: params.get("type") || undefined,
		page: params.get("page") || undefined,
		page_size: params.get("page_size") || undefined,
		sort: params.get("sort") || undefined,
		min_rating: params.get("min_rating") || undefined,
		commercial_only: params.get("commercial_only") ?? undefined,
	});
}
