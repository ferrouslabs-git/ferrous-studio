// Bridge every /api call from the vite dev server (:5173) to the verify
// backend on :8081, where Cognito is bypassed. Load it by path with the
// Playwright MCP's `filename` param, or read+eval it from the dev-browser
// skill — the signature is the same in both.
//
// `URL` is undefined inside the route sandbox, so the rewrite is string-based.
// Re-run this file after any page.unroute('**/api/**'), which drops it.
async (page) => {
  await page.addInitScript(() => {
    // The verify backend ignores the token; the frontend only checks presence
    // and expiry before it will render an authenticated route.
    localStorage.setItem('auth_access_token', 'verify-server-bypass');
    localStorage.setItem('auth_access_token_expires_at', String(Date.now() + 86400000));
  });
  await page.evaluate(() => {
    localStorage.setItem('auth_access_token', 'verify-server-bypass');
    localStorage.setItem('auth_access_token_expires_at', String(Date.now() + 86400000));
  });
  await page.route('**/api/**', async (route) => {
    const to = route.request().url().replace(/^https?:\/\/[^/]+\/api\//, 'http://127.0.0.1:8081/api/');
    await route.fulfill({ response: await route.fetch({ url: to }) });
  });
  return 'bridge installed -> 127.0.0.1:8081 (auth keys seeded)';
}
