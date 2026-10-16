import ts from "typescript";

/** Module dependencies of this file, excluding source code stored in strings. */
export function moduleSpecifiers({ path, text }) {
	const kind = /\.(?:tsx|jsx)$/.test(path)
		? ts.ScriptKind.TSX
		: /\.(?:js|mjs|cjs)$/.test(path)
			? ts.ScriptKind.JS
			: ts.ScriptKind.TS;
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		false,
		kind,
	);
	const references = [];
	const record = (node) => {
		if (!node || !ts.isStringLiteralLike(node)) return;
		references.push({
			specifier: node.text,
			line:
				source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
		});
	};
	const visit = (node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			record(node.moduleSpecifier);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		) {
			record(node.moduleReference.expression);
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument)
		) {
			record(node.argument.literal);
		} else if (ts.isCallExpression(node)) {
			const expression = node.expression;
			if (
				expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(expression) && expression.text === "require") ||
				(ts.isPropertyAccessExpression(expression) &&
					expression.name.text === "require")
			) {
				record(node.arguments[0]);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return references;
}
