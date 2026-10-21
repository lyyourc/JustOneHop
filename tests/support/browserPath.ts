import { chromium } from '@playwright/test';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export async function browserPath(
  expectedPath = chromium.executablePath(),
  override = process.env.JUSTONEHOP_CHROMIUM_PATH,
): Promise<string> {
  const path = override || expectedPath;
  try { await access(path, constants.X_OK); }
  catch (cause) {
    throw new Error(override
      ? `JUSTONEHOP_CHROMIUM_PATH is not executable: ${path}. Correct or unset the override.`
      : `Playwright's matching Chromium is missing or not executable: ${path}. Run npx playwright install chromium --no-shell --no-remove. Older cached browsers are not selected automatically.`, { cause });
  }
  return path;
}
