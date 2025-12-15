import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const { responsesCreateMock } = vi.hoisted(() => ({
    responsesCreateMock: vi.fn(),
}));

vi.mock("openai", () => {
    class MockOpenAI {
        responses = {
            create: responsesCreateMock,
        };
    }
    return { default: MockOpenAI };
});

import { callChatWithSchema } from "../../convex/lib/openai";

const schema = z.object({
    summary: z.string(),
});

describe("callChatWithSchema", () => {
    beforeEach(() => {
        responsesCreateMock.mockReset();
    });

    it("returns parsed content from OpenAI", async () => {
        responsesCreateMock.mockResolvedValueOnce({
            output_text: JSON.stringify({ summary: "All clear" }),
            error: null,
        });

        const result = await callChatWithSchema(schema, {
            systemPrompt: "You are a helper",
            userPrompt: "Summarize",
            maxRetries: 1,
        });

        expect(result).toEqual({ summary: "All clear" });
        expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    });

    it("retries on transient failures", async () => {
        responsesCreateMock
            .mockRejectedValueOnce(new Error("temporary"))
            .mockResolvedValueOnce({
                output_text: JSON.stringify({ summary: "Recovered" }),
                error: null,
            });

        const result = await callChatWithSchema(schema, {
            systemPrompt: "retry",
            userPrompt: "again",
            maxRetries: 3,
            retryDelayMs: 1,
        });

        expect(result).toEqual({ summary: "Recovered" });
        expect(responsesCreateMock).toHaveBeenCalledTimes(2);
    });
});
