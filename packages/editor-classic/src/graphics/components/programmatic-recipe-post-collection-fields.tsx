import { useState } from "react";
import { Button } from "../../components/ui/button";
import { ProgrammaticRecipePostCreateFields } from "./programmatic-recipe-post-create-fields";
import {
	editPostCollection,
	newPostGroup,
	postCollectionDraft,
	postRoleChoices,
	remapPostEffects,
} from "./programmatic-recipe-post-collection-data";
import { postObject, type PostRecord } from "./programmatic-recipe-post-data";

export function ProgrammaticRecipePostCollectionFields({
	id,
	text,
	finishing,
	postStages,
	sceneParameters,
	disabled,
	onEdit,
}: {
	id: string;
	text: string;
	finishing: PostRecord;
	postStages: PostRecord;
	sceneParameters: PostRecord;
	disabled: boolean;
	onEdit: (text: string) => void;
}) {
	const [stage, setStage] = useState("");
	const [roles, setRoles] = useState<string[]>([]);
	const recipe = postCollectionDraft(text);
	if (!recipe) return null;
	const posts = recipe.post as PostRecord[];
	const effects = postObject(finishing.effects) ?? {};
	const supported = Array.isArray(postStages.supported)
		? postStages.supported.filter(
				(value): value is string => value === "role" || value === "composite",
			)
		: [];
	const roleChoices = postRoleChoices(sceneParameters);
	const change = (next: PostRecord[]) => {
		const result = editPostCollection(text, next, disabled);
		if (!result) return false;
		onEdit(result);
		return true;
	};
	const movePost = (index: number, offset: number) => {
		const to = index + offset;
		if (disabled || to < 0 || to >= posts.length) return;
		const next = [...posts];
		[next[index], next[to]] = [next[to]!, next[index]!];
		change(next);
	};
	const changeEffects = (postIndex: number, order: number[]) => {
		const next = remapPostEffects(posts[postIndex]!, order, disabled);
		if (next)
			change(posts.map((post, index) => (index === postIndex ? next : post)));
	};
	return (
		<fieldset
			disabled={disabled}
			className="flex min-w-0 flex-col gap-2 rounded border p-2"
		>
			<legend className="px-1 text-xs">Post groups and effect order</legend>
			<p className="text-muted-foreground text-xs">
				Effects run in authored order. Moving a group preserves its stage; role
				groups run before composite groups. Removing an effect also removes its
				amount curve and audio binding.
			</p>
			{posts.map((post, postIndex) => {
				const current = post.effects as PostRecord[];
				return (
					<fieldset
						key={postIndex}
						disabled={disabled}
						className="flex flex-col gap-2 rounded border p-2"
					>
						<legend className="px-1 text-xs">
							Post {postIndex} /{" "}
							{String(post.stage ?? postStages.default ?? "role")}
						</legend>
						<div className="flex flex-wrap gap-1">
							<Button
								size="sm"
								variant="ghost"
								aria-label={`Move post ${postIndex} up`}
								disabled={disabled || postIndex === 0}
								onClick={() => movePost(postIndex, -1)}
							>
								Move up
							</Button>
							<Button
								size="sm"
								variant="ghost"
								aria-label={`Move post ${postIndex} down`}
								disabled={disabled || postIndex === posts.length - 1}
								onClick={() => movePost(postIndex, 1)}
							>
								Move down
							</Button>
							<Button
								size="sm"
								variant="ghost"
								aria-label={`Remove post ${postIndex}`}
								disabled={disabled}
								onClick={() => {
									if (!disabled)
										change(posts.filter((_, index) => index !== postIndex));
								}}
							>
								Remove group
							</Button>
						</div>
						{current.map((effect, effectIndex) => {
							const order = current.map((_, index) => index);
							const move = (offset: number) => {
								const to = effectIndex + offset;
								if (disabled || to < 0 || to >= order.length) return;
								[order[effectIndex], order[to]] = [
									order[to]!,
									order[effectIndex]!,
								];
								changeEffects(postIndex, order);
							};
							const validOrder = !!remapPostEffects(post, order, false);
							return (
								<div key={effectIndex} className="flex flex-col gap-1 text-xs">
									<span>
										Effect {effectIndex} / {String(effect.kind)}
									</span>
									<div className="flex flex-wrap gap-1">
										<Button
											size="sm"
											variant="ghost"
											aria-label={`Move post ${postIndex} effect ${effectIndex} up`}
											disabled={disabled || !validOrder || effectIndex === 0}
											onClick={() => move(-1)}
										>
											Move up
										</Button>
										<Button
											size="sm"
											variant="ghost"
											aria-label={`Move post ${postIndex} effect ${effectIndex} down`}
											disabled={
												disabled ||
												!validOrder ||
												effectIndex === current.length - 1
											}
											onClick={() => move(1)}
										>
											Move down
										</Button>
										<Button
											size="sm"
											variant="ghost"
											aria-label={`Remove post ${postIndex} effect ${effectIndex} and bindings`}
											disabled={disabled || !validOrder || current.length === 1}
											onClick={() =>
												changeEffects(
													postIndex,
													order.filter((index) => index !== effectIndex),
												)
											}
										>
											Remove effect and bindings
										</Button>
									</div>
								</div>
							);
						})}
						{current.length === 1 && (
							<p className="text-muted-foreground text-xs">
								Remove the group to remove its last effect.
							</p>
						)}
						<ProgrammaticRecipePostCreateFields
							id={`${id}-post-${postIndex}-new`}
							label={`effect for post ${postIndex}`}
							effects={effects}
							disabled={disabled}
							onAdd={(effect) =>
								change(
									posts.map((entry, index) =>
										index === postIndex
											? { ...entry, effects: [...current, effect] }
											: entry,
									),
								)
							}
						/>
					</fieldset>
				);
			})}
			{!!supported.length && (
				<fieldset
					disabled={disabled}
					className="flex flex-col gap-2 rounded border p-2"
				>
					<legend className="px-1 text-xs">New post group</legend>
					<label htmlFor={`${id}-new-stage`} className="text-xs">
						Stage
					</label>
					<select
						id={`${id}-new-stage`}
						aria-label="New post group stage"
						value={stage}
						disabled={disabled}
						className="bg-input rounded border p-1 text-xs"
						onChange={(event) => {
							if (!disabled) setStage(event.target.value);
						}}
					>
						<option value="">Choose stage</option>
						{supported.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
					{stage === "role" && (
						<div className="flex flex-wrap gap-2">
							{roleChoices.map((role) => (
								<label key={role} className="flex items-center gap-1 text-xs">
									<input
										type="checkbox"
										aria-label={`New post group role ${role}`}
										disabled={disabled}
										checked={roles.includes(role)}
										onChange={(event) => {
											if (!disabled)
												setRoles(
													event.target.checked
														? [...roles, role]
														: roles.filter((value) => value !== role),
												);
										}}
									/>
									{role}
								</label>
							))}
						</div>
					)}
					<ProgrammaticRecipePostCreateFields
						id={`${id}-new-group-effect`}
						label="initial effect for new post group"
						effects={effects}
						disabled={disabled || !stage || (stage === "role" && !roles.length)}
						onAdd={(effect) => {
							const group = newPostGroup({
								stage,
								roles: stage === "role" ? roles : [],
								effect,
								postStages,
								roleChoices,
							});
							return !!group && change([...posts, group]);
						}}
					/>
				</fieldset>
			)}
		</fieldset>
	);
}
