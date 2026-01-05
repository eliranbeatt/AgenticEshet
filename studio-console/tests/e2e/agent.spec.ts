import { test, expect } from "@playwright/test";

// These tests require a working Convex backend with the updated functions deployed.
// Enable explicitly when your environment is ready.
const E2E_WITH_BACKEND = process.env.E2E_WITH_BACKEND === "1";

test.describe("Agent page (manual/workflow + shortcuts)", () => {
    test.skip(!E2E_WITH_BACKEND, "Set E2E_WITH_BACKEND=1 to run backend-dependent tests.");

    test("manual mode: Continue yields suggestions; Alt+1 runs first suggestion", async ({ page }) => {
        test.setTimeout(120_000);

        // Create a project from the Projects page.
        await page.goto("/projects");
        await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 30_000 });

        // Optionally seed skills (safe to run multiple times; confirm dialog).
        page.on("dialog", async (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Initialize System" }).click();

        await page.getByRole("button", { name: /New Project/i }).click();
        await expect(page).toHaveURL(/\/projects\/[^/]+\/overview/, { timeout: 30_000 });

        const match = page.url().match(/\/projects\/([^/]+)\/overview/);
        expect(match, "Expected project id in URL").toBeTruthy();
        const projectId = match![1];

        // Go to Agent page.
        await page.goto(`/projects/${projectId}/agent`);

        // Create/select a conversation thread.
        await page.getByRole("button", { name: "New" }).click();

        // Ensure mode is Manual.
        await page.getByTestId("agent-mode").selectOption("manual");

        // Trigger continue (keyboard: Enter on empty input).
        const composer = page.getByPlaceholder("Tell the agent what to do next");
        await composer.click();
        await composer.press("Enter");

        // Wait for suggestions to appear.
        const suggestions = page.getByTestId("agent-suggestions");
        await expect(suggestions).not.toContainText("No suggestions yet.", { timeout: 60_000 });

        const first = page.getByTestId("agent-suggestion-1");
        await expect(first).toBeVisible();
        const skillKey = await first.getAttribute("data-skill-key");
        expect(skillKey, "Expected first suggestion to carry data-skill-key").toBeTruthy();

        // Alt+1 runs the first suggestion.
        await composer.press("Alt+1");

        // Verify the Skill selector reflects the chosen skill.
        await expect(page.getByLabel("Skill")).toHaveValue(skillKey!, { timeout: 30_000 });
    });

    test("workflow mode: suggestions are disabled with reason", async ({ page }) => {
        test.setTimeout(120_000);

        await page.goto("/projects");
        await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 30_000 });

        // Create a project.
        await page.getByRole("button", { name: /New Project/i }).click();
        await expect(page).toHaveURL(/\/projects\/[^/]+\/overview/, { timeout: 30_000 });

        const match = page.url().match(/\/projects\/([^/]+)\/overview/);
        expect(match, "Expected project id in URL").toBeTruthy();
        const projectId = match![1];

        await page.goto(`/projects/${projectId}/agent`);
        await page.getByRole("button", { name: "New" }).click();

        // Trigger one Continue to populate suggestions.
        await page.getByTestId("agent-continue").click();
        const suggestions = page.getByTestId("agent-suggestions");
        await expect(suggestions).not.toContainText("No suggestions yet.", { timeout: 60_000 });

        // Switch to workflow.
        await page.getByTestId("agent-mode").selectOption("workflow");

        const first = page.getByTestId("agent-suggestion-1");
        await expect(first).toBeVisible();
        await expect(first).toBeDisabled();

        // Tooltip reason is surfaced via title.
        await expect(first).toHaveAttribute("title", /Workflow mode/i);
    });
});
