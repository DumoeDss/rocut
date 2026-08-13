"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectionBox } from "./selection-box";
import { SelectionContext } from "./context";
import { SELECTABLE_ITEM_ATTRIBUTE } from "./attributes";
import { resolveElementIntersections } from "./hit-testing";
import {
	applyBoxSelection,
	clearSelection,
	isSelected as getIsSelected,
	pruneSelection,
	replaceSelection,
	selectRange,
	toggleSelection,
} from "./state";
import type { SelectableSurfaceProps, SelectionState } from "./types";
import { useBoxSelect } from "./hooks/use-box-select";
import { cn } from "../utils/ui";
import { useOptionalEditorSession } from "../editor/session/editor-session-provider";

export function SelectableSurface({
	orderedIds,
	children,
	className,
	ariaLabel = "Selectable items",
	revealId = null,
	onRevealComplete,
	onSelectionChange,
}: SelectableSurfaceProps) {
	const [selectionState, setSelectionState] = useState<SelectionState>(() =>
		clearSelection(),
	);
	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	const visibleSelectionState = useMemo(
		() => pruneSelection({ state: selectionState, orderedIds }),
		[orderedIds, selectionState],
	);
	const containerRef = useRef<HTMLDivElement>(null);
	const itemElementsRef = useRef<Map<string, HTMLElement>>(new Map());
	const session = useOptionalEditorSession();

	const registerItem = useCallback(
		(id: string, element: HTMLElement | null) => {
			if (element) {
				itemElementsRef.current.set(id, element);
			} else {
				itemElementsRef.current.delete(id);
			}
		},
		[],
	);

	const getSelectableElements = useCallback(() => {
		return itemElementsRef.current;
	}, []);

	const getItemElement = useCallback((id: string) => {
		return itemElementsRef.current.get(id) ?? null;
	}, []);
	const shouldStartSelection = useCallback(
		(event: React.MouseEvent<Element>) => {
			return !(
				event.target instanceof Element &&
				event.target.closest(`[${SELECTABLE_ITEM_ATTRIBUTE}='true']`)
			);
		},
		[],
	);
	const resolveIntersections = useCallback(
		({
			startPos,
			currentPos,
		}: {
			startPos: { x: number; y: number };
			currentPos: { x: number; y: number };
		}) => {
			return resolveElementIntersections({
				startPos,
				currentPos,
				elements: getSelectableElements(),
			});
		},
		[getSelectableElements],
	);

	const clearSelectionState = useCallback(() => {
		setSelectionState(clearSelection());
	}, []);

	const selectedIdSet = useMemo(
		() => new Set(visibleSelectionState.selectedIds),
		[visibleSelectionState.selectedIds],
	);

	const isSelected = useCallback(
		(id: string) => selectedIdSet.has(id),
		[selectedIdSet],
	);

	const handleItemClick = useCallback(
		({
			event,
			id,
		}: {
			event:
				| React.MouseEvent<HTMLDivElement>
				| React.KeyboardEvent<HTMLDivElement>;
			id: string;
		}) => {
			setSelectionState((state) => {
				const currentState = pruneSelection({ state, orderedIds });
				const isToggleSelection = event.ctrlKey || event.metaKey;

				if (event.shiftKey) {
					return selectRange({
						state: currentState,
						orderedIds,
						targetId: id,
						isAdditive: isToggleSelection,
					});
				}

				if (isToggleSelection) {
					return toggleSelection({
						state: currentState,
						id,
					});
				}

				return replaceSelection({
					ids: [id],
					anchorId: id,
				});
			});
		},
		[orderedIds],
	);

	const selectUnselectedItem = useCallback(
		(id: string) => {
			setSelectionState((state) => {
				const currentState = pruneSelection({ state, orderedIds });
				if (getIsSelected({ state: currentState, id })) {
					return currentState;
				}

				return replaceSelection({ ids: [id], anchorId: id });
			});
		},
		[orderedIds],
	);

	const handleItemMouseDown = useCallback(
		({
			event,
			id,
		}: {
			event: React.MouseEvent<HTMLDivElement>;
			id: string;
		}) => {
			if (event.button !== 2) {
				return;
			}

			selectUnselectedItem(id);
		},
		[selectUnselectedItem],
	);

	const handleBoxSelectionChange = useCallback(
		(change: Parameters<typeof applyBoxSelection>[0]) => {
			setSelectionState(applyBoxSelection(change));
		},
		[],
	);

	const { selectionBox, handleMouseDown, isSelecting, shouldIgnoreClick } =
		useBoxSelect({
			containerRef,
			resolveIntersections,
			selectedIds: visibleSelectionState.selectedIds,
			anchorId: visibleSelectionState.anchorId,
			onSelectionChange: handleBoxSelectionChange,
			shouldStartSelection,
		});

	const handleBackgroundClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const clickedSelectableItem =
				event.target instanceof Element &&
				event.target.closest(`[${SELECTABLE_ITEM_ATTRIBUTE}='true']`);
			const isIgnoringClick = shouldIgnoreClick();
			if (clickedSelectableItem || isIgnoringClick) {
				return;
			}

			clearSelectionState();
		},
		[clearSelectionState, shouldIgnoreClick],
	);

	const handleBackgroundKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.target !== event.currentTarget) {
				return;
			}

			if (
				event.key !== "Enter" &&
				event.key !== " " &&
				event.key !== "Escape"
			) {
				return;
			}

			event.preventDefault();
			clearSelectionState();
		},
		[clearSelectionState],
	);

	useEffect(() => {
		onSelectionChange?.(visibleSelectionState);
	}, [onSelectionChange, visibleSelectionState]);

	useEffect(() => {
		if (!revealId) {
			return;
		}

		// eslint-disable-next-line react-hooks/set-state-in-effect -- a reveal prop transition intentionally starts a new timed highlight.
		setHighlightedId(revealId);
		getItemElement(revealId)?.scrollIntoView({ block: "center" });

		const timer = session?.resources.setTimeout({
			handler: () => {
				setHighlightedId(null);
				onRevealComplete?.();
			},
			ms: 1500,
		});
		if (!timer) {
			let cancelled = false;
			queueMicrotask(() => {
				if (cancelled) return;
				setHighlightedId(null);
				onRevealComplete?.();
			});
			return () => {
				cancelled = true;
			};
		}

		return () => timer.cancel();
	}, [getItemElement, onRevealComplete, revealId, session]);

	const isBoxSelecting = isSelecting;

	const contextValue = useMemo(() => {
		return {
			selectedIds: visibleSelectionState.selectedIds,
			anchorId: visibleSelectionState.anchorId,
			highlightedId,
			isBoxSelecting,
			isSelected,
			clearSelection: clearSelectionState,
			handleItemClick,
			handleItemMouseDown,
			registerItem,
		};
	}, [
		clearSelectionState,
		handleItemClick,
		handleItemMouseDown,
		highlightedId,
		isBoxSelecting,
		isSelected,
		registerItem,
		visibleSelectionState.anchorId,
		visibleSelectionState.selectedIds,
	]);

	return (
		<SelectionContext.Provider value={contextValue}>
			<div
				ref={containerRef}
				className={cn("relative min-h-full", className)}
				role="listbox"
				aria-label={ariaLabel}
				aria-multiselectable="true"
				tabIndex={0}
				onMouseDown={handleMouseDown}
				onClick={handleBackgroundClick}
				onKeyDown={handleBackgroundKeyDown}
			>
				{children}
				<SelectionBox bounds={selectionBox?.bounds ?? null} />
			</div>
		</SelectionContext.Provider>
	);
}
