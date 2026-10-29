import { expect, test } from "@playwright/test";

type MusicFixture = {
	bindingId: string;
	resource: unknown;
	moveSong(): Promise<void>;
	seekNearBeat(): void;
	playhead(): number;
	visualUnchanged(): Promise<boolean>;
	query(): Promise<{
		status: string;
		mappingHash: string;
		points: { tick: number }[];
	}>;
};
type ProbeWindow = Window & {
	__creatorWorkspaceFixture: { loadMusicGrid(): Promise<MusicFixture> };
	__musicGridFixture: MusicFixture;
};

test("real private WASM drives reviewed ruler, independent source anchors and live move review", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/?creator-workspace-harness=1");
	await expect(page.getByLabel("音乐网格控制")).toBeVisible();
	const data = await page.evaluate(async () => {
		const target = window as unknown as ProbeWindow;
		target.__musicGridFixture =
			await target.__creatorWorkspaceFixture.loadMusicGrid();
		return {
			bindingId: target.__musicGridFixture.bindingId,
			resource: target.__musicGridFixture.resource,
			before: await target.__musicGridFixture.query(),
		};
	});
	expect(data.before.status).toBe("ready");
	await page.getByRole("checkbox", { name: "拍点", exact: true }).check();
	await page.getByLabel("歌曲网格绑定").selectOption(data.bindingId);
	await expect(page.getByLabel("音乐网格控制")).toContainText(
		"人工 · 已审定 fixture:meter-review",
	);
	await expect(page.getByLabel("音乐网格控制")).toContainText("4/4");
	const markers = page.getByLabel("音乐拍点").locator("span");
	await expect.poll(() => markers.count()).toBeGreaterThan(1);
	const visibleBeatCount = await markers.count();
	await page.getByLabel("拍点类型").selectOption("downbeat");
	await expect.poll(() => markers.count()).toBeGreaterThan(0);
	await expect.poll(() => markers.count()).toBeLessThan(visibleBeatCount);
	await page.getByLabel("拍点类型").selectOption("beat");
	await page.evaluate(() =>
		(window as unknown as ProbeWindow).__musicGridFixture.seekNearBeat(),
	);
	await page.getByRole("button", { name: "吸附播放头", exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as ProbeWindow).__musicGridFixture.playhead(),
			),
		)
		.toBe(60000);
	await page.getByText("歌词 / 乐段独立锚点", { exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "音乐源锚点", exact: true }),
	).toBeVisible();
	expect(
		await page
			.getByRole("dialog", { name: "音乐源锚点", exact: true })
			.evaluate((element) => getComputedStyle(element).backgroundColor),
	).not.toBe("rgba(0, 0, 0, 0)");
	const choosing = page.waitForEvent("filechooser");
	await page.getByLabel("审定锚点 JSON", { exact: true }).click();
	await (
		await choosing
	).setFiles({
		name: "reviewed-sections.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(data.resource)),
	});
	const anchor = page.getByTestId("music-anchor-verse");
	await expect(anchor).toContainText("Verse reviewed");
	const leftBefore = await anchor.evaluate((element) =>
		Number.parseFloat((element as HTMLElement).style.left),
	);
	await page.evaluate(() =>
		(window as unknown as ProbeWindow).__musicGridFixture.moveSong(),
	);
	await expect(
		page.getByRole("status").filter({ hasText: "歌曲映射已改变" }),
	).toBeVisible();
	const after = await page.evaluate(() =>
		(window as unknown as ProbeWindow).__musicGridFixture.query(),
	);
	expect(after.mappingHash).not.toBe(data.before.mappingHash);
	expect(after.points[0]?.tick).toBe(120000);
	await expect(
		page.getByRole("dialog", { name: "音乐源锚点", exact: true }),
	).toContainText("Tail reviewed · 960000—1080000 scene tick");
	await expect
		.poll(() =>
			anchor.evaluate((element) =>
				Number.parseFloat((element as HTMLElement).style.left),
			),
		)
		.toBeGreaterThan(leftBefore);
	expect(
		await page.evaluate(() =>
			(window as unknown as ProbeWindow).__musicGridFixture.visualUnchanged(),
		),
	).toBe(true);
	await page.screenshot({
		path: test.info().outputPath("music-grid-reviewed-anchors.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "已复核关系", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "歌曲映射已改变" }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "关闭源锚点", exact: true }).click();
	await page.getByRole("checkbox", { name: "拍点", exact: true }).uncheck();
	await expect(page.getByLabel("音乐拍点")).toHaveCount(0);
	await expect(anchor).toContainText("Verse reviewed");
	expect(errors).toEqual([]);
	await page.screenshot({
		path: test.info().outputPath("music-grid-after-move.png"),
		fullPage: true,
	});
});
