import ts from "typescript";

// Inspect executable syntax, not a marker in a comment or an uncalled helper.
export function hasEnforcedBuildToolchain(source) {
	const file = ts.createSourceFile(
		"build-wasm.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	if (file.parseDiagnostics.length) return false;
	const imported = file.statements.find(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === "./wasm-toolchain.mjs",
	);
	const bindings = imported?.importClause?.namedBindings;
	if (!bindings || !ts.isNamedImports(bindings)) return false;
	const assertion = bindings.elements.find(
		(element) =>
			(element.propertyName ?? element.name).text === "assertToolchain",
	);
	if (!assertion) return false;
	const build = file.statements.find(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "buildWasm",
	);
	if (!build?.body) return false;
	const options = build.parameters[1]?.name;
	if (!options || !ts.isObjectBindingPattern(options)) return false;
	const pins = options.elements.find(
		(element) =>
			ts.isIdentifier(element.name) && element.name.text === "assertPins",
	);
	if (
		!pins?.initializer ||
		!ts.isIdentifier(pins.initializer) ||
		pins.initializer.text !== assertion.name.text
	)
		return false;
	const statements = [...build.body.statements];
	const branchIndex = statements.findIndex((statement) => {
		if (
			!ts.isIfStatement(statement) ||
			!ts.isBinaryExpression(statement.expression)
		)
			return false;
		const condition = statement.expression;
		if (
			condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
			condition.left.getText(file) !==
				"process.env.OPENCUT_WASM_ALLOW_UNPINNED" ||
			!ts.isStringLiteral(condition.right) ||
			condition.right.text !== "1"
		)
			return false;
		const block = statement.elseStatement;
		return (
			block &&
			ts.isBlock(block) &&
			block.statements.some(
				(entry) =>
					ts.isExpressionStatement(entry) &&
					ts.isCallExpression(entry.expression) &&
					ts.isIdentifier(entry.expression.expression) &&
					entry.expression.expression.text === "assertPins" &&
					entry.expression.arguments.length === 0,
			)
		);
	});
	const runIndex = statements.findIndex(
		(statement) =>
			ts.isVariableStatement(statement) &&
			statement.declarationList.declarations.some((declaration) => {
				const call = declaration.initializer;
				return (
					call &&
					ts.isCallExpression(call) &&
					ts.isIdentifier(call.expression) &&
					call.expression.text === "run" &&
					ts.isStringLiteral(call.arguments[0]) &&
					call.arguments[0].text === "wasm-pack"
				);
			}),
	);
	return branchIndex >= 0 && runIndex > branchIndex;
}
