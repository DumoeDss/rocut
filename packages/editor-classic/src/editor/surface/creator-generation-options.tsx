import { useEffect, useMemo, useState } from "react";
import {
	useCreatorWorkspaceBridge,
	useCreatorWorkspace,
} from "./creator-workspace-context";
import type {
	CreatorWorkspaceCommand,
	CreatorWorkspaceCommandResult,
} from "./creator-workspace-types";

export type GenerationOptions = Pick<
	Extract<CreatorWorkspaceCommand, { type: "asset.regenerate" }>,
	"providerId" | "modelId" | "references"
>;

export function CreatorGenerationOptions({
	mediaType,
	onChange,
	value: options,
	mode = "regenerate",
}: {
	mediaType: "image" | "video";
	onChange: (options: GenerationOptions) => void;
	value: GenerationOptions;
	mode?: "regenerate" | "create";
}) {
	const bridge = useCreatorWorkspaceBridge();
	const { snapshot } = useCreatorWorkspace();
	const [attempt, setAttempt] = useState(0);
	const request = useMemo(
		() => ({ bridge, mediaType, mode, attempt }),
		[bridge, mediaType, mode, attempt],
	);
	const [response, setResponse] = useState<{
		request: typeof request;
		catalog: CreatorWorkspaceCommandResult["catalog"];
	}>();
	const catalog = response?.request === request ? response.catalog : undefined;
	useEffect(() => {
		let active = true;
		void bridge
			?.execute({ type: "generation.catalog", mediaType })
			.then((result) => {
				if (active)
					setResponse({
						request,
						catalog: result.catalog ?? {
							status: "unavailable",
							providers: [],
							reason: "宿主尚未提供模型目录",
						},
					});
			})
			.catch(() => {
				if (active)
					setResponse({
						request,
						catalog: {
							status: "unavailable",
							providers: [],
							reason:
								mode === "create"
									? "模型目录暂不可用，请重试后选择服务与模型"
									: "模型目录暂不可用，仍可沿用原配方",
						},
					});
			});
		return () => {
			active = false;
		};
	}, [bridge, mediaType, request, mode]);
	const update = (next: GenerationOptions) => {
		onChange(next);
	};
	const provider = catalog?.providers.find(
		(item) => item.id === options.providerId,
	);
	const slots =
		mediaType === "image"
			? ["referenceImages"]
			: [
					"firstFrame",
					"lastFrame",
					"referenceImages",
					"referenceVideos",
					"referenceAudios",
				];
	const labels: Record<string, string> = {
		firstFrame: "首帧",
		lastFrame: "尾帧",
		referenceImages: "参考图像",
		referenceVideos: "参考视频（最多 3 个）",
		referenceAudios: "参考音频",
	};
	return (
		<div className="space-y-2 text-xs">
			<p className="text-muted-foreground">
				{mode === "create"
					? "选择生成服务与模型；生成结果将统一归入当前项目。"
					: "默认沿用原模型和固定参考版本；仅修改明确选择的选项。"}
			</p>
			{!catalog ? (
				<p>正在读取模型目录</p>
			) : catalog.status === "unavailable" ? (
				<p>
					{catalog.reason}{" "}
					<button
						type="button"
						className="underline"
						onClick={() => {
							update({});
							setAttempt((value) => value + 1);
						}}
					>
						重试读取模型
					</button>
				</p>
			) : (
				<>
					<label className="block">
						生成服务
						<select
							className="creator-type ml-2"
							value={options.providerId ?? ""}
							onChange={(event) => {
								const nextProvider = catalog.providers.find(
									(item) => item.id === event.target.value,
								);
								update({
									...options,
									providerId: event.target.value || undefined,
									modelId: nextProvider?.models.some(
										(model) => model.id === nextProvider.defaultModelId,
									)
										? nextProvider.defaultModelId
										: undefined,
								});
							}}
						>
							<option value="">
								{mode === "create" ? "选择生成服务" : "沿用原服务"}
							</option>
							{catalog.providers.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</select>
					</label>
					{provider && (
						<label className="block">
							生成模型
							<select
								className="creator-type ml-2"
								value={options.modelId ?? ""}
								onChange={(event) =>
									update({
										...options,
										modelId: event.target.value || undefined,
									})
								}
							>
								<option value="">
									{mode === "create" ? "选择生成模型" : "沿用原模型"}
								</option>
								{provider.models.map((model) => (
									<option key={model.id} value={model.id}>
										{model.name}
									</option>
								))}
							</select>
						</label>
					)}
				</>
			)}
			<label className="block">
				<input
					type="checkbox"
					checked={options.references !== undefined}
					onChange={(event) =>
						update({
							...options,
							references: event.target.checked ? {} : undefined,
						})
					}
				/>{" "}
				{mode === "create"
					? "添加固定参考素材"
					: "重新指定参考素材（留空将清除原参考）"}
			</label>
			{options.references !== undefined &&
				slots.map((slot) => (
					<label className="block" key={slot}>
						{labels[slot]}
						<select
							multiple={slot !== "firstFrame" && slot !== "lastFrame"}
							className="creator-type block w-full"
							value={
								slot === "firstFrame" || slot === "lastFrame"
									? options.references?.[slot]?.[0]
										? JSON.stringify(options.references[slot][0])
										: ""
									: (options.references?.[slot] ?? []).map((reference) =>
											JSON.stringify(reference),
										)
							}
							onChange={(event) => {
								const selected = new Set(
									Array.from(
										event.target.selectedOptions,
										(option) => option.value,
									),
								);
								const values =
									snapshot?.assets
										.flatMap((asset) =>
											asset.versions.map((version) => ({
												assetId: asset.id,
												versionId: version.id,
											})),
										)
										.filter((reference) =>
											selected.has(JSON.stringify(reference)),
										) ?? [];
								update({
									...options,
									references: {
										...options.references,
										[slot]:
											slot === "referenceVideos" ? values.slice(0, 3) : values,
									},
								});
							}}
						>
							{(slot === "firstFrame" || slot === "lastFrame") && (
								<option value="">不指定</option>
							)}
							{snapshot?.assets.flatMap((asset) =>
								asset.versions
									.filter(
										(version) =>
											version.status !== "pending" &&
											version.status !== "failed" &&
											version.mediaType ===
												(slot === "referenceVideos"
													? "video"
													: slot === "referenceAudios"
														? "audio"
														: "image"),
									)
									.map((version) => (
										<option
											key={`${asset.id}:${version.id}`}
											value={JSON.stringify({
												assetId: asset.id,
												versionId: version.id,
											})}
										>
											{asset.name} · {version.label}
										</option>
									)),
							)}
						</select>
					</label>
				))}
		</div>
	);
}
