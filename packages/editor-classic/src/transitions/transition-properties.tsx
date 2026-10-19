"use client";

import { useId } from "react";
import { formatTimecode } from "opencut-wasm";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PanelView } from "../components/editor/panels/assets/views/base-panel";
import type { VideoElement, ImageElement } from "../timeline";
import { useTransitionProperties } from "./use-transition-properties";

const transitionLabel: Readonly<Record<string, string>> = {
	left: "向左",
	right: "向右",
	up: "向上",
	down: "向下",
	hinge: "折轴",
	angle: "角度",
	perspective: "透视",
	shading: "阴影",
	curl: "卷曲",
	segments: "分段",
};

export function TransitionProperties({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement;
	trackId: string;
}) {
	const state = useTransitionProperties({ element, trackId });
	const durationId = useId();
	return (
		<PanelView title="入场转场" contentClassName="px-3 pb-4">
			<div
				className="flex min-w-0 flex-col gap-4"
				data-testid="transition-properties"
				aria-busy={state.isSaving}
			>
				<div>
					<h3 className="text-sm font-medium">画面转场</h3>
					<p className="text-muted-foreground mt-1 text-xs">
						以剪切点为中心，从出场画面过渡到此片段，不改变片段时间。
					</p>
				</div>
				<label className="flex flex-col gap-1.5 text-xs">
					转场类型
					<select
						aria-label="转场类型"
						data-testid="transition-kind"
						value={state.kind}
						disabled={state.isSaving}
						onChange={(event) =>
							state.setKind(event.target.value as typeof state.kind)
						}
						className="border-border bg-background h-8 min-w-0 rounded-sm border px-2 text-sm"
					>
						<option value="cross-dissolve">交叉溶解</option>
						<option value="peel" disabled={!state.peelAvailable}>
							剥离
						</option>
						<option value="bend" disabled={!state.bendAvailable}>
							弯折
						</option>
					</select>
				</label>
				{state.peelError && (
					<p className="text-muted-foreground text-xs">{state.peelError}</p>
				)}
				{state.bendError && (
					<p className="text-muted-foreground text-xs">{state.bendError}</p>
				)}
				{state.kind === "bend" && state.bend && (
					<fieldset
						disabled={state.isSaving}
						className="flex min-w-0 flex-col gap-2 text-xs"
					>
						<legend>弯折样式</legend>
						<label className="flex flex-col gap-1.5">
							方向
							<select
								aria-label="弯折方向"
								data-testid="transition-bend-direction"
								value={state.bend.direction}
								onChange={(event) =>
									state.setBend("direction", event.target.value)
								}
								className="border-border bg-background h-8 min-w-0 rounded-sm border px-2 text-sm"
							>
								{["left", "right", "up", "down"].map((direction) => (
									<option key={direction} value={direction}>
										{transitionLabel[direction] ?? direction}
									</option>
								))}
							</select>
						</label>
						{(["hinge", "angle", "perspective", "shading"] as const).map(
							(key) => (
								<label key={key} className="flex flex-col gap-1.5">
									{transitionLabel[key] ?? key}
									<Input
										type="number"
										step="any"
										aria-label={`弯折${transitionLabel[key] ?? key}`}
										data-testid={`transition-bend-${key}`}
										value={state.bend![key]}
										onChange={(event) => state.setBend(key, event.target.value)}
									/>
								</label>
							),
						)}
						<p className="text-muted-foreground">
							请确认目录建议值；保存时由原生引擎校验所有弯折参数。
						</p>
					</fieldset>
				)}
				{state.kind === "peel" && state.peel && (
					<fieldset
						disabled={state.isSaving}
						className="flex min-w-0 flex-col gap-2 text-xs"
					>
						<legend>剥离样式</legend>
						<label className="flex flex-col gap-1.5">
							方向
							<select
								aria-label="剥离方向"
								data-testid="transition-peel-direction"
								value={state.peel.direction}
								onChange={(event) =>
									state.setPeel("direction", event.target.value)
								}
								className="border-border bg-background h-8 min-w-0 rounded-sm border px-2 text-sm"
							>
								{["left", "right", "up", "down"].map((direction) => (
									<option key={direction} value={direction}>
										{transitionLabel[direction] ?? direction}
									</option>
								))}
							</select>
						</label>
						{(["curl", "segments", "shading", "perspective"] as const).map(
							(key) => (
								<label key={key} className="flex flex-col gap-1.5">
									{transitionLabel[key] ?? key}
									<Input
										type="number"
										step={key === "segments" ? 1 : "any"}
										aria-label={`剥离${transitionLabel[key] ?? key}`}
										data-testid={`transition-peel-${key}`}
										value={state.peel![key]}
										onChange={(event) => state.setPeel(key, event.target.value)}
									/>
								</label>
							),
						)}
						<p className="text-muted-foreground">
							请确认目录建议值；保存时由原生引擎校验所有剥离参数。
						</p>
					</fieldset>
				)}
				<label className="flex min-w-0 flex-col gap-1.5 text-xs">
					出场片段
					<select
						aria-label="转场出场片段"
						data-testid="transition-outgoing"
						value={state.outgoingId}
						disabled={state.isSaving || state.candidates.length === 0}
						onChange={(event) => state.setOutgoingId(event.target.value)}
						className="border-border bg-background focus-visible:ring-ring h-8 w-full min-w-0 rounded-sm border px-2 text-sm focus-visible:ring-1"
					>
						{!state.candidates.length && (
							<option value="">此轨道没有其他画面片段</option>
						)}
						{state.candidates.map((clip) => (
							<option key={clip.id} value={clip.id}>
								{formatTimecode({
									time: clip.startTime,
									format: "HH:MM:SS:FF",
									rate: state.fps,
								})}{" "}
								{clip.name}
							</option>
						))}
					</select>
				</label>
				<div className="min-w-0 text-xs">
					<span className="text-muted-foreground">转入 </span>
					<span className="break-words">{element.name}</span>
					<span className="text-muted-foreground mt-1 block">
						起点{" "}
						{formatTimecode({
							time: element.startTime,
							format: "HH:MM:SS:FF",
							rate: state.fps,
						})}
					</span>
				</div>
				<label htmlFor={durationId} className="flex flex-col gap-1.5 text-xs">
					时长（帧）
					<Input
						id={durationId}
						aria-label="转场时长（帧）"
						data-testid="transition-duration"
						type="number"
						min={2}
						step={1}
						value={state.frames}
						disabled={state.isSaving}
						onChange={(event) => state.setFrames(event.target.value)}
					/>
				</label>
				<p
					className="text-muted-foreground text-xs"
					role="status"
					data-testid="transition-validation"
				>
					{state.validation.message}
				</p>
				{state.isHidden && (
					<p className="text-xs">
						片段或轨道已隐藏。请显示两个片段及其轨道以查看转场。
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						data-testid="transition-apply"
						className="aria-disabled:opacity-50"
						aria-disabled={
							state.isSaving || !state.validation.valid || state.unchanged
						}
						onClick={() => void state.save()}
					>
						{element.transitionIn ? "更新转场" : "添加转场"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						data-testid="transition-remove"
						className="aria-disabled:opacity-50"
						aria-disabled={state.isSaving || !element.transitionIn}
						onClick={() => void state.save(true)}
					>
						移除转场
					</Button>
				</div>
				<p
					role="status"
					className="text-xs"
					data-testid="transition-save-status"
				>
					{state.message}
				</p>
				<p className="text-muted-foreground text-xs">
					视频素材需在剪切点两侧保留足够余量。保存后可撤销或重做。
				</p>
			</div>
		</PanelView>
	);
}
