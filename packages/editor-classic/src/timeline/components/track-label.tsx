import {
	ArrowUp01Icon,
	SquareLock01Icon,
	SquareUnlock01Icon,
	ArrowDown01Icon,
	MagicWand05Icon,
	MusicNote03Icon,
	TextIcon,
	ViewIcon,
	ViewOffSlashIcon,
	VolumeHighIcon,
	VolumeOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { OcShapesIcon, OcVideoIcon } from "../../components/icons";
import type { TimelineTrack } from "../types";
import { canTrackBeHidden, canTrackHaveAudio } from "../track-capabilities";
import { getTrackHeight } from "./track-layout";
import { useTimelineStore } from "../../editor/use-session-store";
import { trackLockValidator } from "../../editor/transactions/opencut/track-lock-runtime";

function TrackIcon({ track }: { track: TimelineTrack }) {
	if (track.type === "video")
		return <OcVideoIcon className="size-4 shrink-0" />;
	if (track.type === "graphic")
		return <OcShapesIcon className="size-4 shrink-0" />;
	return (
		<HugeiconsIcon
			icon={
				track.type === "audio"
					? MusicNote03Icon
					: track.type === "text"
						? TextIcon
						: MagicWand05Icon
			}
			className="size-4 shrink-0"
		/>
	);
}

function TrackToggle({
	label,
	off,
	icons,
	onClick,
	disabled = false,
}: {
	label: string;
	off: boolean;
	icons: { on: IconSvgElement; off: IconSvgElement };
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={off}
			disabled={disabled}
			className="flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent focus-visible:outline focus-visible:outline-2"
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
		>
			<HugeiconsIcon
				icon={off ? icons.off : icons.on}
				className={
					off ? "text-destructive size-4" : "text-muted-foreground size-4"
				}
			/>
		</button>
	);
}

export function TimelineTrackLabel({
	track,
	onToggleMute,
	onToggleLock,
	onToggleVisibility,
	order,
}: {
	track: TimelineTrack;
	onToggleMute: () => void;
	onToggleLock?: () => void;
	onToggleVisibility: () => void;
	order?: {
		canMoveUp: boolean;
		canMoveDown: boolean;
		onMove: (direction: "up" | "down") => void;
	};
}) {
	const count = track.elements.length;
	const heightScale = useTimelineStore((s) => s.trackHeightScale);
	const summary = `${track.name} — ${count === 0 ? "空轨道" : `${count} 个片段`}`;
	return (
		<div
			className="text-muted-foreground flex shrink-0 items-center gap-1 px-2"
			style={{ height: getTrackHeight({ type: track.type, heightScale }) }}
			data-testid="timeline-track-label"
			data-track-id={track.id}
			data-empty={count === 0}
			data-locked={track.locked === true}
			title={summary}
		>
			<TrackIcon track={track} />
			<span className="text-foreground min-w-0 flex-1 truncate text-xs">
				{track.name}
			</span>
			<span
				className="shrink-0 text-[10px]"
				aria-label={count === 0 ? "空轨道" : `${count} 个片段`}
			>
				{count === 0 ? "空" : count}
			</span>
			{onToggleLock && (
				<TrackToggle
					label={
						trackLockValidator()
							? `${track.locked ? "解锁" : "锁定"} ${track.name}`
							: "轨道锁定需要升级 Rocut WASM"
					}
					disabled={!trackLockValidator()}
					off={track.locked === true}
					icons={{ on: SquareUnlock01Icon, off: SquareLock01Icon }}
					onClick={onToggleLock}
				/>
			)}
			{canTrackHaveAudio(track) && (
				<TrackToggle
					label={`${track.muted ? "取消静音" : "静音"} ${track.name}`}
					off={track.muted}
					icons={{ on: VolumeHighIcon, off: VolumeOffIcon }}
					onClick={onToggleMute}
				/>
			)}
			{canTrackBeHidden(track) && (
				<TrackToggle
					label={`${track.hidden ? "显示" : "隐藏"} ${track.name}`}
					off={track.hidden}
					icons={{ on: ViewIcon, off: ViewOffSlashIcon }}
					onClick={onToggleVisibility}
				/>
			)}
			{order &&
				(["up", "down"] as const).map((direction) => (
					<button
						key={direction}
						type="button"
						aria-label={`${direction === "up" ? "上移" : "下移"} ${track.name}`}
						title={
							direction === "up"
								? "上移图层（置于前方）"
								: "下移图层（置于后方）"
						}
						disabled={
							track.locked === true ||
							(direction === "up" ? !order.canMoveUp : !order.canMoveDown)
						}
						className="flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent disabled:opacity-25 focus-visible:outline focus-visible:outline-2"
						onClick={(event) => {
							event.stopPropagation();
							order.onMove(direction);
						}}
					>
						<HugeiconsIcon
							icon={direction === "up" ? ArrowUp01Icon : ArrowDown01Icon}
							className="size-3"
						/>
					</button>
				))}
		</div>
	);
}
