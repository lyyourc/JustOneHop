import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'docs/demo');
await mkdir(outputDir, { recursive: true });

async function browserPath() {
  if (process.env.JUSTONEHOP_CHROMIUM_PATH) return process.env.JUSTONEHOP_CHROMIUM_PATH;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  for (const dir of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    const executable = join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    try { await access(executable); return executable; } catch {}
  }
  throw new Error('Install Playwright Chromium or set JUSTONEHOP_CHROMIUM_PATH.');
}

const executablePath = await browserPath();
const messages = Object.fromEntries(await Promise.all(['en', 'zh'].map(async lang => [lang,
  JSON.parse(await readFile(join(root, `public/_locales/${lang === 'zh' ? 'zh_CN' : 'en'}/messages.json`), 'utf8'))])));

const iconSvgs = {
  github: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#181717"/>
    <path fill="#ffffff" d="M32 13c-10.5 0-19 8.5-19 19 0 8.4 5.44 15.52 13 18.03.95.17 1.3-.41 1.3-.91 0-.45-.02-1.95-.03-3.53-5.28 1.15-6.4-2.24-6.4-2.24-.86-2.2-2.11-2.78-2.11-2.78-1.73-1.18.13-1.16.13-1.16 1.91.13 2.92 1.96 2.92 1.96 1.7 2.91 4.46 2.07 5.54 1.58.17-1.23.67-2.07 1.21-2.55-4.22-.48-8.65-2.11-8.65-9.39 0-2.07.74-3.77 1.96-5.1-.2-.48-.85-2.41.19-5.02 0 0 1.6-.51 5.22 1.95a18.1 18.1 0 0 1 9.5 0c3.63-2.46 5.23-1.95 5.23-1.95 1.03 2.61.38 4.54.19 5.02 1.22 1.33 1.95 3.03 1.95 5.1 0 7.3-4.44 8.9-8.67 9.37.68.59 1.29 1.75 1.29 3.52 0 2.55-.02 4.6-.02 5.22 0 .51.34 1.1 1.31.91C45.56 47.51 51 40.4 51 32c0-10.5-8.5-19-19-19Z"/>
  </svg>`,
  claude: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#d97757"/>
    <g stroke="#fff7f2" stroke-width="4.2" stroke-linecap="round">
      <line x1="32" y1="14" x2="32" y2="50"/>
      <line x1="14" y1="32" x2="50" y2="32"/>
      <line x1="19.3" y1="19.3" x2="44.7" y2="44.7"/>
      <line x1="44.7" y1="19.3" x2="19.3" y2="44.7"/>
      <line x1="25" y1="15.4" x2="39" y2="48.6"/>
      <line x1="15.4" y1="25" x2="48.6" y2="39"/>
    </g>
    <circle cx="32" cy="32" r="5.5" fill="#d97757"/>
    <circle cx="32" cy="32" r="3.2" fill="#fff7f2"/>
  </svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#0f1419"/>
    <path fill="#ffffff" d="M35.7 29.2 47.2 16h-2.73L34.48 27.45 26.5 16H17.3l12.08 17.58L17.3 47.6h2.73l10.56-12.28 8.44 12.28h9.2L35.7 29.2Zm-3.73 4.34-1.22-1.75-9.74-13.93h4.19l7.85 11.23 1.22 1.75 10.2 14.6h-4.19l-8.31-11.9Z"/>
  </svg>`,
  figma: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#1e1e1e"/>
    <path d="M25 14h7v12h-7a6 6 0 0 1 0-12Z" fill="#f24e1e"/>
    <path d="M32 14h7a6 6 0 0 1 0 12h-7V14Z" fill="#ff7262"/>
    <path d="M25 26h7v12h-7a6 6 0 0 1 0-12Z" fill="#a259ff"/>
    <circle cx="38" cy="32" r="6" fill="#1abcfe"/>
    <path d="M25 38h7v6a6 6 0 0 1-12 0 6 6 0 0 1 5-6Z" fill="#0acf83"/>
  </svg>`,
  linear: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#5e6ad2"/>
    <circle cx="32" cy="32" r="16" fill="none" stroke="#ffffff" stroke-width="3.8"/>
    <path d="M20 44 L44 20 M17 36 L36 17 M28 47 L47 28" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round"/>
  </svg>`,
  youtube: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#ff0033"/>
    <rect x="13" y="19" width="38" height="26" rx="7" fill="#ffffff"/>
    <path d="M28 25.5v13l11-6.5Z" fill="#ff0033"/>
  </svg>`,
  chatgpt: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#10a37f"/>
    <g fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="32" cy="23" r="8"/>
      <circle cx="40" cy="28" r="8"/>
      <circle cx="40" cy="37" r="8"/>
      <circle cx="32" cy="41" r="8"/>
      <circle cx="24" cy="37" r="8"/>
      <circle cx="24" cy="28" r="8"/>
    </g>
  </svg>`,
  vercel: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#111111"/>
    <path d="M32 16 49 45H15Z" fill="#ffffff"/>
  </svg>`,
  mcp: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#0b57d0"/>
    <path d="M22 24h20M22 32h20M22 40h13" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`,
  hn: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="14" fill="#ff6600"/>
    <path d="M21 18h5.5l5.5 11.5L37.5 18H43l-8.5 16.5V46h-5V34.5L21 18Z" fill="#ffffff"/>
  </svg>`,
};

const faviconBuffers = Object.fromEntries(
  await Promise.all(Object.entries(iconSvgs).map(async ([k, svg]) => [k, await sharp(Buffer.from(svg)).png().toBuffer()]))
);

const scenes = {
  en: [
    ['claude', 'https://claude.ai/chat/mcp-server-guide', 'Claude · Debugging MCP Server tool calls & streaming', 'open', true],
    ['github', 'https://github.com/anthropics/claude-code', 'anthropics/claude-code · Agentic coding tool in your terminal', 'open', false],
    ['x', 'https://x.com/karpathy/status/18940129', 'Andrej Karpathy on X: "Claude Code and local dev workflows..."', 'open', false],
    ['figma', 'https://www.figma.com/design/chrome-cr2023-ui', 'Figma · Chrome CR2023 UI Kit & Color Tokens', 'open', false],
    ['linear', 'https://linear.app/team/issue/ENG-204', 'ENG-204 · Optimize command palette keyboard latency', 'open', false],
    ['chatgpt', 'https://chatgpt.com/c/typescript-fuzzy-search', 'ChatGPT · TypeScript fuzzy search ranking benchmark', 'open', false],
    ['vercel', 'https://vercel.com/team/justonehop/deployments', 'justonehop-web · Production Deployment Ready', 'open', false],
    ['mcp', 'https://modelcontextprotocol.io/quickstart', 'Claude Model Context Protocol (MCP) · Official Quickstart', 'bookmark', false],
    ['youtube', 'https://www.youtube.com/watch?v=claude-code-demo', 'YouTube · Claude Code & Browser Workflow in 10 Minutes', 'history', false],
    ['hn', 'https://news.ycombinator.com/item?id=431829', 'Show HN: Building local-first browser tools with Claude', 'history', false],
  ],
  zh: [
    ['claude', 'https://claude.ai/chat/mcp-server-guide', 'Claude · 调试 MCP Server 工具调用与流式响应', 'open', true],
    ['github', 'https://github.com/anthropics/claude-code', 'anthropics/claude-code · 终端 AI 编程工具与 PR 列表', 'open', false],
    ['x', 'https://x.com/karpathy/status/18940129', 'Andrej Karpathy on X: "Claude Code 与本地开发工作流..."', 'open', false],
    ['figma', 'https://www.figma.com/design/chrome-cr2023-ui', 'Figma · Chrome CR2023 组件库与色板规范', 'open', false],
    ['linear', 'https://linear.app/team/issue/ENG-204', 'ENG-204 · 优化命令面板键盘上下切换响应速度', 'open', false],
    ['chatgpt', 'https://chatgpt.com/c/typescript-fuzzy-search', 'ChatGPT · TypeScript 模糊搜索与排序权重对比', 'open', false],
    ['vercel', 'https://vercel.com/team/justonehop/deployments', 'justonehop-web · 生产环境部署状态与日志', 'open', false],
    ['mcp', 'https://modelcontextprotocol.io/quickstart', 'Claude MCP 协议官方文档 · 快速上手与配置指南', 'bookmark', false],
    ['youtube', 'https://www.youtube.com/watch?v=claude-code-demo', 'YouTube · 10 分钟上手 Claude Code 与浏览器工作流', 'history', false],
    ['hn', 'https://news.ycombinator.com/item?id=431829', 'Hacker News · 讨论：用 Claude 构建本地优先的浏览器工具', 'history', false],
  ],
};

const W = 750;
const H = 516;
const PAD = 20;
const OUT_W = W + PAD * 2;
const OUT_H = H + PAD * 2;

async function frameToRaw(pngBuf, theme) {
  const bg = theme === 'dark'
    ? { r: 22, g: 24, b: 29, alpha: 1 }
    : { r: 234, g: 240, b: 248, alpha: 1 };

  const resized = await sharp(pngBuf)
    .resize(W, H, { fit: 'contain', position: 'top', background: bg })
    .png()
    .toBuffer();

  // Add subtle backdrop around the 750x516 palette
  const compositeBuf = await sharp({
    create: { width: OUT_W, height: OUT_H, channels: 4, background: bg },
  })
    .composite([{ input: resized, left: PAD, top: PAD }])
    .raw()
    .toBuffer();

  return compositeBuf;
}

async function saveAnimatedGif(filename, frames, theme) {
  const rawBuffers = [];
  const delays = [];
  for (const f of frames) {
    rawBuffers.push(await frameToRaw(f.buf, theme));
    delays.push(f.delay);
  }
  const combined = Buffer.concat(rawBuffers);
  const outPath = join(outputDir, filename);
  await sharp(combined, {
    raw: {
      width: OUT_W,
      height: OUT_H * frames.length,
      channels: 4,
      pageHeight: OUT_H,
    },
  })
    .gif({
      delay: delays,
      loop: 0,
      colours: 128,
      dither: 0.4,
    })
    .toFile(outPath);
  console.log(`Generated ${filename} (${frames.length} frames)`);
}

for (const lang of ['en', 'zh']) {
  const profile = await mkdtemp(join(tmpdir(), 'justonehop-gif-'));
  let context;
  try {
    const extension = join(root, 'dist');
    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      locale: lang === 'zh' ? 'zh-CN' : 'en-US',
      reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });

    await context.route(/^https?:\/\//, async route => {
      const reqUrl = new URL(route.request().url());
      if (reqUrl.pathname.startsWith('/icon-')) {
        const key = reqUrl.pathname.replace('/icon-', '').replace('.png', '');
        if (faviconBuffers[key]) {
          await route.fulfill({ status: 200, contentType: 'image/png', body: faviconBuffers[key] });
          return;
        }
      }
      const scene = scenes[lang].find(([, pageUrl]) => pageUrl === reqUrl.href || pageUrl === reqUrl.origin + reqUrl.pathname);
      if (scene) {
        const [key, , title] = scene;
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" type="image/png" href="${reqUrl.origin}/icon-${key}.png"></head><body><h1>${title}</h1></body></html>`,
        });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
    });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async language => chrome.storage.local.set({ preferences: { language, theme: 'light', autoTuck: false } }), lang);

    for (const [, pageUrl, title, mode, pinned] of scenes[lang]) {
      const page = await context.newPage();
      await page.goto(pageUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(80);
      if (pinned) {
        await worker.evaluate(async url => {
          const [tab] = await chrome.tabs.query({ url });
          if (tab?.id) await chrome.tabs.update(tab.id, { pinned: true });
        }, pageUrl);
      }
      if (mode === 'bookmark') {
        await worker.evaluate(async ({ bmTitle, bmUrl }) => chrome.bookmarks.create({ title: bmTitle, url: bmUrl }), {
          bmTitle: title, bmUrl: pageUrl,
        });
        await page.close();
      } else if (mode === 'history') {
        await page.close();
      }
    }

    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url === 'about:blank' || tab.url?.startsWith('chrome://newtab')) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }
      }
    });

    const ui = await context.newPage();
    const popup = worker.url().replace('background.js', 'popup.html');
    const t = key => messages[lang][key].message;
    const input = () => ui.getByRole('combobox').first();
    const snap = async () => {
      await ui.mouse.move(W - 1, H - 1);
      await ui.waitForTimeout(80);
      return await ui.locator('.palette').screenshot({ animations: 'disabled' });
    };

    const hideSelfRow = async () => {
      await ui.addStyleTag({
        content: `.result:has([title*="popup.html"]), .result:has([title*="chrome-extension://"]) { display: none !important; }`,
      });
      await ui.locator('.result').evaluateAll(rows => {
        for (const row of rows) {
          if (row.textContent?.includes('chrome-extension://') || row.textContent?.includes('popup.html')) {
            row.style.display = 'none';
          }
        }
      });
    };

    // =========================================================================
    // GIF 1: Unified Search (Tabs + Bookmarks + History + Natural Commands)
    // =========================================================================
    await ui.emulateMedia({ colorScheme: 'light' });
    await ui.goto(popup, { waitUntil: 'networkidle' });
    await ui.waitForTimeout(200);
    await hideSelfRow();

    const searchFrames = [];
    // Frame 1: Home state
    searchFrames.push({ buf: await snap(), delay: 900 });

    // Frame 2-4: Typing "claude" to match Open Tabs, Bookmarks, and History
    for (const [part, delay] of [['cl', 220], ['clau', 220], ['claude', 1100]]) {
      await input().fill(part);
      await ui.waitForTimeout(120);
      searchFrames.push({ buf: await snap(), delay });
    }

    // Frame 5-6: Arrow down through Tab -> Bookmark -> History
    await ui.keyboard.press('ArrowDown');
    searchFrames.push({ buf: await snap(), delay: 550 });
    await ui.keyboard.press('ArrowDown');
    searchFrames.push({ buf: await snap(), delay: 900 });

    // Frame 7-8: Natural command search ("dark" or "深色")
    const cmdQuery = lang === 'zh' ? '深色' : 'dark mode';
    await input().fill(cmdQuery);
    await ui.waitForTimeout(120);
    searchFrames.push({ buf: await snap(), delay: 1300 });

    await saveAnimatedGif(`${lang}-search.gif`, searchFrames, 'light');

    // =========================================================================
    // GIF 2: Tab Organization & Actions Menu (⌘K / Right-click continuous tidy)
    // =========================================================================
    await input().fill('claude');
    await ui.waitForTimeout(150);
    const actionFrames = [];

    // Select second tab (anthropics/claude-code)
    await ui.keyboard.press('ArrowDown');
    actionFrames.push({ buf: await snap(), delay: 800 });

    // Open ⌘K action menu and hide experimental Tuck item
    await ui.locator('.result.tab').nth(1).click({ button: 'right' });
    await expect(ui.locator('.action-menu')).toBeVisible();
    await ui.locator('.action-row').evaluateAll((els, tuckLabel) => {
      for (const el of els) {
        if (el.textContent?.includes(tuckLabel)) el.style.display = 'none';
      }
    }, t('tuck'));
    actionFrames.push({ buf: await snap(), delay: 950 });

    // Navigate down in action menu (Copy URL -> Pin Tab -> Mute Tab)
    await ui.keyboard.press('ArrowDown');
    actionFrames.push({ buf: await snap(), delay: 550 });
    await ui.keyboard.press('ArrowDown');
    actionFrames.push({ buf: await snap(), delay: 850 });

    // Execute Pin Tab (second item is Pin Tab) -> go back one item and hit Enter
    await ui.keyboard.press('ArrowUp');
    actionFrames.push({ buf: await snap(), delay: 500 });
    await ui.keyboard.press('Enter');
    await ui.waitForTimeout(180);
    // Palette stays open with tab now pinned!
    actionFrames.push({ buf: await snap(), delay: 1400 });

    await saveAnimatedGif(`${lang}-actions.gif`, actionFrames, 'light');

    // =========================================================================
    // GIF 3: Recent Tab Switcher (Dark Mode MRU Cycling + Instant Filter)
    // =========================================================================
    await worker.evaluate(async language => chrome.storage.local.set({ preferences: { language, theme: 'dark', autoTuck: false } }), lang);
    await ui.emulateMedia({ colorScheme: 'dark' });
    await ui.reload({ waitUntil: 'networkidle' });
    await ui.waitForTimeout(200);
    await input().fill('tab switcher');
    await ui.locator('.result').filter({ hasText: t('recentSwitcher') }).first().click();
    await expect(ui.locator('.recent-switcher')).toBeVisible();
    await hideSelfRow();

    const switcherFrames = [];
    switcherFrames.push({ buf: await snap(), delay: 850 });

    // Cycle down through MRU tabs
    await ui.keyboard.press('ArrowDown');
    switcherFrames.push({ buf: await snap(), delay: 500 });
    await ui.keyboard.press('ArrowDown');
    switcherFrames.push({ buf: await snap(), delay: 500 });
    await ui.keyboard.press('ArrowDown');
    switcherFrames.push({ buf: await snap(), delay: 850 });

    // Click search bar to pause release-to-switch and filter by typing "linear"
    await input().click();
    await input().fill('linear');
    await ui.waitForTimeout(120);
    switcherFrames.push({ buf: await snap(), delay: 1300 });

    await saveAnimatedGif(`${lang}-switcher.gif`, switcherFrames, 'dark');
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}
