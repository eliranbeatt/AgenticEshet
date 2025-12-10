import { test, expect } from "@playwright/test";

const PROJECT_ID = "proj_e2e";

test.describe("project flows", () => {
    test("overview route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/overview`);
        await expect(page.locator("body")).toContainText(/(Latest Brief Summary|Loading overview|Loading project|Project not found)/i);
    });

    test("clarification route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/clarification`);
        await expect(page.locator("body")).toContainText(/(Clarification|Agent Chat|Follow-up Questions|Loading project|Project not found)/i);
    });

    test("planning route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/planning`);
        await expect(page.locator("body")).toContainText(/(Planning Agent|Draft pending|No plan|Loading project|Project not found)/i);
    });

    test("tasks route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/tasks`);
        await expect(page.locator("body")).toContainText(/(Auto-Generate from Plan|Filter board by quest|Loading project|Project not found)/i);
    });

    test("quests route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/quests`);
        await expect(page.locator("body")).toContainText(/(Quests & Milestones|No quests defined|Loading project|Project not found)/i);
    });

    test("quote route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/quote`);
        await expect(page.locator("body")).toContainText(/(Quote Breakdown|No quote available|Generate Quote|Loading project|Project not found)/i);
    });

    test("trello view renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/trello-view`);
        await expect(page.locator("body")).toContainText(/(Trello Configuration|Sync Status|Snapshot|Loading project|Project not found)/i);
    });

    test("knowledge route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/knowledge`);
        await expect(page.locator("body")).toContainText(/(Documents|Ingestion & Upload|Search|Loading project|Project not found)/i);
    });

    test("history route renders", async ({ page }) => {
        await page.goto(`/projects/${PROJECT_ID}/history`);
        await expect(page.locator("body")).toContainText(/(Agent Interaction Log|Select a session|No history recorded yet|Loading project|Project not found)/i);
    });
});
