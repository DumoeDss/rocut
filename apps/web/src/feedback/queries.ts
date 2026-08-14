import { db, feedback } from "@/db";
import { generateUUID } from "@opencut/editor-classic";
import type { FeedbackEntry, SubmitFeedbackInput } from "@opencut/editor-classic";

export async function submitFeedback({
	message,
}: SubmitFeedbackInput): Promise<FeedbackEntry> {
	const id = generateUUID();
	const now = new Date();

	await db.insert(feedback).values({ id, message, createdAt: now });

	return { id, message, createdAt: now.toISOString() };
}
