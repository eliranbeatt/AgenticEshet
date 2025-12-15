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
    const alertSpy = vi.fn();

    beforeEach(() => {
        mockUseQuery.mockReset();
        mockUseAction.mockReset();
        mockUseMutation.mockReset();
        runAgent.mockReset();
        mockUseQuery.mockReturnValue(quotes);
        mockUseAction.mockReturnValue(runAgent);
        mockUseMutation.mockReturnValue(vi.fn());
        writeText.mockClear();
        alertSpy.mockClear();

        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
            writable: true,
        });
        Object.defineProperty(window, "alert", {
            value: alertSpy,
            configurable: true,
            writable: true,
        });
    });

    it("allows selecting historical quotes to update preview", async () => {
        render(<QuotePage />);

        expect(screen.getByText(/Quote Breakdown \(v2\)/)).toBeInTheDocument();
        await userEvent.click(screen.getByText(/Version 1/));
        expect(screen.getByText(/Quote Breakdown \(v1\)/)).toBeInTheDocument();
        expect(screen.getByText("Client doc v1")).toBeInTheDocument();
    });

    it("copies the selected quote when exporting", async () => {
        render(<QuotePage />);

        await userEvent.click(screen.getByText("Export"));

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain("Quote v2");
        expect(alertSpy).toHaveBeenCalledWith("Quote copied to clipboard.");
    });
});
