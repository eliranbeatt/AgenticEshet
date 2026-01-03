
import { test, expect } from '@playwright/test';

test.describe('Studio Agent Page', () => {

  test('should load the Studio interface', async ({ page }) => {
    // Navigate to a project studio page (mock ID)
    await page.goto('/projects/123/studio');

    // Check for main layout elements
    await expect(page.getByText('Studio Agent')).toBeVisible(); // Header or similar
    await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Timeline' })).toBeVisible();
    
    // Check Top Bar controls
    await expect(page.getByLabel('Stage')).toBeVisible();
    await expect(page.getByLabel('Skill')).toBeVisible();
  });

  test('should trigger Autonomy Loop', async ({ page }) => {
    await page.goto('/projects/123/studio');

    // Click Continue (Auto)
    const continueBtn = page.getByRole('button', { name: /Continue/i });
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Expect some loading state
    await expect(page.getByText(/Thinking/i)).toBeVisible();

    // Expect a new message or event in timeline
    // (This depends on the backend actually responding, or mocking the API)
  });

  test('should show Question Gate', async ({ page }) => {
    // This assumes we can mock the backend state to return "STOP_QUESTIONS"
    // For now, we just document the intent.
    // await page.route('**/api/convex/controller.run', route => route.fulfill({ json: { status: "STOP_QUESTIONS", questions: [...] } }));
    
    // ...
  });
});
