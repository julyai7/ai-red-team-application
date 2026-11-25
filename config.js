// Where the form sends applications. The API lives on the same site under /api
// (see README.md). If it isn't reachable or configured, the form runs in preview
// mode and only keeps answers in the browser.
window.APP_CONFIG = {
  apiBase: '/api',
  maxResumeMB: 4,
};
