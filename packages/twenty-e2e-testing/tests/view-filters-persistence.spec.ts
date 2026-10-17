import { type Page } from '@playwright/test';
import { expect, test } from '../lib/fixtures/screenshot';

const UNSAVED_VIEW_FILTERS_STORAGE_KEY = 'unsavedViewFiltersByViewIdState';

const getUnsavedViewFiltersByViewId = async (page: Page) =>
  page.evaluate(
    (storageKey) => JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'),
    UNSAVED_VIEW_FILTERS_STORAGE_KEY,
  );

const getViewPickerButton = (page: Page, viewName: string) =>
  page.getByRole('button', { name: new RegExp(viewName) }).first();

const getFilterChips = (page: Page) =>
  page.locator('[data-testid^="remove-icon-"]');

const getResetButton = (page: Page) =>
  page.getByRole('button', { name: 'Reset', exact: true });

const getSaveAsNewViewButton = (page: Page) =>
  page.getByRole('button', { name: 'Save as new view' });

const openCompaniesIndex = async (page: Page) => {
  await page.getByRole('link', { name: 'Companies' }).click();
  await expect(getViewPickerButton(page, 'All Companies')).toBeVisible();
};

const reloadPage = async (page: Page, viewName: string) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(getViewPickerButton(page, viewName)).toBeVisible({
    timeout: 45_000,
  });
};

const addTextFilter = async (page: Page, fieldLabel: string, value: string) => {
  await page.getByText('Filter', { exact: true }).click();
  await page.getByPlaceholder('Search fields').fill(fieldLabel);
  await page.getByText(fieldLabel, { exact: true }).last().click();
  await page.keyboard.type(value);
  await page.keyboard.press('Escape');
};

const expectUnsavedFilterCount = async (page: Page, filterCount: number) => {
  await expect(getFilterChips(page)).toHaveCount(filterCount);
  await expect(getResetButton(page)).toBeVisible();
  await expect(getSaveAsNewViewButton(page)).toBeVisible();
};

const expectNoUnsavedFilters = async (page: Page) => {
  await expect(getFilterChips(page)).toHaveCount(0);
  await expect(getResetButton(page)).not.toBeVisible();
  expect(await getUnsavedViewFiltersByViewId(page)).toEqual({});
};

test.describe('View filters persistence', () => {
  test.beforeEach(async ({ page }) => {
    await openCompaniesIndex(page);
  });

  test('keeps an unsaved filter after a page refresh', async ({ page }) => {
    await addTextFilter(page, 'Name', 'an');
    await expectUnsavedFilterCount(page, 1);

    const unsavedViewFiltersByViewId =
      await getUnsavedViewFiltersByViewId(page);
    expect(Object.keys(unsavedViewFiltersByViewId)).toHaveLength(1);

    await reloadPage(page, 'All Companies');

    await expectUnsavedFilterCount(page, 1);
    expect(await getUnsavedViewFiltersByViewId(page)).toEqual(
      unsavedViewFiltersByViewId,
    );
  });

  test('keeps an unsaved filter after navigating away and back', async ({
    page,
  }) => {
    await addTextFilter(page, 'Name', 'an');
    await expectUnsavedFilterCount(page, 1);

    await page.getByRole('link', { name: 'People' }).click();
    await expect(getViewPickerButton(page, 'All People')).toBeVisible();
    await expect(getFilterChips(page)).toHaveCount(0);

    await page.getByRole('link', { name: 'Companies' }).click();

    await expectUnsavedFilterCount(page, 1);
  });

  test('keeps several unsaved filters after a page refresh', async ({
    page,
  }) => {
    await addTextFilter(page, 'Name', 'an');
    await addTextFilter(page, 'Domain Name', 'com');
    await expectUnsavedFilterCount(page, 2);

    await reloadPage(page, 'All Companies');

    await expectUnsavedFilterCount(page, 2);
  });

  test('forgets the unsaved filter after Reset', async ({ page }) => {
    await addTextFilter(page, 'Name', 'an');
    await expectUnsavedFilterCount(page, 1);

    await getResetButton(page).click();
    await expectNoUnsavedFilters(page);

    await reloadPage(page, 'All Companies');
    await expectNoUnsavedFilters(page);
  });

  test('forgets the unsaved filters once every chip is removed', async ({
    page,
  }) => {
    await addTextFilter(page, 'Name', 'an');
    await addTextFilter(page, 'Domain Name', 'com');
    await expectUnsavedFilterCount(page, 2);

    await getFilterChips(page).first().click();
    await expectUnsavedFilterCount(page, 1);

    await getFilterChips(page).first().click();
    await expectNoUnsavedFilters(page);

    await reloadPage(page, 'All Companies');
    await expectNoUnsavedFilters(page);
  });

  test('moves the unsaved filter to the new view on Save as new view', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const newViewName = `Saved filters ${Date.now()}`;

    await addTextFilter(page, 'Name', 'an');
    await expectUnsavedFilterCount(page, 1);

    await getSaveAsNewViewButton(page).click();
    await page.getByRole('textbox').press('ControlOrMeta+a');
    await page.getByRole('textbox').fill(newViewName);
    await page.getByRole('button', { name: 'Create new view' }).click();

    await expect(getViewPickerButton(page, newViewName)).toBeVisible();
    await expect(getFilterChips(page)).toHaveCount(1);
    await expect(getResetButton(page)).not.toBeVisible();
    expect(await getUnsavedViewFiltersByViewId(page)).toEqual({});

    await getViewPickerButton(page, newViewName).click();
    await page.getByText('All Companies', { exact: true }).last().click();
    await expect(getViewPickerButton(page, 'All Companies')).toBeVisible();
    await expectNoUnsavedFilters(page);

    await reloadPage(page, 'All Companies');
    await expectNoUnsavedFilters(page);

    await getViewPickerButton(page, 'All Companies').click();
    await page.getByText(newViewName, { exact: true }).last().click();
    await expect(getViewPickerButton(page, newViewName)).toBeVisible();
    await expect(getFilterChips(page)).toHaveCount(1);
    await expect(getResetButton(page)).not.toBeVisible();

    const newViewId = new URL(page.url()).searchParams.get('viewId');

    if (newViewId === null) {
      throw new Error('The new view id is missing from the URL');
    }

    await addTextFilter(page, 'Domain Name', 'com');
    await expect(getFilterChips(page)).toHaveCount(2);
    expect(await getUnsavedViewFiltersByViewId(page)).toHaveProperty(newViewId);

    await getViewPickerButton(page, newViewName).click();
    await page.getByRole('button', { name: newViewName, exact: true }).hover();
    await page
      .locator(`[aria-controls="view-picker-options-${newViewId}-options"]`)
      .click();
    await page.getByText('Delete', { exact: true }).click();

    await expect(getViewPickerButton(page, 'All Companies')).toBeVisible();
    await expect(page.getByText(newViewName, { exact: true })).toHaveCount(0);
    await expect
      .poll(() => getUnsavedViewFiltersByViewId(page))
      .not.toHaveProperty(newViewId);

    await reloadPage(page, 'All Companies');
    await getViewPickerButton(page, 'All Companies').click();
    await expect(page.getByText(newViewName, { exact: true })).toHaveCount(0);
  });
});
