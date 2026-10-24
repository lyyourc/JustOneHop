import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/store');
const raw = join(output, 'raw');
await mkdir(raw, { recursive: true });

// Remove obsolete screenshots and localized promo tiles; the store shares promo tiles across locales.
for (const obsolete of ['zh-4-tuck.png', 'en-4-tuck.png', 'raw/zh-tuck.png', 'raw/en-tuck.png', 'zh-promo-440x280.png', 'zh-promo-1400x560.png']) {
  await rm(join(output, obsolete), { force: true });
}

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
const iconDataUris = Object.fromEntries(
  Object.entries(iconSvgs).map(([k, svg]) => [k, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`])
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

const evidence = {
  generatedAt: new Date().toISOString(),
  version: JSON.parse(await readFile(join(root, 'dist/manifest.json'), 'utf8')).version,
  source: 'Local dist extension files loaded into temporary profiles. Demonstration titles, URLs, learning records, storage values, and recreated site icons are fixtures. Runtime chrome.tabs.get/query are overridden to bind the capture page to a demo source tab and omit the capture tab; chrome.scripting.executeScript is overridden to return demo storage entries. These screenshots show the real rendered interface with mocked browser data and do not constitute integration test evidence. Browser chrome and webpage backgrounds are composed for presentation; the small promotional tile uses an illustrative search card.',
  screenshots: [],
  errors: [],
};

if (!process.argv.includes('--render-only')) {
  for (const lang of ['en', 'zh']) {
    const profile = await mkdtemp(join(tmpdir(), 'justonehop-store-'));
    let context;
    try {
      const extension = join(root, 'dist');
      context = await chromium.launchPersistentContext(profile, {
        executablePath, headless: true, viewport: { width: 750, height: 516 }, deviceScaleFactor: 2,
        locale: lang === 'zh' ? 'zh-CN' : 'en-US', reducedMotion: 'reduce',
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      evidence.browser = context.browser()?.version();
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
      await worker.evaluate(async language => chrome.storage.local.set({
        preferences: { language, theme: 'light', autoTuck: false },
        searchUsage: [
          { query: 'claude code', queryText: 'claude code', target: 'tab:https://github.com/anthropics/claude-code', weight: 3, lastUsed: Date.now() },
          { query: 'claude', queryText: 'claude', target: 'tab:https://claude.ai/chat/mcp-server-guide', weight: 2, lastUsed: Date.now() },
        ],
      }), lang);

      let sourceTabId;
      for (const [key, pageUrl, title, mode, pinned] of scenes[lang]) {
        const page = await context.newPage();
        await page.goto(pageUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(100);
        if (key === 'github') {
          await page.evaluate(language => {
            localStorage.setItem('claude.mcp.config', JSON.stringify({
              server: 'filesystem',
              transport: 'stdio',
              tools: ['read_file', 'edit_file', 'search_code'],
              timeoutMs: 15000,
              workspace: language === 'zh' ? '/Users/dev/justonehop' : '/Users/dev/claude-code',
            }));
            localStorage.setItem('claude.session.state', JSON.stringify({
              branch: 'main',
              model: 'claude-sonnet-4',
              streaming: true,
              contextTokens: 18420,
            }));
            localStorage.setItem('gh.repo.preferences', JSON.stringify({
              diffView: 'split',
              wordWrap: true,
              showWhitespace: false,
            }));
            localStorage.setItem('justonehop.theme', 'system');
            localStorage.setItem('justonehop.shortcut', 'Command+Shift+P');
          }, lang);
          sourceTabId = await worker.evaluate(async url => {
            const [tab] = await chrome.tabs.query({ url });
            return tab?.id;
          }, pageUrl);
        }
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
      ui.on('pageerror', error => evidence.errors.push(`${lang}: ${error.message}`));
      ui.on('console', message => { if (message.type() === 'error') evidence.errors.push(`${lang}: ${message.text()}`); });
      const popup = worker.url().replace('background.js', 'popup.html');
      const t = key => messages[lang][key].message;
      await ui.emulateMedia({ colorScheme: 'light' });
      await ui.goto(popup, { waitUntil: 'networkidle' });
      await worker.evaluate(async ({ popupUrl, sourceId, language }) => {
        const [popupTab] = await chrome.tabs.query({ url: popupUrl });
        if (!popupTab?.id || !sourceId) return;
        const popupId = popupTab.id;
        const origGet = chrome.tabs.get.bind(chrome.tabs);
        const origQuery = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.get = async id => {
          const tab = await origGet(id === popupId ? sourceId : id);
          return id === popupId || id === sourceId ? { ...tab, active: true } : tab;
        };
        chrome.tabs.query = async info => {
          const list = await origQuery(info);
          return list.filter(t => t.id !== popupId).map(t => (t.id === sourceId ? { ...t, active: true } : { ...t, active: false }));
        };
        const demoEntries = [
          {
            id: 'claude.mcp.config',
            name: 'claude.mcp.config',
            value: JSON.stringify({
              server: 'filesystem',
              transport: 'stdio',
              tools: ['read_file', 'edit_file', 'search_code'],
              timeoutMs: 15000,
              workspace: language === 'zh' ? '/Users/dev/justonehop' : '/Users/dev/claude-code',
            }),
          },
          {
            id: 'claude.session.state',
            name: 'claude.session.state',
            value: JSON.stringify({ branch: 'main', model: 'claude-sonnet-4', streaming: true, contextTokens: 18420 }),
          },
          {
            id: 'gh.repo.preferences',
            name: 'gh.repo.preferences',
            value: JSON.stringify({ diffView: 'split', wordWrap: true, showWhitespace: false }),
          },
          { id: 'justonehop.shortcut', name: 'justonehop.shortcut', value: 'Command+Shift+P' },
          { id: 'justonehop.theme', name: 'justonehop.theme', value: 'system' },
        ];
        chrome.scripting.executeScript = async ({ args }) => [{
          result: { url: args?.[1] || 'https://github.com/anthropics/claude-code', entries: demoEntries },
        }];
      }, { popupUrl: popup, sourceId: sourceTabId, language: lang });
      await ui.reload({ waitUntil: 'networkidle' });
      await ui.waitForTimeout(250);
      const input = () => ui.getByRole('combobox').first();
      const capture = async name => {
        await ui.mouse.move(749, 515);
        await ui.waitForTimeout(150);
        await ui.locator('.palette').first().screenshot({ path: join(raw, `${lang}-${name}.png`), animations: 'disabled' });
        evidence.screenshots.push({ language: lang, scene: name, text: await ui.locator('.palette').first().innerText() });
        console.log(`Captured ${lang}/${name}`);
      };

      // 1. Unified search + inline query completion + learned ranking (Light Mode)
      await input().fill('claude');
      await expect(ui.locator('.result.tab').first()).toBeVisible();
      await expect(ui.locator('.result.bookmark').first()).toBeVisible();
      await expect(ui.locator('.result.history').first()).toBeVisible();
      await expect(ui.locator('.query-completion')).toBeVisible();
      await capture('search');

      // 2. Capture the current action menu, preserving all real items and scrolling.
      await ui.locator('.result.tab').nth(1).click({ button: 'right' });
      await expect(ui.locator('.action-menu')).toBeVisible();
      await capture('actions');
      await ui.keyboard.press('Escape');

      // 3. Categorized Settings & Custom Search Icon (Light Mode)
      await input().fill('settings');
      await ui.locator('[id="justonehop-command:settings"]').first().click();
      await expect(ui.locator('.settings-view')).toBeVisible();
      await ui.locator('[data-setting="searchIcon"] button').click();
      await expect(ui.locator('.search-icon-settings')).toBeVisible();
      await ui.locator('.search-icon-emoji').fill('🚀');
      await capture('settings');

      // 4. Recent Tab Switcher in Native Dark Mode!
      await worker.evaluate(async language => chrome.storage.local.set({ preferences: { language, theme: 'dark', autoTuck: false } }), lang);
      await ui.emulateMedia({ colorScheme: 'dark' });
      await ui.reload({ waitUntil: 'networkidle' });
      await ui.waitForTimeout(200);
      await input().fill('tab switcher');
      await ui.locator('.result').filter({ hasText: t('recentSwitcher') }).first().click();
      await expect(ui.locator('.recent-switcher')).toBeVisible();
      await capture('switcher');

      // 5. Read-Only Site Storage Inspector in Native Dark Mode!
      await ui.reload({ waitUntil: 'networkidle' });
      await ui.waitForTimeout(200);
      await input().fill('local storage');
      await ui.locator('[id="justonehop-command:localStorage"]').first().click();
      await expect(ui.locator('.storage-view')).toBeVisible();
      await expect(ui.locator('.storage-row').first()).toBeVisible();
      await capture('storage');
    } finally {
      if (context) await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
  await writeFile(join(output, 'capture.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (evidence.errors.length) throw new Error(evidence.errors.join('\n'));
}

const logoLightData = `data:image/svg+xml;base64,${(await readFile(join(root, 'docs/brand/logo-light.svg'))).toString('base64')}`;
const logoDarkData = `data:image/svg+xml;base64,${(await readFile(join(root, 'docs/brand/logo-dark.svg'))).toString('base64')}`;
const logoSmallLightData = `data:image/svg+xml;base64,${(await readFile(join(root, 'docs/brand/logo-small-light.svg'))).toString('base64')}`;

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');

const slides = {
  zh: [
    {
      scene: 'search',
      theme: 'light',
      heading: '标签页、书签、历史与命令，一个框全搜到',
      subtitle: '支持中文全拼与首字母检索、本机历史查询补全；无论习惯键盘快捷键还是鼠标点选都自然顺手。',
      pills: ['⌘Shift+P 随时唤起', '拼音检索 · 智能补全', '鼠标与键盘皆顺手'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'switcher',
      theme: 'dark',
      heading: '像 Alt+Tab 一样，切回刚才看的网页',
      subtitle: '按最近访问顺序（MRU）穿梭已打开标签页，松开按键即切换；内置向导帮助配置 Ctrl+Tab。',
      pills: ['最近访问顺序 (MRU)', '支持绑定 Ctrl+Tab', '随时打字或拼音筛选'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'actions',
      theme: 'light',
      heading: '右键或按 ⌘K，一口气连续整理多个标签页',
      subtitle: '复制链接、固定、静音、收藏、移入标签组或收起网页；多数操作保留所选项，移除结果后选中相邻项。',
      pills: ['连续整理不关面板', '原生标签组与一键收起', '固定 · 静音 · 复制链接'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'storage',
      theme: 'dark',
      heading: '免开笨重 DevTools，秒看 Storage 与 Cookie',
      subtitle: '输入 local storage、session storage 或 cookie，双栏只读查看键名与格式化 JSON，按回车一键复制。',
      pills: ['双栏键值与 JSON 预览', '回车一键复制原始值', '按站点独立申请授权'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'settings',
      theme: 'light',
      heading: '定制「瞬移徽章」、分类设置与闲置自动收起',
      subtitle: '用 Emoji 或本地图片打造专属搜索栏徽章；设置按外观、键盘、实验室、使用帮助分类并支持全局搜索。',
      pills: ['Emoji 与图片瞬移徽章', '跨分类搜索与逐层返回', '100% 本地运行零遥测'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
  ],
  en: [
    {
      scene: 'search',
      theme: 'light',
      heading: 'Search tabs, bookmarks, history & actions in one box',
      subtitle: 'Jump straight to any page or browser command with instant local query completion—natural with keyboard or mouse.',
      pills: ['⌘Shift+P Anywhere', 'Smart Query Completion', 'Mouse & Keyboard Friendly'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'switcher',
      theme: 'dark',
      heading: 'Switch between recent tabs like Alt+Tab',
      subtitle: 'Cycle through open tabs in most-recently-used order (includes a Ctrl+Tab setup guide), or type anytime to filter.',
      pills: ['MRU Tab Order', 'Ctrl+Tab Setup Guide', 'Type Anytime to Filter'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'actions',
      theme: 'light',
      heading: 'Right-click or press ⌘K to tidy tabs in a row',
      subtitle: 'Copy URLs, pin, mute, bookmark, manage Tab Groups, or tuck tabs away. Most actions preserve selection; removed results advance to an adjacent item.',
      pills: ['Continuous Tab Tidy', 'Tab Groups & Tuck Away', 'Copy URL · Pin · Mute'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'storage',
      theme: 'dark',
      heading: 'Inspect Storage & Cookies without opening DevTools',
      subtitle: 'Type “local storage”, “session storage”, or “cookie” for a fast read-only viewer with formatted JSON and one-key copy.',
      pills: ['Side-by-Side JSON Viewer', 'One-Key Raw Value Copy', 'Per-Site Cookie Access'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
    {
      scene: 'settings',
      theme: 'light',
      heading: 'Custom Hop Badge, Auto-Tuck & searchable settings',
      subtitle: 'Wear an Emoji or custom image on your search bar, configure idle Auto-Tuck in Labs, and search across all settings.',
      pills: ['Emoji & Image Hop Badge', 'Searchable Settings', '100% Local & Private'],
      activeUrl: 'github.com/anthropics/claude-code',
    },
  ],
};

function renderChromeWindow({ lang, theme, activeUrl, productSrc }) {
  const isDark = theme === 'dark';
  const tabs = lang === 'zh'
    ? [
        { icon: iconDataUris.claude, title: 'Claude · MCP Server', pinned: true },
        { icon: iconDataUris.github, title: 'anthropics/claude-code · GitHub', active: true },
        { icon: iconDataUris.x, title: '(3) Home / X' },
        { icon: iconDataUris.figma, title: 'Figma · Chrome CR2023 UI' },
        { icon: iconDataUris.linear, title: 'ENG-204 · Linear' },
        { icon: iconDataUris.youtube, title: 'Claude Code 实战 - YouTube' },
      ]
    : [
        { icon: iconDataUris.claude, title: 'Claude · MCP Server', pinned: true },
        { icon: iconDataUris.github, title: 'anthropics/claude-code · GitHub', active: true },
        { icon: iconDataUris.x, title: '(3) Home / X' },
        { icon: iconDataUris.figma, title: 'Figma · Chrome CR2023 UI' },
        { icon: iconDataUris.linear, title: 'ENG-204 · Linear' },
        { icon: iconDataUris.youtube, title: 'Claude Code Demo - YouTube' },
      ];

  const tabsHtml = tabs.map(t => `
    <div class="cr-tab ${t.active ? 'active' : ''} ${t.pinned ? 'pinned' : ''}">
      <img src="${t.icon}" alt="">
      ${t.pinned ? '' : `<span>${escape(t.title)}</span><i class="cr-close">×</i>`}
    </div>
  `).join('');

  return `
    <div class="chrome-shell ${isDark ? 'chrome-dark' : 'chrome-light'}">
      <div class="cr-tabstrip">
        <div class="mac-lights"><i class="r"></i><i class="y"></i><i class="g"></i></div>
        <div class="cr-tabs">${tabsHtml}<div class="cr-newtab">+</div></div>
      </div>
      <div class="cr-toolbar">
        <div class="cr-nav-btns">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M13 8H3M7 4L3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg width="16" height="16" viewBox="0 0 16 16" style="opacity:.4"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.7M13.5 2.5v2.2h-2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="cr-omnibox">
          <svg width="14" height="14" viewBox="0 0 16 16" style="opacity:.65"><rect x="3" y="3.5" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="9.5" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
          <span>${escape(activeUrl)}</span>
        </div>
        <div class="cr-ext-bar">
          <div class="cr-ext-pill active">
            <img src="${isDark ? logoDarkData : logoLightData}" alt="">
          </div>
          <div class="cr-avatar"></div>
        </div>
      </div>
      <div class="cr-viewport">
        <div class="webpage-bg">
          <div class="gh-header">
            <div class="gh-repo-path">
              <img src="${iconDataUris.github}" alt="">
              <span>anthropics</span> / <strong>claude-code</strong>
              <span class="gh-badge">Public</span>
            </div>
            <div class="gh-stats">
              <span class="gh-btn">★ Star <strong>28.4k</strong></span>
              <span class="gh-btn">⑂ Fork <strong>2.1k</strong></span>
            </div>
          </div>
          <div class="gh-nav">
            <span class="active">&lt;&gt; Code</span>
            <span>⊙ Issues <em>18</em></span>
            <span>⑃ Pull requests <em>4</em></span>
            <span>▷ Actions</span>
          </div>
          <div class="gh-body">
            <div class="gh-files">
              <div class="gh-commit-bar">
                <span class="gh-author">anthropic-bot</span>
                <span>feat(mcp): improve tool streaming and terminal ergonomics</span>
                <span class="gh-sha">a91f4c2 · 2 hours ago</span>
              </div>
              <div class="gh-row"><span>📁 src/commands</span><span>Add fuzzy tab &amp; history matcher</span><span>yesterday</span></div>
              <div class="gh-row"><span>📁 docs/architecture</span><span>Update Chrome CR2023 token guide</span><span>2 days ago</span></div>
              <div class="gh-row"><span>📄 package.json</span><span>Bump version to 0.2.14</span><span>2 hours ago</span></div>
              <div class="gh-row"><span>📄 README.md</span><span>Document keyboard shortcuts and MCP config</span><span>3 days ago</span></div>
            </div>
            <div class="gh-side">
              <div class="gh-side-title">About</div>
              <div class="gh-side-desc">Agentic coding tool that lives in your terminal, understands your codebase, and helps you ship faster.</div>
              <div class="gh-tags"><span>typescript</span><span>cli</span><span>claude</span><span>mcp</span></div>
            </div>
          </div>
        </div>
        <div class="cr-backdrop"></div>
        <div class="palette-holder">
          <img src="${productSrc}" alt="">
        </div>
      </div>
    </div>
  `;
}

const pinSvg = `<svg width="11" height="11" viewBox="0 0 16 16" style="margin-right:3px;vertical-align:-1px"><path d="M9.8 2.2 13.8 6.2 12.4 7.6 11 6.2 7.6 9.6 8.3 11.7 6.9 13.1 4.5 10.7 1.8 13.4 1.1 12.7 3.8 10 1.4 7.6 2.8 6.2 4.9 6.9 8.3 3.5 6.9 2.1 8.3.7Z" fill="currentColor"/></svg>`;

const css = `
:root {
  --font-display: "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* ========================================================
   1280x800 STORE SCREENSHOTS (Chrome Native Light & Dark)
   ======================================================== */
.artboard {
  position: relative;
  width: 1280px;
  height: 800px;
  overflow: hidden;
}
.artboard.theme-light {
  background: linear-gradient(180deg, #e8eef7 0%, #f1f4f9 45%, #e9eef6 100%);
  color: #1f1f1f;
}
.artboard.theme-dark {
  background: linear-gradient(180deg, #14161a 0%, #1b1e24 50%, #14161a 100%);
  color: #e8eaed;
}

.top-header {
  position: absolute;
  left: 64px;
  right: 64px;
  top: 28px;
  height: 118px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
}
.header-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 820px;
}
.brand-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
}
.brand-row img {
  width: 30px;
  height: 30px;
  display: block;
}
.brand-row .b-name {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.brand-row .b-sub {
  font-size: 13.5px;
  opacity: 0.62;
  font-weight: 500;
}
.top-header h1 {
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.025em;
  margin: 0;
}
.top-header p {
  font-size: 15px;
  line-height: 1.5;
  margin: 0;
  color: #475569;
}
.theme-dark .top-header p {
  color: #9aa0a6;
}
.header-pills {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
  padding-bottom: 2px;
}
.cr-pill-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(11, 87, 208, 0.16);
  color: #1f1f1f;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.cr-pill-badge::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0b57d0;
}
.theme-dark .cr-pill-badge {
  background: #252830;
  border-color: rgba(138, 180, 248, 0.22);
  color: #e8eaed;
}
.theme-dark .cr-pill-badge::before {
  background: #8ab4f8;
}

/* Realistic Chrome CR2023 Browser Window */
.chrome-shell {
  position: absolute;
  left: 64px;
  right: 64px;
  top: 162px;
  height: 660px;
  border-radius: 14px 14px 0 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.chrome-light {
  background: #ffffff;
  border: 1px solid #c4cad4;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.16), 0 4px 16px rgba(15, 23, 42, 0.06);
}
.chrome-dark {
  background: #202124;
  border: 1px solid #3c4043;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.65), 0 6px 20px rgba(0, 0, 0, 0.4);
}

.cr-tabstrip {
  height: 42px;
  display: flex;
  align-items: flex-end;
  padding: 0 14px;
  gap: 14px;
  user-select: none;
}
.chrome-light .cr-tabstrip {
  background: #dee1e6;
}
.chrome-dark .cr-tabstrip {
  background: #17181b;
}
.mac-lights {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding-left: 2px;
}
.mac-lights i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: block;
}
.mac-lights .r { background: #ff5f57; border: 0.5px solid rgba(0,0,0,0.12); }
.mac-lights .y { background: #febc2e; border: 0.5px solid rgba(0,0,0,0.12); }
.mac-lights .g { background: #28c840; border: 0.5px solid rgba(0,0,0,0.12); }

.cr-tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.cr-tab {
  height: 34px;
  padding: 0 12px;
  border-radius: 10px 10px 0 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  max-width: 195px;
  min-width: 0;
  position: relative;
}
.cr-tab.pinned {
  padding: 0 11px;
  max-width: 40px;
}
.chrome-light .cr-tab {
  color: #475569;
}
.chrome-light .cr-tab.active {
  background: #ffffff;
  color: #1f1f1f;
  font-weight: 500;
  box-shadow: 0 -1px 4px rgba(0,0,0,0.04);
}
.chrome-dark .cr-tab {
  color: #9aa0a6;
}
.chrome-dark .cr-tab.active {
  background: #292a2d;
  color: #e8eaed;
  font-weight: 500;
}
.cr-tab img {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
}
.cr-tab span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cr-close {
  font-style: normal;
  font-size: 14px;
  opacity: 0.5;
  margin-left: 2px;
}
.cr-newtab {
  width: 28px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  opacity: 0.6;
}

.cr-toolbar {
  height: 44px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.chrome-light .cr-toolbar {
  background: #ffffff;
  border-bottom: 1px solid #dadce0;
  color: #5f6368;
}
.chrome-dark .cr-toolbar {
  background: #292a2d;
  border-bottom: 1px solid #3c4043;
  color: #9aa0a6;
}
.cr-nav-btns {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cr-omnibox {
  flex: 1;
  height: 30px;
  border-radius: 999px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
}
.chrome-light .cr-omnibox {
  background: #f1f3f4;
  color: #1f1f1f;
}
.chrome-dark .cr-omnibox {
  background: #202124;
  color: #e8eaed;
}
.cr-ext-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cr-ext-pill {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chrome-light .cr-ext-pill.active {
  background: #e8f0fe;
  border: 1px solid #c2d7fa;
}
.chrome-dark .cr-ext-pill.active {
  background: #394457;
  border: 1px solid rgba(138, 180, 248, 0.35);
}
.cr-ext-pill img {
  width: 20px;
  height: 20px;
}
.cr-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0b57d0, #60a5fa);
}

.cr-viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
}
.webpage-bg {
  position: absolute;
  inset: 0;
  padding: 24px 48px;
  font-size: 13px;
}
.chrome-light .webpage-bg {
  background: #ffffff;
  color: #1f2328;
}
.chrome-dark .webpage-bg {
  background: #0d1117;
  color: #e6edf3;
}
.gh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.gh-repo-path {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  color: #0969da;
}
.chrome-dark .gh-repo-path {
  color: #58a6ff;
}
.gh-repo-path img {
  width: 22px;
  height: 22px;
  border-radius: 5px;
}
.gh-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(128,128,128,0.35);
  color: #656d76;
}
.gh-stats {
  display: flex;
  gap: 8px;
}
.gh-btn {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid rgba(128,128,128,0.28);
  background: rgba(128,128,128,0.06);
}
.gh-nav {
  display: flex;
  gap: 22px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(128,128,128,0.22);
  margin-bottom: 20px;
  font-size: 13px;
  color: #656d76;
}
.gh-nav .active {
  font-weight: 600;
  color: inherit;
  border-bottom: 2px solid #fd8c73;
  padding-bottom: 11px;
  margin-bottom: -13px;
}
.gh-nav em {
  font-style: normal;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(128,128,128,0.15);
  font-size: 11px;
}
.gh-body {
  display: grid;
  grid-template-columns: 1fr 250px;
  gap: 24px;
}
.gh-files {
  border: 1px solid rgba(128,128,128,0.25);
  border-radius: 8px;
  overflow: hidden;
}
.gh-commit-bar {
  padding: 10px 14px;
  background: rgba(128,128,128,0.07);
  border-bottom: 1px solid rgba(128,128,128,0.2);
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.gh-author { font-weight: 600; }
.gh-sha { font-family: var(--font-mono); opacity: 0.65; }
.gh-row {
  padding: 9px 14px;
  border-bottom: 1px solid rgba(128,128,128,0.14);
  display: grid;
  grid-template-columns: 180px 1fr 90px;
  font-size: 12.5px;
  opacity: 0.85;
}
.gh-side-title { font-weight: 600; margin-bottom: 8px; }
.gh-side-desc { font-size: 12.5px; line-height: 1.5; opacity: 0.75; margin-bottom: 12px; }
.gh-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.gh-tags span {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(9, 105, 218, 0.1);
  color: #0969da;
}
.chrome-dark .gh-tags span {
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
}

.cr-backdrop {
  position: absolute;
  inset: 0;
}
.chrome-light .cr-backdrop {
  background: rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(1.5px);
}
.chrome-dark .cr-backdrop {
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(1.5px);
}
.palette-holder {
  position: absolute;
  left: 50%;
  top: 22px;
  transform: translateX(-50%);
  width: 750px;
  height: 516px;
  border-radius: 16px;
  overflow: hidden;
}
.chrome-light .palette-holder {
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 16px rgba(15, 23, 42, 0.12);
}
.chrome-dark .palette-holder {
  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.75), 0 6px 20px rgba(0, 0, 0, 0.45);
}
.palette-holder img {
  display: block;
  width: 750px;
  height: 516px;
}

/* ========================================================
   440x280 SMALL PROMO TILE (Designed Hero Card, Not Shrunk Screenshot)
   ======================================================== */
.promo-small {
  position: relative;
  width: 440px;
  height: 280px;
  overflow: hidden;
  background: linear-gradient(145deg, #eef3fc 0%, #e3ecfb 52%, #dae6f9 100%);
  color: #1f1f1f;
}
.promo-small .sm-top {
  position: absolute;
  left: 20px;
  right: 20px;
  top: 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.promo-small .sm-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}
.promo-small .sm-brand img {
  width: 26px;
  height: 26px;
}
.promo-small .sm-brand small {
  font-size: 12px;
  color: #5f6368;
  font-weight: 500;
}
.promo-small .sm-kbd {
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(11, 87, 208, 0.2);
  color: #0b57d0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}
.promo-small h1 {
  position: absolute;
  left: 20px;
  right: 20px;
  top: 46px;
  margin: 0;
  font-family: var(--font-display);
  font-size: 23px;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: #111827;
}
.sm-hero-card {
  position: absolute;
  left: 18px;
  right: 18px;
  top: 84px;
  bottom: -12px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid #cdd5e1;
  box-shadow: 0 18px 42px rgba(11, 87, 208, 0.16), 0 4px 12px rgba(15, 23, 42, 0.08);
  padding: 10px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sm-omnibox {
  height: 38px;
  border-radius: 999px;
  background: #ffffff;
  border: 1.8px solid #0b57d0;
  box-shadow: 0 2px 8px rgba(11, 87, 208, 0.14);
  padding: 0 13px;
  display: flex;
  align-items: center;
  gap: 9px;
}
.sm-omnibox img {
  width: 18px;
  height: 18px;
}
.sm-omnibox .sm-query {
  font-size: 14.5px;
  font-weight: 600;
  color: #1f1f1f;
  display: flex;
  align-items: center;
}
.sm-omnibox .sm-caret {
  display: inline-block;
  width: 1.8px;
  height: 16px;
  background: #0b57d0;
  margin-left: 1px;
}
.sm-omnibox .sm-hint {
  margin-left: auto;
  font-size: 11px;
  color: #5f6368;
}
.sm-row {
  position: relative;
  height: 40px;
  border-radius: 9px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.sm-row.selected {
  background: #e8f0fe;
}
.sm-row.selected::before {
  content: "";
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 3.5px;
  border-radius: 0 3px 3px 0;
  background: #0b57d0;
}
.sm-row img {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
}
.sm-row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f1f1f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sm-row-domain {
  font-size: 12px;
  color: #5f6368;
  margin-left: 4px;
}
.sm-row-tag {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: #0b57d0;
  background: rgba(11, 87, 208, 0.08);
  padding: 2px 7px;
  border-radius: 5px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}
.sm-row:not(.selected) .sm-row-tag {
  color: #5f6368;
  background: #f1f3f4;
}

/* ========================================================
   1400x560 LARGE MARQUEE PROMO (Light + Dark Chrome Native Showcase)
   ======================================================== */
.promo-large {
  position: relative;
  width: 1400px;
  height: 560px;
  overflow: hidden;
  background: linear-gradient(135deg, #f1f5fb 0%, #e6eefb 55%, #dce7f9 100%);
  color: #1f1f1f;
}
.mq-left {
  position: absolute;
  left: 60px;
  top: 48px;
  bottom: 48px;
  width: 500px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 36px;
  z-index: 3;
}
.mq-brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.mq-brand img {
  width: 42px;
  height: 42px;
}
.mq-brand .mq-b-main {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 600;
  color: #1f1f1f;
}
.mq-copy h1 {
  font-family: var(--font-display);
  font-size: 42px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.028em;
  margin: 0 0 16px;
  color: #111827;
}
.mq-copy p {
  font-size: 17px;
  line-height: 1.58;
  color: #475569;
  margin: 0 0 24px;
}
.mq-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.mq-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(11, 87, 208, 0.2);
  font-size: 13.5px;
  font-weight: 600;
  color: #1f1f1f;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
}
.mq-badge i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #0b57d0;
  display: inline-block;
}

.mq-stage {
  position: absolute;
  left: 560px;
  right: 0;
  top: 0;
  bottom: 0;
}
/* Back Left: Light Mode Search Card (so its left-side icons are 100% visible!) */
.mq-light-back {
  position: absolute;
  left: 10px;
  top: 34px;
  width: 590px;
  border-radius: 16px;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid #cfd6e2;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
}
.mq-light-back img {
  display: block;
  width: 100%;
  height: auto;
}
/* Front Right: Dark Mode Switcher Card (so its left-side icons and dark surface are also 100% visible!) */
.mq-dark-front {
  position: absolute;
  left: 236px;
  top: 136px;
  width: 580px;
  border-radius: 16px;
  overflow: hidden;
  background: #292a2d;
  border: 1px solid #3c4043;
  box-shadow: -16px 28px 72px rgba(15, 23, 42, 0.42), 0 6px 20px rgba(0, 0, 0, 0.28);
}
.mq-dark-front img {
  display: block;
  width: 100%;
  height: auto;
}
`;

const browser = await chromium.launch({ executablePath, headless: true });
const previewItems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  async function render(filename, html, width, height) {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(output, filename), animations: 'disabled' });
    previewItems.push({ filename, width, height });
    console.log(`Rendered ${filename} (${width}×${height})`);
  }

  for (const lang of ['zh', 'en']) {
    const searchCapture = `data:image/png;base64,${(await readFile(join(raw, `${lang}-search.png`))).toString('base64')}`;
    const switcherCapture = `data:image/png;base64,${(await readFile(join(raw, `${lang}-switcher.png`))).toString('base64')}`;

    for (const [index, slide] of slides[lang].entries()) {
      const png = await readFile(join(raw, `${lang}-${slide.scene}.png`));
      const productSrc = `data:image/png;base64,${png.toString('base64')}`;
      const logoSrc = slide.theme === 'dark' ? logoDarkData : logoLightData;
      const brandTitle = lang === 'zh'
        ? `<span class="b-name">小范围瞬移</span>`
        : `<span class="b-name">JustOneHop</span>`;
      const pillsHtml = slide.pills.map(p => `<div class="cr-pill-badge">${escape(p)}</div>`).join('');

      const html = `
        <main class="artboard theme-${slide.theme}">
          <header class="top-header">
            <div class="header-left">
              <div class="brand-row"><img src="${logoSrc}" alt="">${brandTitle}</div>
              <h1>${escape(slide.heading)}</h1>
              <p>${escape(slide.subtitle)}</p>
            </div>
            <div class="header-pills">${pillsHtml}</div>
          </header>
          ${renderChromeWindow({ lang, theme: slide.theme, activeUrl: slide.activeUrl, productSrc })}
        </main>
      `;

      await render(`${lang}-${index + 1}-${slide.scene}.png`, html, 1280, 800);
    }

    // Promotional tiles cannot be localized in the store; use English for every locale.
    if (lang !== 'en') continue;

    // 440x280 Small Promo Tile — Designed Hero Card for 1-second thumbnail legibility
    const smallHtml = `<main class="promo-small">
          <div class="sm-top">
            <div class="sm-brand"><img src="${logoLightData}" alt=""><span>JustOneHop</span></div>
            <span class="sm-kbd">⌘Shift+P</span>
          </div>
          <h1>Too many tabs? Just search.</h1>
          <div class="sm-hero-card">
            <div class="sm-omnibox">
              <img src="${logoSmallLightData}" alt="">
              <span class="sm-query">claude<i class="sm-caret"></i></span>
              <span class="sm-hint">Tabs · Bookmarks · History</span>
            </div>
            <div class="sm-row selected">
              <img src="${iconDataUris.claude}" alt="">
              <span class="sm-row-title">Claude · MCP Server Debugging</span>
              <span class="sm-row-domain">claude.ai</span>
              <span class="sm-row-tag">${pinSvg}Tab</span>
            </div>
            <div class="sm-row">
              <img src="${iconDataUris.github}" alt="">
              <span class="sm-row-title">anthropics/claude-code</span>
              <span class="sm-row-domain">github.com</span>
              <span class="sm-row-tag">Tab</span>
            </div>
            <div class="sm-row">
              <img src="${iconDataUris.x}" alt="">
              <span class="sm-row-title">Andrej Karpathy on X</span>
              <span class="sm-row-domain">x.com</span>
              <span class="sm-row-tag">History</span>
            </div>
          </div>
        </main>`;

    await render(`${lang}-promo-440x280.png`, smallHtml, 440, 280);

    // 1400x560 Large Marquee Promo — Light + Dark Dual Theme Showcase
    const largeHtml = `<main class="promo-large">
          <section class="mq-left">
            <div class="mq-brand">
              <img src="${logoLightData}" alt="">
              <div><span class="mq-b-main">JustOneHop</span></div>
            </div>
            <div class="mq-copy">
              <h1>Search open tabs, bookmarks,<br>and history in one place.</h1>
              <p>A human-first command palette for Chrome with Alt+Tab recent switching, continuous tab tidy, tab tucking, and instant storage inspection.</p>
              <div class="mq-badges">
                <span class="mq-badge"><i></i>Smart Completion</span>
                <span class="mq-badge"><i></i>Alt+Tab Switcher</span>
                <span class="mq-badge"><i></i>100% Local</span>
              </div>
            </div>
          </section>
          <section class="mq-stage">
            <div class="mq-light-back"><img src="${searchCapture}" alt=""></div>
            <div class="mq-dark-front"><img src="${switcherCapture}" alt=""></div>
          </section>
        </main>`;

    await render(`${lang}-promo-1400x560.png`, largeHtml, 1400, 560);
  }

  await writeFile(join(output, 'promo-440x280.png'), await readFile(join(output, 'en-promo-440x280.png')));
  await writeFile(join(output, 'promo-1400x560.png'), await readFile(join(output, 'en-promo-1400x560.png')));
} finally {
  await browser.close();
}

await sharp(join(root, 'docs/brand/logo-app.svg')).resize(96, 96).extend({
  top: 16, bottom: 16, left: 16, right: 16, background: '#00000000',
}).png().toFile(join(output, 'store-icon-128.png'));

const tiles = await Promise.all(previewItems.map(async (item, index) => ({
  input: await sharp(join(output, item.filename)).resize(384, 240, { fit: 'contain', background: '#e8eaed' }).png().toBuffer(),
  left: (index % 2) * 400 + 8,
  top: Math.floor(index / 2) * 256 + 8,
})));
await sharp({
  create: { width: 800, height: Math.ceil(tiles.length / 2) * 256, channels: 3, background: '#e8eaed' },
}).composite(tiles).png().toFile(join(output, 'contact-sheet.png'));

const allTracked = [
  ...previewItems,
  { filename: 'promo-440x280.png', width: 440, height: 280 },
  { filename: 'promo-1400x560.png', width: 1400, height: 560 },
  { filename: 'store-icon-128.png', width: 128, height: 128 },
];
const files = [];
for (const item of allTracked) {
  const bytes = await readFile(join(output, item.filename));
  const meta = await sharp(bytes).metadata();
  await sharp(bytes).raw().toBuffer(); // Validate the full PNG stream, not only its header.
  if (meta.width !== item.width || meta.height !== item.height || meta.format !== 'png') {
    throw new Error(`Invalid dimensions: ${item.filename}`);
  }
  files.push({ ...item, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(output, 'assets.json'), JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2) + '\n');
console.log('Store assets ready in docs/store/');
