import { useRef } from "react";
import { useEditorInstance } from "./use-editor";

export function useMenuPreview() {
	const editor = useEditorInstance();
	const didCommitRef = useRef(false);

	const discard = () => {
		if (!didCommitRef.current && editor.timeline.isPreviewActive()) {
			editor.timeline.discardPreview();
		}
	};

	const markCommitted = () => {
		didCommitRef.current = true;
	};

	const onOpenChange = (isOpen: boolean) => {
		if (!isOpen) {
			discard();
			didCommitRef.current = false;
		}
	};

	return { onPointerLeave: discard, onOpenChange, markCommitted };
}
