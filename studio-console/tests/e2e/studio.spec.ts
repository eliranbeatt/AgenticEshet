
import { test, expect } from "@playwright/test";

// Must be a valid-shaped Convex Id to avoid client-side ArgumentValidationError.
const PROJECT_ID = "jx72f973qdthtwbbmwjhvskvkn7xvkte";

test.describe("Studio page smoke", () => {
    test("renders without crashing", async ({ page }) => {
        // Smoke-only: should not require backend data.
        await page.goto(`/projects/${PROJECT_ID}/studio`);

        // If a backend is connected + the project exists, we may see the Studio UI.
        // Otherwise, the project layout may show loading/not-found.
        await expect(page.locator("body")).toContainText(
            /(Studio Agent|Loading project|Project not found|Missing Convex configuration)/i,
            { timeout: 15000 }
        );
    });
});
