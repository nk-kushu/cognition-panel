import type { IResultContract, ValidationResult } from "kushibot";

export type ConversationTurn = Readonly<{ role: "user" | "agent"; text: string }>;

/** One chat message with the earlier turns of its thread, oldest first. */
export type AssistantRequest = Readonly<{ message: string; conversation: readonly ConversationTurn[] }>;

/** The final value of every capability's session. */
export type AssistantAnswer = Readonly<{ answer: string }>;

export class AssistantRequestContract implements IResultContract<AssistantRequest> {
  readonly id = "cognition-assistant-request";
  readonly version = "1";
  async validate(raw: unknown): Promise<ValidationResult<AssistantRequest>> {
    const value = raw as { message?: unknown; conversation?: unknown } | null;
    const conversation = Array.isArray(value?.conversation) ? value.conversation : null;
    if (
      typeof value?.message === "string" &&
      value.message.trim() &&
      conversation?.every(
        (turn: { role?: unknown; text?: unknown }) => (turn.role === "user" || turn.role === "agent") && typeof turn.text === "string",
      )
    )
      return { valid: true, value: { message: value.message.trim(), conversation: conversation as ConversationTurn[] } };
    return { valid: false, issues: [{ path: ["message"], code: "MESSAGE_REQUIRED", message: "Write a message." }] };
  }
}

export class AssistantAnswerContract implements IResultContract<AssistantAnswer> {
  readonly id = "cognition-assistant-answer";
  readonly version = "1";
  async validate(raw: unknown): Promise<ValidationResult<AssistantAnswer>> {
    const answer = (raw as { answer?: unknown } | null)?.answer;
    if (typeof answer === "string" && answer.trim()) return { valid: true, value: { answer } };
    return {
      valid: false,
      issues: [{ path: ["answer"], code: "ANSWER_REQUIRED", message: 'Return {"answer": "<markdown>"}.' }],
    };
  }
}
