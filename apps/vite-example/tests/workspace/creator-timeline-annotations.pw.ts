import { expect, test } from "@playwright/test";

type AnnotationProbe = {
	getTimingJson(): {
		lines: { manual: { startSeconds: number; endSeconds: number } }[];
	};
	getOriginalLrc(): string;
	setTimingSaveFailure(value: boolean): void;
	undo(): Promise<void>;
	redo(): Promise<void>;
};

test.beforeEach(async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1&annotation-fixture=1");
	await expect(page.getByTestId("creator-timeline-annotations")).toBeVisible();
});

test("separate section and lyric rows move, persist, undo, redo and reopen", async ({
	page,
}) => {
	const rows = page.getByTestId("creator-timeline-annotations");
	await expect(rows.getByLabel("段落轨", { exact: true })).toContainText(
		"Verse 1",
	);
	const lyric = rows.getByRole("button", {
		name: "歌词：First lyric",
		exact: true,
	});
	const box = (await lyric.boundingBox())!;
	const section = (await rows
		.getByLabel("段落轨", { exact: true })
		.boundingBox())!;
	expect(section.y + section.height).toBeLessThanOrEqual(box.y);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width, box.y + box.height / 2, {
		steps: 10,
	});
	await page.mouse.up();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
					).__creatorWorkspaceFixture.getTimingJson().lines[0].manual
						.startSeconds,
			),
		)
		.toBe(1);
	await expect(page.getByTestId("project-save")).toHaveAttribute(
		"data-save-state",
		"saved",
	);
	await page.evaluate(() =>
		(
			window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
		).__creatorWorkspaceFixture.undo(),
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
					).__creatorWorkspaceFixture.getTimingJson().lines[0].manual
						.startSeconds,
			),
		)
		.toBe(0.5);
	await page.evaluate(() =>
		(
			window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
		).__creatorWorkspaceFixture.redo(),
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
					).__creatorWorkspaceFixture.getTimingJson().lines[0].manual
						.startSeconds,
			),
		)
		.toBe(1);
	await page.reload();
	await expect(lyric).toBeVisible();
	const reopened = (await lyric.boundingBox())!;
	expect(reopened.x).toBeGreaterThan(box.x);
	expect(
		await page.evaluate(
			() =>
				(
					window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
				).__creatorWorkspaceFixture.getTimingJson().lines[0].manual,
		),
	).toEqual({ startSeconds: 1, endSeconds: 2 });
	expect(
		await page.evaluate(() =>
			(
				window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
			).__creatorWorkspaceFixture.getOriginalLrc(),
		),
	).toBe("[00:00.50]First lyric\n[00:01.50]\n");
	await page.screenshot({
		path: "tests/.workspace-output/timeline-annotations.png",
	});
});

test("a failed timing JSON save remains dirty and explicit retry acknowledges the moved lyric", async ({
	page,
}) => {
	await page.evaluate(() =>
		(
			window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
		).__creatorWorkspaceFixture.setTimingSaveFailure(true),
	);
	await page
		.getByRole("button", { name: "歌词：First lyric", exact: true })
		.press("ArrowRight");
	await expect(page.getByTestId("project-save")).toHaveAttribute(
		"data-save-state",
		"failed",
	);
	await expect(
		page.getByRole("alert").filter({ hasText: "Timing JSON" }).first(),
	).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				(
					window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
				).__creatorWorkspaceFixture.getTimingJson().lines[0].manual
					.startSeconds,
		),
	).toBe(0.5);
	await page.evaluate(() =>
		(
			window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
		).__creatorWorkspaceFixture.setTimingSaveFailure(false),
	);
	await page.getByTestId("project-save").click();
	await expect(page.getByTestId("project-save")).toHaveAttribute(
		"data-save-state",
		"saved",
	);
	expect(
		await page.evaluate(
			() =>
				(
					window as unknown as { __creatorWorkspaceFixture: AnnotationProbe }
				).__creatorWorkspaceFixture.getTimingJson().lines[0].manual
					.startSeconds,
		),
	).toBeCloseTo(0.5 + 1 / 30, 8);
	await expect(
		page.getByTestId("creator-timeline-annotations").getByRole("alert"),
	).toHaveCount(0);
});
