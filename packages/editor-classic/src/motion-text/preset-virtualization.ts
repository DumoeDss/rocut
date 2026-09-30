export const MOTION_TEXT_PRESET_COLUMNS = 2;
export const MOTION_TEXT_PRESET_ROW_HEIGHT = 132;
export const MOTION_TEXT_PRESET_OVERSCAN_ROWS = 2;
export const MOTION_TEXT_MAX_ACTIVE_PREVIEWS = 4;

export interface MotionTextPresetVirtualWindow {
	readonly totalHeight: number;
	readonly startIndex: number;
	readonly endIndex: number;
	readonly activeIndexes: ReadonlySet<number>;
}

export function resolveMotionTextPresetVirtualWindow({
	itemCount,
	scrollTop,
	viewportHeight,
}: {
	readonly itemCount: number;
	readonly scrollTop: number;
	readonly viewportHeight: number;
}): MotionTextPresetVirtualWindow {
	const rowCount = Math.ceil(itemCount / MOTION_TEXT_PRESET_COLUMNS);
	const firstVisibleRow = Math.max(
		0,
		Math.floor(Math.max(0, scrollTop) / MOTION_TEXT_PRESET_ROW_HEIGHT),
	);
	const lastVisibleRow = Math.min(
		rowCount,
		Math.ceil(
			(Math.max(0, scrollTop) + Math.max(0, viewportHeight)) /
				MOTION_TEXT_PRESET_ROW_HEIGHT,
		),
	);
	const startRow = Math.max(
		0,
		firstVisibleRow - MOTION_TEXT_PRESET_OVERSCAN_ROWS,
	);
	const endRow = Math.min(
		rowCount,
		lastVisibleRow + MOTION_TEXT_PRESET_OVERSCAN_ROWS,
	);
	const firstActiveIndex = firstVisibleRow * MOTION_TEXT_PRESET_COLUMNS;
	const activeIndexes = new Set<number>();
	for (
		let index = firstActiveIndex;
		index <
		Math.min(itemCount, firstActiveIndex + MOTION_TEXT_MAX_ACTIVE_PREVIEWS);
		index += 1
	) {
		activeIndexes.add(index);
	}
	return {
		totalHeight: rowCount * MOTION_TEXT_PRESET_ROW_HEIGHT,
		startIndex: startRow * MOTION_TEXT_PRESET_COLUMNS,
		endIndex: Math.min(itemCount, endRow * MOTION_TEXT_PRESET_COLUMNS),
		activeIndexes,
	};
}
