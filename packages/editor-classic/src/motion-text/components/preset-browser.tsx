"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MotionTextPresetGroup } from "@opencut/editor-contracts";

import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { cn } from "../../utils/ui";
import {
	filterMotionTextPresetCatalog,
	JIZURA_PRESET_CATALOG,
	MOTION_TEXT_PRESET_GROUPS,
	type MotionTextPresetCatalogEntry,
} from "../preset-catalog";
import {
	MOTION_TEXT_PRESET_COLUMNS,
	MOTION_TEXT_PRESET_ROW_HEIGHT,
	resolveMotionTextPresetVirtualWindow,
} from "../preset-virtualization";
import { MotionTextPresetPreview } from "./preset-preview";
import { usePresetApplication } from "./use-preset-application";

type PresetGroupFilter = MotionTextPresetGroup | "all";

const DEFAULT_VIEWPORT_HEIGHT = 396;

export function MotionTextPresetBrowser({
	projectId,
}: {
	readonly projectId: string;
}) {
	const sectionRef = useRef<HTMLElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [group, setGroup] = useState<PresetGroupFilter>("all");
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<MotionTextPresetCatalogEntry | null>(
		null,
	);
	const { targetName, apply, isApplying, message } = usePresetApplication();
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
	const [catalogVisible, setCatalogVisible] = useState(false);
	const entries = useMemo(
		() => filterMotionTextPresetCatalog({ group, query }),
		[group, query],
	);
	const virtualWindow = resolveMotionTextPresetVirtualWindow({
		itemCount: entries.length,
		scrollTop,
		viewportHeight,
	});
	const mountedEntries = entries.slice(
		virtualWindow.startIndex,
		virtualWindow.endIndex,
	);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setViewportHeight(entry.contentRect.height);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const element = sectionRef.current;
		if (!element || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(([entry]) => {
			setCatalogVisible(entry?.isIntersecting ?? false);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const resetScroll = () => {
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
		setScrollTop(0);
	};

	return (
		<section
			ref={sectionRef}
			className="flex flex-col gap-2"
			aria-labelledby="motion-text-preset-catalog-heading"
			data-motion-text-preset-count={JIZURA_PRESET_CATALOG.length}
			data-motion-text-project-id={projectId}
			data-motion-text-catalog-visible={catalogVisible}
		>
			<div className="flex items-baseline justify-between gap-2">
				<h2
					id="motion-text-preset-catalog-heading"
					className="text-sm font-medium"
				>
					JIZURA preset catalog
				</h2>
				<span className="text-muted-foreground text-xs tabular-nums">
					{entries.length} / {JIZURA_PRESET_CATALOG.length}
				</span>
			</div>
			<Input
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
					resetScroll();
				}}
				placeholder="Search preset id or name"
				aria-label="Search JIZURA presets"
			/>
			<div
				className="scrollbar-hidden flex gap-1 overflow-x-auto pb-0.5"
				aria-label="JIZURA preset groups"
			>
				{(["all", ...MOTION_TEXT_PRESET_GROUPS] as const).map((value) => (
					<button
						key={value}
						type="button"
						aria-pressed={group === value}
						onClick={() => {
							setGroup(value);
							resetScroll();
						}}
						className={cn(
							"focus-visible:ring-ring shrink-0 rounded-full border px-2 py-1 text-xs focus-visible:ring-2",
							group === value
								? "border-foreground bg-foreground text-background"
								: "border-border bg-background text-muted-foreground",
						)}
					>
						{value}
					</button>
				))}
			</div>
			<div
				ref={scrollRef}
				onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
				className="border-border h-[396px] overflow-y-auto rounded-md border"
				data-motion-text-preset-viewport="true"
			>
				{entries.length === 0 ? (
					<div className="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-xs">
						No presets match this filter.
					</div>
				) : (
					<div
						className="relative w-full"
						style={{ height: virtualWindow.totalHeight }}
					>
						{mountedEntries.map((entry, offset) => {
							const index = virtualWindow.startIndex + offset;
							const row = Math.floor(index / MOTION_TEXT_PRESET_COLUMNS);
							const column = index % MOTION_TEXT_PRESET_COLUMNS;
							return (
								<button
									key={entry.key}
									type="button"
									aria-label={`Select preset ${entry.name} (${entry.group})`}
									aria-pressed={selected?.key === entry.key}
									onClick={() => setSelected(entry)}
									className="focus-visible:ring-ring absolute p-1 text-left focus-visible:z-10 focus-visible:ring-2"
									style={{
										top: row * MOTION_TEXT_PRESET_ROW_HEIGHT,
										left: `${column * 50}%`,
										width: "50%",
										height: MOTION_TEXT_PRESET_ROW_HEIGHT,
									}}
									data-motion-text-preset-card={entry.key}
								>
									<div
										className={cn(
											"bg-background size-full overflow-hidden rounded border",
											selected?.key === entry.key &&
												"border-primary ring-primary ring-1",
										)}
									>
										<MotionTextPresetPreview
											active={
												catalogVisible && virtualWindow.activeIndexes.has(index)
											}
											entry={entry}
										/>
										<div className="flex min-w-0 flex-col px-2 py-1.5">
											<div className="flex items-center gap-1">
												<span className="min-w-0 flex-1 truncate text-[11px] font-medium">
													{entry.name}
												</span>
											</div>
											<span className="text-muted-foreground truncate font-mono text-[9px]">
												{entry.key}
											</span>
										</div>
									</div>
								</button>
							);
						})}
					</div>
				)}
			</div>
			<div
				className="bg-muted/30 flex flex-col gap-2 rounded-md border p-2"
				data-testid="motion-text-preset-application"
			>
				<p className="text-muted-foreground text-xs leading-4">
					{targetName
						? `Target: ${targetName}. Changes only the selected preset group; locks stay intact.`
						: "Add or select a motion-text clip on the timeline to apply presets."}
				</p>
				<Button
					data-testid="motion-text-apply-preset"
					size="sm"
					disabled={!selected || !targetName || isApplying}
					onClick={() => selected && void apply(selected)}
				>
					{isApplying
						? "Applying…"
						: selected
							? `Apply ${selected.name}`
							: "Select a preset above"}
				</Button>
				{message && (
					<p
						role={message.error ? "alert" : "status"}
						className={cn(
							"text-xs leading-4",
							message.error ? "text-destructive" : "text-muted-foreground",
						)}
					>
						{message.text}
					</p>
				)}
			</div>
		</section>
	);
}
