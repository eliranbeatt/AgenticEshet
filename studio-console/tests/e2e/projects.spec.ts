import { test, expect } from "@playwright/test";

test("projects page renders header and actions", async ({ page }) => {
    await page.goto("/projects");

    await expect(page).toHaveURL(/\/projects$/);

    await expect(
        page.getByRole("heading", { name: "Projects" })
    ).toBeVisible({ timeout: 15000 });

    await expect(
        page.getByRole("button", { name: /New Project/i })
    ).toBeVisible();
});
