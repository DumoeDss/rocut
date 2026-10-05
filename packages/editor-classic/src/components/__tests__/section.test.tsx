import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "../section";

function markup({
	open,
	collapsible = true,
}: {
	open: boolean;
	collapsible?: boolean;
}) {
	return renderToStaticMarkup(
		<Section collapsible={collapsible} defaultOpen={open}>
			<SectionHeader>
				<SectionTitle>Format</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<input aria-label="Test choice" defaultValue="retained" />
			</SectionContent>
		</Section>,
	);
}

test("collapsed sections retain inputs but hide and inert their descendants", () => {
	const html = markup({ open: false });
	expect(html).toContain('inert=""');
	expect(html).toContain('aria-hidden="true"');
	expect(html).toContain('aria-expanded="false"');
	expect(html).toContain('value="retained"');
	const target = html.match(/aria-controls="([^"]+)"/)?.[1];
	expect(target).toBeDefined();
	expect(html).toContain('id="' + target + '"');
});

test("expanded and non-collapsible sections remain operable", () => {
	const expanded = markup({ open: true });
	expect(expanded).not.toContain("inert=");
	expect(expanded).toContain('aria-hidden="false"');
	expect(expanded).toContain('aria-expanded="true"');
	const plain = markup({ open: false, collapsible: false });
	expect(plain).not.toContain("inert=");
	expect(plain).not.toContain("aria-hidden=");
	expect(plain).not.toContain("aria-expanded=");
	expect(plain).toContain('value="retained"');
});
