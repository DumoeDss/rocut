import { expect, test } from "bun:test";
import { getEditorMessages } from "./editor-messages";

test("language is session input with Chinese default and English fallback", () => {
	expect(getEditorMessages().saved).toBe("已保存");
	expect(getEditorMessages("zh-TW").saved).toBe("已保存");
	expect(getEditorMessages("en-US").saved).toBe("Saved");
	expect(getEditorMessages("fr-FR").saved).toBe("Saved");
	expect(getEditorMessages("en").library).toBe("Project library");
	expect(getEditorMessages().saved).toBe("已保存");
});
