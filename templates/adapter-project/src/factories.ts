/**
 * ProjectStore-backed conformance factories for this adapter.
 *
 * This is the customization seam for engine, draft, and vector conformance:
 * return a fresh instance of your own ProjectStore from `createStore`. The SDK
 * helper owns only deterministic fixture assembly; the implementation under
 * test remains the store returned here.
 */
import {
	createProjectStoreConformanceFactories,
	type ProjectStoreConformanceFactories,
} from "@opencut/editor-contracts/conformance/fakes";

import { AlienProjectStore } from "./alien-store";

export function createAdapterProjectStore(): AlienProjectStore {
	return new AlienProjectStore();
}

export function createAdapterProjectStoreConformanceFactories(): ProjectStoreConformanceFactories {
	return createProjectStoreConformanceFactories({
		createStore: createAdapterProjectStore,
	});
}
