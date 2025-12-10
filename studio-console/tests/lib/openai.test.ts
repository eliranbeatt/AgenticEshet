import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const { parseMock } = vi.hoisted(() => ({
    parseMock: vi.fn(),
}));

vi.mock("openai", () => {
    class MockOpenAI {
        beta = {
            chat: {
                completions: {
                    parse: parseMock,
                },
            },
        };
    }
    return { default: MockOpenAI };
});

vi.mock("openai/helpers/zod", () => ({
    zodResponseFormat: () => ({}),
}));

import { callChatWithSchema } from "../../convex/lib/openai";

const schema = z.object({
    summary: z.string(),
});

describe("callChatWithSchema", () => {
    beforeEach(() => {
        parseMock.mockReset();
    });

    it("returns parsed content from OpenAI", async () => {
        parseMock.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        parsed: { summary: "All clear" },
                        refusal: null,
                    },
                },
            ],
        });

        const result = await callChatWithSchema(schema, {
            systemPrompt: "You are a helper",
            userPrompt: "Summarize",
            maxRetries: 1,
        });

        expect(result).toEqual({ summary: "All clear" });
        expect(parseMock).toHaveBeenCalledTimes(1);
    });

    it("retries on transient failures", async () => {
        parseMock
            .mockRejectedValueOnce(new Error("temporary"))
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            parsed: { summary: "Recovered" },
                            refusal: null,
                        },
                    },
                ],
            });

        const result = await callChatWithSchema(schema, {
            systemPrompt: "retry",
            userPrompt: "again",
            maxRetries: 3,
            retryDelayMs: 1,
        });

        expect(result).toEqual({ summary: "Recovered" });
        expect(parseMock).toHaveBeenCalledTimes(2);
    });
});
