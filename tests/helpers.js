// Shared helpers for the Playwright tests.

// Click a menu item by its label. Menu groups collapse, so open the item's group first if needed.
// scope: 'aside' (desktop sidebar) or '[data-drawer]' (phone menu).
async function goNav(page, label, scope = 'aside') {
  const item = page.locator(`${scope} button[data-nav-item]`).filter({ hasText: label }).first();
  if (!(await item.isVisible())) {
    const group = await item.getAttribute('data-group');
    await page.locator(`${scope} [data-group-toggle="${group}"]`).first().click();
    await item.waitFor({ state: 'visible' });
    await page.waitForTimeout(350); // let the open animation finish
  }
  await item.click();
  await page.waitForTimeout(100);
}

module.exports = { goNav };
