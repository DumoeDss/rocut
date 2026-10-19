import { createCreatorSnapshotFence } from "./creator-snapshot-fence";
import type {
	CreatorWorkspaceBridge,
	CreatorWorkspaceSnapshot,
} from "./creator-workspace-types";

export function createCreatorWorkspaceStore(
	bridge: CreatorWorkspaceBridge | null,
) {
	let state: {
		snapshot: CreatorWorkspaceSnapshot | null;
		error: string | null;
	} = { snapshot: null, error: null };
	const listeners = new Set<() => void>();
	const accept = createCreatorSnapshotFence();
	let disconnect: (() => void) | undefined;
	const publish = () => {
		for (const listener of listeners) listener();
	};
	const setSnapshot = (snapshot: CreatorWorkspaceSnapshot) => {
		if (!accept(snapshot)) return;
		state = { snapshot, error: null };
		publish();
	};
	const connect = () => {
		if (!bridge) return;
		let active = true;
		let received = false;
		const unsubscribe = bridge.subscribe((snapshot) => {
			received = true;
			if (active) setSnapshot(snapshot);
		});
		void bridge
			.getSnapshot()
			.then((snapshot) => {
				if (active && !received) setSnapshot(snapshot);
			})
			.catch((failure: unknown) => {
				if (!active || received) return;
				state = {
					...state,
					error:
						failure instanceof Error
							? failure.message
							: "无法加载项目内容，请重试",
				};
				publish();
			});
		disconnect = () => {
			active = false;
			unsubscribe();
		};
	};
	return {
		getState: () => state,
		setSnapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			if (listeners.size === 1) connect();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) {
					disconnect?.();
					disconnect = undefined;
				}
			};
		},
	};
}
