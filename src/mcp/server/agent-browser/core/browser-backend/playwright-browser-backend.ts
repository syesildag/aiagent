/**
 * Default browser implementation using Playwright
 */

import { chromium, type Browser, type Page, type Route } from 'playwright';
import type { IBrowserBackend } from './browser-backend.js';
import { assertPublicUrl } from '../../../../../utils/ssrfGuard';

/** How long a host's "public / private" verdict is cached for subresource checks. */
const HOST_VERDICT_TTL_MS = 60_000;

/** Schemes a page may load without a network request of its own. */
const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

export class PlaywrightBrowserBackend implements IBrowserBackend {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private readonly hostVerdicts = new Map<string, { allowed: boolean; expires: number }>();

    async launch(): Promise<void> {
        this.browser = await chromium.launch();
        this.page = await this.browser.newPage();
        // The URL comes from the LLM, and pages can redirect or load subresources
        // anywhere: check every request the context makes (popups included) so the
        // browser cannot be used to reach private / metadata addresses (SSRF).
        await this.page.context().route('**/*', (route) => this.guardRoute(route));
    }

    private async isAllowedRequestUrl(rawUrl: string): Promise<boolean> {
        let url: URL;
        try {
            url = new URL(rawUrl);
        } catch {
            return false;
        }
        if (LOCAL_SCHEMES.has(url.protocol)) return true;
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

        const cached = this.hostVerdicts.get(url.host);
        if (cached && cached.expires > Date.now()) return cached.allowed;
        let allowed: boolean;
        try {
            await assertPublicUrl(url.toString());
            allowed = true;
        } catch {
            allowed = false;
        }
        this.hostVerdicts.set(url.host, { allowed, expires: Date.now() + HOST_VERDICT_TTL_MS });
        return allowed;
    }

    private async guardRoute(route: Route): Promise<void> {
        try {
            if (await this.isAllowedRequestUrl(route.request().url())) {
                await route.continue();
            } else {
                await route.abort('blockedbyclient');
            }
        } catch {
            // The page may have navigated away or closed; nothing to do.
        }
    }

    async navigate(url: string): Promise<void> {
        // Reject non-http(s) schemes (file:, chrome:, …) and private hosts up front
        // with a clear error; the route guard covers redirects and subresources.
        await assertPublicUrl(url);
        await this.ensurePage();
        await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
        // Wait for network to settle so JS-rendered content is ready.
        // Ignore timeout — some sites have persistent polling connections.
        await this.page!.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    }

    async click(selector: string): Promise<void> {
        await this.ensurePage();
        await this.page!.click(selector);
    }

    async type(selector: string, text: string): Promise<void> {
        await this.ensurePage();
        await this.page!.fill(selector, text);
    }

    async evaluate(script: string): Promise<unknown> {
        await this.ensurePage();
        return this.page!.evaluate(script);
    }

    private async ensurePage(): Promise<void> {
        if (!this.page) {
          await this.launch();
        }
    }

    async dblclick(selector: string): Promise<void> {
        await this.ensurePage();
        await this.page!.dblclick(selector);
    }

    async fill(selector: string, text: string): Promise<void> {
        await this.ensurePage();
        await this.page!.fill(selector, text);
    }

    async press(key: string): Promise<void> {
        await this.ensurePage();
        await this.page!.keyboard.press(key);
    }

    async hover(selector: string): Promise<void> {
        await this.ensurePage();
        await this.page!.hover(selector);
    }

    async select(selector: string, value: string): Promise<void> {
        await this.ensurePage();
        await this.page!.selectOption(selector, value);
    }

    async check(selector: string): Promise<void> {
        await this.ensurePage();
        await this.page!.check(selector);
    }

    async uncheck(selector: string): Promise<void> {
        await this.ensurePage();
        await this.page!.uncheck(selector);
    }

    async scroll(direction: 'up' | 'down' | 'left' | 'right', pixels = 100): Promise<void> {
        await this.ensurePage();
        const dx = direction === 'left' ? -pixels : direction === 'right' ? pixels : 0;
        const dy = direction === 'up' ? -pixels : direction === 'down' ? pixels : 0;
        await this.page!.mouse.wheel(dx, dy);
    }

    async waitForPageStable(): Promise<void> {
        await this.ensurePage();
        await this.page!.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    }

    async screenshot(path?: string, options?: { fullPage?: boolean }): Promise<Buffer | void> {
        await this.ensurePage();
        const buffer = await this.page!.screenshot({ path, fullPage: options?.fullPage, timeout: 30_000 });
        return path ? undefined : (buffer as Buffer);
    }

    async pdf(path?: string, options?: { format?: string; printBackground?: boolean }): Promise<Buffer | void> {
        await this.ensurePage();
        const buffer = await this.page!.pdf({ path, format: options?.format, printBackground: options?.printBackground });
        return path ? undefined : (buffer as Buffer);
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}
