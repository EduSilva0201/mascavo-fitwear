import { chromium as engine } from 'playwright';
async function blockExternal(context) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      ? route.continue()
      : route.abort('blockedbyclient');
  });
  return context;
}
export const chromium = {
  async launch(options = {}) {
    const config = { ...options };
    if (process.env.PLAYWRIGHT_CHANNEL === 'chromium') delete config.channel;
    else if (process.env.PLAYWRIGHT_CHANNEL) config.channel = process.env.PLAYWRIGHT_CHANNEL;
    const browser = await engine.launch(config),
      newContext = browser.newContext.bind(browser),
      newPage = browser.newPage.bind(browser);
    browser.newContext = async (opts) => blockExternal(await newContext(opts));
    browser.newPage = async (opts) => {
      const page = await newPage(opts);
      await blockExternal(page.context());
      return page;
    };
    return browser;
  },
};
