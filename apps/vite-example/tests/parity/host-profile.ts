import type { Page } from "@playwright/test";

/**
 * The only host-specific part of the parity scenario.
 *
 * Everything after "the editor is on screen" is identical for both hosts,
 * because it is the same editor source. Reaching that point is not: the Vite
 * example keeps the open project in `?project=<id>` and renders its own picker,
 * while `apps/web` routes to `/editor/<id>` from `/projects`.
 */
export type HostName = "vite" | "next";

export const HOST: HostName =
	process.env.PARITY_HOST === "next" ? "next" : "vite";

export interface HostProfile {
	name: HostName;
	/** Where a fresh browser context should land to create a project. */
	entryPath: string;
	/** Click whatever this host calls "create a project". */
	createProject: (page: Page) => Promise<void>;
	/**
	 * The name the *host* gives a newly created project. It differs between the
	 * two hosts and is host-supplied, not editor behaviour — the deviation report
	 * classifies it as incidental rather than normalizing it away.
	 */
	newProjectName: string;
}

/**
 * Click, then confirm the click *did* something — retrying if it did not.
 *
 * `apps/web` prerenders `/projects`, so its "New project" button exists in the
 * served HTML and is visible, focusable and clickable **before React hydrates
 * and attaches the handler**. A click that lands in that window is silently
 * discarded: Playwright reports success and the page simply stays put, which
 * reads as "creating a project is broken". Waiting on the effect rather than on
 * the click is the only reliable fix; a fixed sleep just moves the race.
 */
async function clickUntil(
	page: Page,
	click: () => Promise<void>,
	done: () => Promise<boolean>,
	{ attempts = 6, waitMs = 15_000 } = {},
): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		await click();
		const deadline = Date.now() + waitMs;
		while (Date.now() < deadline) {
			if (await done()) return;
			await page.waitForTimeout(500);
		}
	}
	throw new Error(
		`the create-project control never took effect after ${attempts} attempts`,
	);
}

const VITE: HostProfile = {
	name: "vite",
	entryPath: "/",
	newProjectName: "Untitled Project",
	createProject: async (page) => {
		await clickUntil(
			page,
			() =>
				page
					.locator("button", { hasText: /^New project$/ })
					.first()
					.click(),
			// The example records the open project in `?project=<id>`.
			async () => page.url().includes("project="),
		);
	},
};

const NEXT: HostProfile = {
	name: "next",
	entryPath: "/projects",
	newProjectName: "New project",
	createProject: async (page) => {
		// A fresh browser context has an empty IndexedDB, so the project list is
		// empty and the only "New project" on the page is the create button. That
		// is why the scenario never reuses a profile.
		await clickUntil(
			page,
			() =>
				page
					.locator('button:has(span:text-is("New project"))')
					.first()
					.click(),
			async () => /\/editor\/[^/]+$/.test(new URL(page.url()).pathname),
		);
	},
};

export const HOST_PROFILE: HostProfile = HOST === "next" ? NEXT : VITE;
