import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuotePage from "../../app/projects/[id]/quote/page";
const mockUseQuery = vi.fn();
const mockUseAction = vi.fn();
const mockUseMutation = vi.fn();

vi.mock("next/navigation", () => ({
    useParams: () => ({ id: "proj_123" }),
}));

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
    useAction: (...args: unknown[]) => mockUseAction(...args),
    useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));

const quotes = [
    {
        _id: "q2",
        version: 2,
        internalBreakdownJson: JSON.stringify([{ label: "Line item", amount: 1000, currency: "ILS" }]),
        clientDocumentText: "Client doc v2",
        currency: "ILS",
        totalAmount: 1000,
        createdAt: new Date("2024-01-02").getTime(),
    },
    {
        _id: "q1",
        version: 1,
        internalBreakdownJson: JSON.stringify([{ label: "Item", amount: 500, currency: "ILS" }]),
        clientDocumentText: "Client doc v1",
        currency: "ILS",
        totalAmount: 500,
        createdAt: new Date("2024-01-01").getTime(),
    },
] as const;

describe("QuotePage", () => {
    const runAgent = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        mockUseQuery.mockReset();
        mockUseAction.mockReset();
        mockUseMutation.mockReset();
        runAgent.mockReset();
        let projectQueries = 0;
        mockUseQuery.mockImplementation((_fn: unknown, args: unknown) => {
            const asRecord = args as Record<string, unknown> | undefined;
            const quoteId = asRecord?.quoteId;
            if (typeof quoteId === "string") {
                const quote = quotes.find((q) => q._id === quoteId) ?? quotes[0];
                return {
                    quote,
                    project: { name: "Proj", clientName: "Client" },
                    breakdown: JSON.parse(quote.internalBreakdownJson),
                    brandingLogoUrl: null,
                    quoteFooterHebrew: "",
                    pdfUrl: null,
                };
            }

            if (typeof asRecord?.projectId === "string") {
                projectQueries++;
                if (projectQueries % 2 === 1) return quotes; // listQuotes
                return {
                    project: { currency: "ILS" },
                    sections: [],
                    totals: { plannedClientPrice: 0 },
                }; // accounting
            }

            return undefined;
        });
        mockUseAction.mockReturnValue(runAgent);
        mockUseMutation.mockReturnValue(vi.fn());
        writeText.mockClear();

        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
            writable: true,
        });
    });

    it("allows selecting historical quotes to update preview", async () => {
        render(<QuotePage />);

        expect(screen.getByText(/Quote v2/)).toBeInTheDocument();
        await userEvent.click(screen.getByText(/Version 1/));
        expect(screen.getByText(/Quote v1/)).toBeInTheDocument();
        expect(screen.getByText("Client doc v1")).toBeInTheDocument();
    });

    it("copies the selected quote when copying", async () => {
        render(<QuotePage />);

        await userEvent.click(screen.getByText("Copy"));

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain("Quote v2");
    });
});
