"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import type { CreatorWorkspaceCommand } from "./creator-workspace-types";
import {
	CreatorGenerationOptions,
	type GenerationOptions,
} from "./creator-generation-options";

export function CreatorNewAssetView({
	execute,
	busy,
	available,
	initialMediaType = "image",
}: {
	execute: (command: CreatorWorkspaceCommand) => Promise<boolean>;
	busy: boolean;
	available: boolean;
	initialMediaType?: "image" | "video";
}) {
	const [mediaType, setMediaType] = useState<"image" | "video">(initialMediaType);
	const [prompt, setPrompt] = useState("");
	const [options, setOptions] = useState<GenerationOptions>({});
	const canSubmit =
		available &&
		!busy &&
		Boolean(prompt.trim() && options.providerId && options.modelId);
	return (
		<form
			className="creator-document space-y-5"
			data-testid="creator-new-asset-view"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSubmit || !options.providerId || !options.modelId) return;
				void execute({
					type: "asset.generate",
					mediaType,
					prompt,
					providerId: options.providerId,
					modelId: options.modelId,
					...(options.references === undefined
						? {}
						: { references: options.references }),
				}).then((success) => {
					if (success) setPrompt("");
				});
			}}
		>
			<h1 className="text-xl font-medium">生成新素材</h1>
			<p className="text-sm text-muted-foreground">
				任务与生成结果保存在当前项目中，可在素材库和画布查看。提交任务不会自动选用版本或替换时间线片段。
			</p>
			{!available && (
				<p role="status" className="text-sm text-muted-foreground">
					当前宿主尚未提供新素材生成能力，请更新 Creator Studio 后重试。
				</p>
			)}
			<fieldset disabled={busy || !available} className="space-y-4">
				<label className="block text-sm">
					素材类型
					<select
						className="creator-type ml-2"
						value={mediaType}
						onChange={(event) => {
							setMediaType(event.target.value === "video" ? "video" : "image");
							setOptions({});
						}}
					>
						<option value="image">图片</option>
						<option value="video">视频</option>
					</select>
				</label>
				<CreatorGenerationOptions
					mediaType={mediaType}
					mode="create"
					value={options}
					onChange={setOptions}
				/>
				<label className="block space-y-2 text-sm">
					<span>生成提示词</span>
					<textarea
						className="creator-prompt"
						value={prompt}
						maxLength={16000}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="描述需要的画面、主体、构图与运动"
					/>
				</label>
				<Button
					size="sm"
					type="submit"
					disabled={!canSubmit}
					data-testid="creator-new-asset-submit"
				>
					{busy ? "正在提交生成任务" : "提交生成任务"}
				</Button>
			</fieldset>
		</form>
	);
}
