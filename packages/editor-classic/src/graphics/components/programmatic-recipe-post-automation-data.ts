import {
	postEffectParameters,
	postKnownEffectsFit,
	postObject,
	postParameterRule,
	type PostRecord,
} from "./programmatic-recipe-post-data";

export function postAmountDomain(
	effect: PostRecord,
	finishing: PostRecord,
	automation: PostRecord,
): { min: number; max: number } | undefined {
	if (
		automation.targetParameter !== "amount" ||
		typeof effect.kind !== "string" ||
		!Array.isArray(automation.targetEffects) ||
		!automation.targetEffects.every((kind) => typeof kind === "string") ||
		!automation.targetEffects.includes(effect.kind)
	)
		return undefined;
	const rule = postParameterRule(
		postEffectParameters(effect, finishing)?.amount,
	);
	if (
		!rule ||
		rule.type !== "number" ||
		typeof rule.min !== "number" ||
		typeof rule.max !== "number" ||
		!Number.isFinite(rule.min) ||
		!Number.isFinite(rule.max) ||
		rule.min > rule.max
	)
		return undefined;
	return { min: rule.min, max: rule.max };
}

export function postAutomationCatalog(
	catalog: PostRecord,
): { maxCurves: number; maxKeyframes: number; easings: string[] } | undefined {
	if (
		catalog.version !== 1 ||
		!Number.isSafeInteger(catalog.maxCurves) ||
		Number(catalog.maxCurves) < 1 ||
		!Number.isSafeInteger(catalog.maxKeyframes) ||
		Number(catalog.maxKeyframes) < 1 ||
		!Array.isArray(catalog.easings) ||
		!catalog.easings.length ||
		!catalog.easings.every((value) => typeof value === "string")
	)
		return undefined;
	return {
		maxCurves: Number(catalog.maxCurves),
		maxKeyframes: Number(catalog.maxKeyframes),
		easings: catalog.easings as string[],
	};
}

export function postCurvesFit(
	curves: unknown,
	effects: PostRecord[],
	duration: number,
	finishing: PostRecord,
	catalog: PostRecord,
): boolean {
	const rules = postAutomationCatalog(catalog);
	if (
		!rules ||
		!Array.isArray(curves) ||
		curves.length > rules.maxCurves ||
		curves.length > effects.length ||
		!Number.isSafeInteger(duration) ||
		duration < 1
	)
		return false;
	const seen = new Set<number>();
	return curves.every((value) => {
		const curve = postObject(value),
			index = curve?.effect;
		if (
			!curve ||
			typeof index !== "number" ||
			!Number.isSafeInteger(index) ||
			index < 0 ||
			index >= effects.length ||
			seen.has(index)
		)
			return false;
		seen.add(index);
		const domain = postAmountDomain(effects[index]!, finishing, catalog),
			keys = curve.keyframes;
		if (
			!domain ||
			!Array.isArray(keys) ||
			!keys.length ||
			keys.length > rules.maxKeyframes
		)
			return false;
		let previous = -1;
		return keys.every((value) => {
			const key = postObject(value);
			if (
				!key ||
				typeof key.frame !== "number" ||
				!Number.isSafeInteger(key.frame) ||
				key.frame <= previous ||
				key.frame > duration ||
				typeof key.value !== "number" ||
				!Number.isFinite(key.value) ||
				key.value < domain.min ||
				key.value > domain.max ||
				typeof key.easing !== "string" ||
				!rules.easings.includes(key.easing)
			)
				return false;
			previous = key.frame;
			return true;
		});
	});
}

/** All edits preserve authored order and extras. No sorting, clock mapping or synthesis. */
export function changePostCurves(
	post: PostRecord,
	curves: unknown[],
	duration: number,
	finishing: PostRecord,
	catalog: PostRecord,
	disabled: boolean,
): PostRecord | undefined {
	const effects = post.effects;
	if (
		disabled ||
		!Array.isArray(effects) ||
		!effects.every((value) => !!postObject(value)) ||
		!postKnownEffectsFit(effects as PostRecord[], finishing) ||
		!postCurvesFit(
			Object.hasOwn(post, "automation") ? post.automation : [],
			effects as PostRecord[],
			duration,
			finishing,
			catalog,
		) ||
		!postCurvesFit(
			curves,
			effects as PostRecord[],
			duration,
			finishing,
			catalog,
		)
	)
		return undefined;
	return { ...post, automation: curves };
}
