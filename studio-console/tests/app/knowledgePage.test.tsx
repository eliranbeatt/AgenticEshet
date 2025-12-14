import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KnowledgePage from "../../app/projects/[id]/knowledge/page";

const apiMock = vi.hoisted(() => ({
    knowledge: {
        listDocs: Symbol("listDocs"),
        dynamicSearch: Symbol("dynamicSearch"),
    },
    ingestion: {
        listJobs: Symbol("listJobs"),
        createJob: Symbol("createJob"),
        generateUploadUrl: Symbol("generateUploadUrl"),
        addFilesToJob: Symbol("addFilesToJob"),
        retryFile: Symbol("retryFile"),
        runJob: Symbol("runJob"),
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
    const addFilesToJob = vi.fn();
    const runJob = vi.fn();

    beforeEach(() => {
        mockUseQuery.mockImplementation((fn) => {
            if (fn === apiMock.knowledge.listDocs) return [];
            if (fn === apiMock.ingestion.listJobs) return [];
            return undefined;
        });

        mockUseMutation.mockImplementation((fn) => {
            if (fn === apiMock.ingestion.createJob) return createJob;
            if (fn === apiMock.ingestion.generateUploadUrl) return generateUploadUrl;
            if (fn === apiMock.ingestion.addFilesToJob) return addFilesToJob;
            return vi.fn();
        });

        mockUseAction.mockImplementation((fn) => {
            if (fn === apiMock.ingestion.runJob) return runJob;
            if (fn === apiMock.knowledge.dynamicSearch) return vi.fn();
            return vi.fn();
        });

        createJob.mockReset();
        generateUploadUrl.mockReset();
        addFilesToJob.mockReset();
        runJob.mockReset();

        createJob.mockResolvedValue("job_123");
        generateUploadUrl.mockResolvedValue("https://upload.example/post");
        addFilesToJob.mockResolvedValue(undefined);
        runJob.mockResolvedValue(undefined);

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
            sourceType: "upload",
        });

        expect(generateUploadUrl).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith("https://upload.example/post", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: file,
        });
        expect(addFilesToJob).toHaveBeenCalledWith({
            jobId: "job_123",
            files: [
                {
                    storageId: "store_1",
                    name: "rabbits.txt",
                    mimeType: "text/plain",
                    size: file.size,
                },
            ],
        });
        expect(runJob).toHaveBeenCalledWith({ jobId: "job_123" });
        expect(window.alert).toHaveBeenCalledWith("Files uploaded. The ingestion job is running now.");
    });
});
