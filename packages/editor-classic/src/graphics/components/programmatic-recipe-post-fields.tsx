import { RecipeParameterFields } from "./programmatic-recipe-parameter-fields";
import { recipeParameterSchemaKnown } from "./programmatic-recipe-parameter-schema";
import { ProgrammaticRecipePostAutomationFields } from "./programmatic-recipe-post-automation-fields";
import { postCurvesFit } from "./programmatic-recipe-post-automation-data";
import {
	editPostDraft,
	postDraft,
	postEffectFits,
	postEffectParameters,
	postKnownEffectsFit,
	postObject,
	postParameterRule,
	type PostRecord,
} from "./programmatic-recipe-post-data";

export function ProgrammaticRecipePostFields({
	id,
	text,
	durationFrames,
	finishing,
	disabled,
	onEdit,
}: {
	id: string;
	text: string;
	durationFrames: number;
	finishing: PostRecord;
	disabled: boolean;
	onEdit: (text: string) => void;
}) {
	const recipe = postDraft(text);
	const finishingEffects = postObject(finishing.effects) ?? {};
	const automation = postObject(finishing.automation) ?? {};
	if (!recipe || !Number.isSafeInteger(durationFrames) || durationFrames < 1)
		return null;
	return (
		<>
			{(recipe.post as PostRecord[]).map((post, postIndex) => {
				const effects = post.effects as PostRecord[],
					duration = durationFrames;
				const curvesValid = postCurvesFit(
					Object.hasOwn(post, "automation") ? post.automation : [],
					effects,
					duration,
					finishingEffects,
					automation,
				);
				const edit = (next: PostRecord) => {
					if (!postKnownEffectsFit(effects, finishingEffects)) return;
					const result = editPostDraft(text, postIndex, next, disabled);
					if (result) onEdit(result);
				};
				return (
					<fieldset
						key={postIndex}
						disabled={disabled}
						className="flex min-w-0 flex-col gap-2 rounded border p-2"
					>
						<legend className="px-1 text-xs">
							Post {postIndex} / {String(post.stage ?? "role")}
						</legend>
						{effects.map((effect, effectIndex) => {
							const parameters = postEffectParameters(effect, finishingEffects);
							if (!parameters)
								return (
									<p
										key={effectIndex}
										className="text-muted-foreground text-xs"
									>
										Effect {effectIndex} / {String(effect.kind)}: edit
										unsupported parameters in JSON.
									</p>
								);
							const catalog = Object.fromEntries(
								Object.entries(parameters).flatMap(([key, value]) => {
									const rule = postParameterRule(value);
									return rule && recipeParameterSchemaKnown({ rule })
										? [[key, rule]]
										: [];
								}),
							);
							const editable =
								Object.keys(catalog).length ===
									Object.keys(parameters).length &&
								postEffectFits(effect, parameters) &&
								postKnownEffectsFit(effects, finishingEffects) &&
								curvesValid;
							return (
								<fieldset
									key={effectIndex}
									disabled={disabled || !editable}
									className="flex min-w-0 flex-col gap-2 rounded border p-2"
								>
									<legend className="px-1 text-xs">
										Effect {effectIndex} / {String(effect.kind)}
									</legend>
									{RecipeParameterFields({
										id: `${id}-post-${postIndex}-effect-${effectIndex}`,
										value: effect,
										catalog,
										disabled: disabled || !editable,
										onChange: (next) => {
											if (!editable || !postEffectFits(next, parameters))
												return;
											edit({
												...post,
												effects: effects.map((old, index) =>
													index === effectIndex ? next : old,
												),
											});
										},
									})}
									{!editable && (
										<p className="text-muted-foreground text-xs">
											Repair invalid parameters or curves in JSON before
											structured editing.
										</p>
									)}
								</fieldset>
							);
						})}
						{ProgrammaticRecipePostAutomationFields({
							id: `${id}-post-${postIndex}-automation`,
							post,
							durationFrames: duration,
							finishingEffects,
							automation,
							disabled:
								disabled || !postKnownEffectsFit(effects, finishingEffects),
							onChange: edit,
						})}
					</fieldset>
				);
			})}
		</>
	);
}
