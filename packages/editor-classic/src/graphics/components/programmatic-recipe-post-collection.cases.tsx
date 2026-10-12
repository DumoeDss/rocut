import { expect, test } from "bun:test";
import { act } from "react";
import type * as harness from "./programmatic-recipe-inspector-integration.cases";

export function registerPostCollectionCases({
	mount,
	control,
	change,
	click,
}: Pick<typeof harness, "mount" | "control" | "change" | "click">) {
	const collections = {
		postStages: { supported: ["role", "composite"], default: "role" },
		sceneParameters: {
			layers: {
				parameters: {
					items: {
						items: {
							properties: {
								roles: {
									items: {
										options: [
											"background",
											"subject",
											"graphics",
											"foreground",
										],
									},
								},
							},
						},
					},
				},
			},
		},
	};
	test("mounted post collection authoring adds explicit effects/groups and retains unrelated drafts", async () => {
		const h = await mount(24, collections);
		try {
			const original = JSON.parse(h.draft.getSnapshot().text);
			await change(
				control(h.container, "integration-post-0-new-kind"),
				"lightLeak",
			);
			await change(
				control(h.container, "integration-post-0-new-lightLeak-amount"),
				"0.4",
			);
			await click(h.container, "Add effect for post 0");
			expect(JSON.parse(h.draft.getSnapshot().text)).toEqual(original);
			expect(
				h.container.querySelector('[role="alert"]')?.textContent,
			).toContain("Complete required");
			await change(
				control(h.container, "integration-post-0-new-lightLeak-alpha"),
				"0",
			);
			await change(
				control(h.container, "integration-transition-1-curl"),
				"0.3",
			);
			expect(
				control(h.container, "integration-post-0-new-lightLeak-amount").value,
			).toBe("0.4");
			await click(h.container, "Add effect for post 0");
			let recipe = JSON.parse(h.draft.getSnapshot().text);
			expect(recipe.post[0].effects[1]).toEqual({
				kind: "lightLeak",
				amount: 0.4,
				alpha: "preserve",
			});
			expect(recipe.post[0].audio).toEqual(original.post[0].audio);
			expect(recipe.post[0].extra).toBe("post");
			await click(h.container, "Move post 0 effect 1 up");
			recipe = JSON.parse(h.draft.getSnapshot().text);
			expect(recipe.post[0].audio[0].effect).toBe(1);
			expect(recipe.post[0].effects[0].amount).toBe(0.4);
			await click(h.container, "Remove post 0 effect 1 and bindings");
			recipe = JSON.parse(h.draft.getSnapshot().text);
			expect(recipe.post[0].audio).toEqual([]);
			expect(recipe.post[0].effects).toEqual([
				{ kind: "lightLeak", amount: 0.4, alpha: "preserve" },
			]);
			await change(control(h.container, "integration-new-stage"), "composite");
			await change(
				control(h.container, "integration-new-group-effect-kind"),
				"lightLeak",
			);
			await change(
				control(h.container, "integration-new-group-effect-lightLeak-amount"),
				"0.1",
			);
			await change(
				control(h.container, "integration-new-group-effect-lightLeak-alpha"),
				"1",
			);
			await click(h.container, "Add initial effect for new post group");
			recipe = JSON.parse(h.draft.getSnapshot().text);
			expect(recipe.post[1]).toEqual({
				stage: "composite",
				effects: [{ kind: "lightLeak", amount: 0.1, alpha: "expand" }],
			});
			await click(h.container, "Move post 1 up");
			expect(JSON.parse(h.draft.getSnapshot().text).post[0].stage).toBe(
				"composite",
			);
			await click(h.container, "Remove post 1");
			expect(JSON.parse(h.draft.getSnapshot().text).post.length).toBe(1);
			expect(h.commits).toBe(0);
			await click(h.container, "Apply recipe");
			expect(h.commits).toBe(1);
			expect(control(h.container, "integration-new-stage").disabled).toBe(true);
			await h.finish();
			expect(h.draft.getSnapshot().dirty).toBe(false);
		} finally {
			await h.close();
		}
	});
	test("mounted post creation requires role selection and respects conflict/read-only", async () => {
		const h = await mount(24, collections);
		try {
			await change(control(h.container, "integration-new-stage"), "role");
			expect(
				control(h.container, "integration-new-group-effect-kind").disabled,
			).toBe(true);
			const role = h.container.querySelector<HTMLInputElement>(
				'[aria-label="New post group role subject"]',
			)!;
			await act(async () => role.click());
			await change(
				control(h.container, "integration-new-group-effect-kind"),
				"lightLeak",
			);
			await change(
				control(h.container, "integration-new-group-effect-lightLeak-amount"),
				"0.2",
			);
			await change(
				control(h.container, "integration-new-group-effect-lightLeak-alpha"),
				"0",
			);
			const before = h.draft.getSnapshot().text;
			await h.setMode(null, true);
			await click(h.container, "Add initial effect for new post group");
			expect(h.draft.getSnapshot().text).toBe(before);
			expect(control(h.container, "integration-new-stage").disabled).toBe(true);
			await h.setMode("Read-only source", false);
			expect(control(h.container, "integration-new-stage").disabled).toBe(true);
			await h.setMode(null, false);
			await click(h.container, "Add initial effect for new post group");
			expect(JSON.parse(h.draft.getSnapshot().text).post[1].roles).toEqual([
				"subject",
			]);
			expect(h.commits).toBe(0);
		} finally {
			await h.close();
		}
	});
}
