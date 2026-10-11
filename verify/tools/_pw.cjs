// Finds Playwright: env PLAYWRIGHT_MODULE -> this repository's node_modules -> the working folder. Otherwise a clear error.
const path = require('path');
module.exports = function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, path.join(__dirname, '..', '..', 'node_modules', 'playwright'), 'playwright',
    path.join(process.cwd(), 'node_modules/playwright')].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  throw new Error('Playwright not found: `npm ci` in the repository or set PLAYWRIGHT_MODULE=<path to node_modules/playwright>');
};
