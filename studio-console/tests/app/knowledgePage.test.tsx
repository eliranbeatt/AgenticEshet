import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KnowledgePage from "../../app/projects/[id]/knowledge/page";

const apiMock = vi.hoisted(() => ({
    knowledge: {
        listDocs: Symbol("listDocs"),
        search: Symbol("searchKnowledge"),
    },
    ingestion: {
        listJobs: Symbol("listJobs"),
        createJob: Symbol("createJob"),
        generateUploadUrl: Symbol("generateUploadUrl"),
        registerFile: Symbol("registerFile"),
        runIngestionJob: Symbol("runIngestionJob"),
        processFile: Symbol("processFile"),
        commitIngestionJob: Symbol("commitIngestionJob"),
    },
}));

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockUseAction = vi.fn();

vi.mock("next/navigation", () => ({
    useParams: () => ({ id: "proj_test" }),
}));

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
    useMutation: (...args: unknown[]) => mockUseMutation(...args),
    useAction: (...args: unknown[]) => mockUseAction(...args),
}));

vi.mock("../../convex/_generated/api", () => ({ api: apiMock }));

describe("KnowledgePage ingestion flow", () => {
    const createJob = vi.fn();
    const generateUploadUrl = vi.fn();
    const registerFile = vi.fn();
    const runIngestionJob = vi.fn();

    beforeEach(() => {
        mockUseQuery.mockImplementation((fn) => {
            if (fn === apiMock.knowledge.listDocs) return [];
            if (fn === apiMock.ingestion.listJobs) return [];
            return undefined;
        });

        mockUseMutation.mockImplementation((fn) => {
            if (fn === apiMock.ingestion.createJob) return createJob;
            if (fn === apiMock.ingestion.generateUploadUrl) return generateUploadUrl;
            if (fn === apiMock.ingestion.registerFile) return registerFile;
            return vi.fn();
        });

        mockUseAction.mockImplementation((fn) => {
            if (fn === apiMock.ingestion.runIngestionJob) return runIngestionJob;
            return vi.fn();
        });

        createJob.mockReset();
        generateUploadUrl.mockReset();
        registerFile.mockReset();
        runIngestionJob.mockReset();

        createJob.mockResolvedValue("job_123");
        generateUploadUrl.mockResolvedValue("https://upload.example/post");
        registerFile.mockResolvedValue(undefined);
        runIngestionJob.mockResolvedValue(undefined);

        vi.spyOn(globalThis, "fetch").mockResolvedValue({
            json: async () => ({ storageId: "store_1" }),
        } as Response);

        vi.spyOn(window, "alert").mockImplementation(() => {});
    });

    it("uploads a rabbit brick doc and queues ingestion", async () => {
        render(<KnowledgePage />);

        await userEvent.click(screen.getByRole("button", { name: "Ingestion & Upload" }));

        await userEvent.clear(screen.getByLabelText("Job name"));
        await userEvent.type(screen.getByLabelText("Job name"), "Rabbit brick ingestion");

        await userEvent.type(screen.getByLabelText("Default tags"), "rabbits, bricks");
        await userEvent.type(screen.getByLabelText("Context for enhancer"), "Rabbits eating bricks in the garden.");

        const file = new File(["Rabbits eating bricks for dinner"], "rabbits.txt", { type: "text/plain" });
        const fileInput = screen.getByLabelText(/file/i);
        await userEvent.upload(fileInput, file);

        await userEvent.click(screen.getByRole("button", { name: "Upload & queue job" }));

        await waitFor(() => expect(createJob).toHaveBeenCalled());

        expect(createJob).toHaveBeenCalledWith({
            projectId: "proj_test",
            name: "Rabbit brick ingestion",
            defaultContext: "Rabbits eating bricks in the garden.",
            defaultTags: ["rabbits", "bricks"],
        });

        expect(generateUploadUrl).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith("https://upload.example/post", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: file,
        });
        expect(registerFile).toHaveBeenCalledWith({
            jobId: "job_123",
            storageId: "store_1",
            filename: "rabbits.txt",
            mimeType: "text/plain",
        });
        expect(runIngestionJob).toHaveBeenCalledWith({ jobId: "job_123" });
        expect(window.alert).toHaveBeenCalledWith("Files uploaded. The ingestion job is running now.");
    });
});
