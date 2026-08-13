"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import type { SessionPersistenceCoordinator } from "@/editor/persistence";
import type {
	ProjectStore,
	ProjectStoreCapacity,
	ProjectStoreInspection,
} from "@opencut/editor-ports";
import { useEditor } from "@/editor/use-editor";
import { useEditorSession } from "@/editor/session/editor-session-provider";
import {
	buildStorageFailureRecord,
	runStorageClear,
	STORAGE_FAILURE_MESSAGE,
	type StorageProviderOperation,
} from "./storage-provider-operations";

export interface StorageContextType {
	isInitialized: boolean;
	isLoading: boolean;
	hasSupport: boolean;
	inspection: ProjectStoreInspection | null;
	capacity: ProjectStoreCapacity | null;
	error: string | null;
	persistence: SessionPersistenceCoordinator;
	store: ProjectStore;
	refreshCapacity: () => Promise<void>;
	clearProjects: () => Promise<void>;
	clearAll: () => Promise<void>;
}

const StorageContext = createContext<StorageContextType | null>(null);

export function useStorage() {
	const context = useContext(StorageContext);
	if (!context) {
		throw new Error("useStorage must be used within StorageProvider");
	}
	return context;
}

interface StorageProviderProps {
	children: React.ReactNode;
}

export function StorageProvider({ children }: StorageProviderProps) {
	const session = useEditorSession();
	const [persistence, project] = useEditor((editor) => [
		editor.persistence,
		editor.project,
	]);
	const store = persistence.store;
	const [status, setStatus] = useState({
		isInitialized: false,
		isLoading: true,
		inspection: null as ProjectStoreInspection | null,
		error: null as string | null,
	});

	const reportFailure = useCallback(
		(operation: StorageProviderOperation, error?: unknown) => {
			setStatus((current) => ({
				...current,
				isLoading: false,
				error: STORAGE_FAILURE_MESSAGE,
			}));
			session.diagnostics.log({
				record: buildStorageFailureRecord({ operation, error }),
			});
			toast.error(STORAGE_FAILURE_MESSAGE);
		},
		[session],
	);

	const inspect = useCallback(async () => {
		try {
			const inspection = await store.inspect();
			setStatus((current) => ({ ...current, inspection, error: null }));
		} catch (error) {
			reportFailure("inspect", error);
			throw error;
		}
	}, [reportFailure, store]);

	useEffect(() => {
		let active = true;
		void Promise.all([store.inspect(), project.loadAllProjects()])
			.then(([inspection]) => {
				if (!active) return;
				setStatus({
					isInitialized: true,
					isLoading: false,
					inspection,
					error: null,
				});
				if (inspection.availability !== "available") {
					toast.warning(
						"Durable storage is unavailable. Some features may not work.",
					);
				}
			})
			.catch((error: unknown) => {
				if (active) reportFailure("initialize", error);
			});
		return () => {
			active = false;
		};
	}, [project, reportFailure, store]);

	const clear = useCallback(
		async (scope: "projects" | "all") => {
			setStatus((current) => ({ ...current, isLoading: true, error: null }));
			try {
				const inspection = await runStorageClear({
					store,
					scope,
					reloadProjects: () => project.loadAllProjects(),
				});
				setStatus((current) => ({
					...current,
					isInitialized: true,
					isLoading: false,
					inspection,
					error: null,
				}));
			} catch (error) {
				reportFailure(scope === "all" ? "clear-all" : "clear-projects", error);
				throw error;
			}
		},
		[project, reportFailure, store],
	);

	const value = useMemo<StorageContextType>(() => {
		const capacity =
			status.inspection?.availability === "available"
				? status.inspection.capacity
				: null;
		return {
			...status,
			hasSupport: status.inspection?.availability === "available",
			capacity,
			persistence,
			store,
			refreshCapacity: inspect,
			clearProjects: () => clear("projects"),
			clearAll: () => clear("all"),
		};
	}, [clear, inspect, persistence, status, store]);

	return (
		<StorageContext.Provider value={value}>{children}</StorageContext.Provider>
	);
}
