import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import { ProgrammaticRecipeFields } from "./programmatic-recipe-fields";
import { ProgrammaticRecipeDraft } from "./programmatic-recipe-draft";
import { recipeSource } from "./programmatic-recipe-fixture";

interface FieldProps {
	children?: ReactNode;
	id?: string;
	"aria-label"?: string;
	onChange?: (event: { target: { value: string } }) => void;
	onClick?: () => void;
}
function findField({
	node,
	label,
}: {
	node: ReactNode;
	label: string;
}): FieldProps | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findField({ node: child, label });
			if (found) return found;
		}
	} else if (isValidElement<FieldProps>(node)) {
		if (node.props.id === label || node.props["aria-label"] === label)
			return node.props;
		return findField({ node: node.props.children, label });
	}
	return undefined;
}

test("actual recipe fields wire edit, Apply and Discard to the retained draft", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	let applied = 0;
	const fields = () =>
		ProgrammaticRecipeFields({
			id: "recipe",
			state: draft.getSnapshot(),
			readOnly: null,
			conflict: false,
			onEdit: (text) => draft.edit(text),
			onDiscard: () => draft.discard(),
			onApply: () => {
				applied++;
			},
		});
	const text = JSON.stringify({ ...recipeSource.recipe, songStartSeconds: 2 });
	const input = findField({ node: fields(), label: "recipe-recipe" });
	if (!input?.onChange) throw Error("Recipe input missing");
	input.onChange({ target: { value: text } });
	expect(draft.getSnapshot().text).toBe(text);
	findField({ node: fields(), label: "Apply recipe" })?.onClick?.();
	expect(applied).toBe(1);
	findField({ node: fields(), label: "Discard recipe draft" })?.onClick?.();
	expect(draft.getSnapshot().dirty).toBe(false);
});

test("recipe component presents advanced parameters, accessible actions and recoverable read-only conflicts", () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	draft.edit("unapplied recipe");
	const render = ({
		readOnly,
		conflict,
	}: {
		readOnly: string | null;
		conflict: boolean;
	}) =>
		renderToStaticMarkup(
			<ProgrammaticRecipeFields
				id="recipe"
				state={draft.getSnapshot()}
				readOnly={readOnly}
				conflict={conflict}
				onEdit={() => {}}
				onApply={() => {}}
				onDiscard={() => {}}
			/>,
		);
	const editable = render({ readOnly: null, conflict: false });
	expect(editable).toContain("Recipe JSON (advanced)");
	expect(editable).toContain("Rust validates");
	expect(editable).toContain('aria-label="Apply recipe"');
	expect(editable).not.toContain('disabled=""');
	const readonly = render({
		readOnly: "Compiled sources must be rebuilt.",
		conflict: true,
	});
	expect(readonly).toContain("Previous recipe draft (read-only)");
	expect(readonly).toContain("unapplied recipe");
	expect(readonly).toContain('readonly=""');
	expect(readonly).toContain("Your edits are retained");
	expect(readonly).toContain('aria-label="Apply recipe" disabled=""');
	expect(readonly).not.toContain(
		'aria-label="Discard recipe draft" disabled=""',
	);
});

test("recipe component shows failure and pending state without hiding the draft", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	draft.edit("{}");
	await draft.apply(async () => {
		throw Error("Native validation rejected this recipe");
	});
	const html = renderToStaticMarkup(
		<ProgrammaticRecipeFields
			id="recipe"
			state={draft.getSnapshot()}
			readOnly={null}
			conflict={false}
			onEdit={() => {}}
			onApply={() => {}}
			onDiscard={() => {}}
		/>,
	);
	expect(html).toContain('role="alert"');
	expect(html).toContain("Native validation rejected");
	expect(html).toContain('aria-invalid="true"');
	expect(html).toContain("Unapplied recipe draft");
	let release!: (source: typeof recipeSource) => void;
	const pending = draft.apply(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const busy = renderToStaticMarkup(
		<ProgrammaticRecipeFields
			id="recipe"
			state={draft.getSnapshot()}
			readOnly={null}
			conflict={false}
			onEdit={() => {}}
			onApply={() => {}}
			onDiscard={() => {}}
		/>,
	);
	expect(busy).toContain("Applying recipe...");
	expect(busy).toContain('aria-label="Discard recipe draft" disabled=""');
	expect(busy).toContain('aria-label="Apply recipe" disabled=""');
	release(recipeSource);
	await pending;
});
