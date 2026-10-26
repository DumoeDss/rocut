import { afterEach, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { ReactMarkdownWrapper } from "../../components/ui/react-markdown-wrapper";
import { useCreatorDocument } from "./use-creator-document";
import type { CreatorDocument, CreatorWorkspaceSnapshot } from "./creator-workspace-types";

let root: Root | undefined;
let dom: JSDOM | undefined;
const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
const originals = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = undefined;
	dom?.window.close();
	globals.forEach((name, index) => {
		const descriptor = originals[index];
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	});
});

test("background snapshots do not restart a pinned read, but document and project changes do", async () => {
	dom = new JSDOM("<div id='root'></div>");
	Object.defineProperties(globalThis, Object.fromEntries([
		["window", dom.window], ["document", dom.window.document], ["navigator", dom.window.navigator], ["IS_REACT_ACT_ENVIRONMENT", true],
	].map(([key, value]) => [String(key), { value, configurable: true }])));
	const container = dom.window.document.getElementById("root")!;
	root = createRoot(container);
	let calls = 0;
	const pending: Array<(document: CreatorDocument) => void> = [];
	const source: CreatorDocument = { id: "plan", title: "Plan", group: "plan", revision: "3:hash", content: "", contentState: "unloaded" };
	function Probe({ revision, projectId = "project", doc = source }: { revision: string; projectId?: string; doc?: CreatorDocument }) {
		const snapshot = { projectId, revision, scopeRevision: `${revision}:1`, documents: [doc], assets: [] } as CreatorWorkspaceSnapshot;
		const value = useCreatorDocument({ ...doc }, () => {
			calls++;
			return new Promise((resolve) => pending.push(resolve));
		}, snapshot);
		return <div>{value.document.content || "loading"}</div>;
	}
	await act(async () => root!.render(<Probe revision="10" />));
	await act(async () => root!.render(<Probe revision="11" />));
	await act(async () => root!.render(<Probe revision="12" />));
	expect(calls).toBe(1);
	await act(async () => pending.shift()!({ ...source, contentState: undefined, content: "saved plan" }));
	expect(container.textContent).toBe("saved plan");
	await act(async () => root!.render(<Probe revision="13" />));
	expect(calls).toBe(1);
	expect(container.textContent).toBe("saved plan");
	await act(async () => root!.render(<Probe revision="14" doc={{ ...source, revision: "4:new" }} />));
	expect(calls).toBe(2);
	expect(container.textContent).toBe("loading");
	await act(async () => root!.render(<Probe revision="1" projectId="other" />));
	expect(calls).toBe(3);
	await act(async () => pending.shift()!({ ...source, revision: "4:new", contentState: undefined, content: "old scope" }));
	expect(container.textContent).toBe("loading");
	await act(async () => pending.shift()!({ ...source, contentState: undefined, content: "other project" }));
	expect(container.textContent).toBe("other project");
});

test("renders planning headings and GFM tables without executing embedded HTML", () => {
	const html = renderToStaticMarkup(<ReactMarkdownWrapper>{"# Plan\n\n| Shot | Time |\n| --- | --- |\n| S01 | 0–5 |\n\n<script>alert(1)</script>"}</ReactMarkdownWrapper>);
	expect(html).toContain("<h1>Plan</h1>");
	expect(html).toContain("<table>");
	expect(html).not.toContain("<script>");
});
