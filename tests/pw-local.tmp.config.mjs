import base from './playwright.config.mjs';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export default {
  ...base,
  use: { ...(base.use || {}), launchOptions: { ...((base.use || {}).launchOptions || {}), executablePath: exe } },
  projects: (base.projects || []).map(p => ({
    ...p,
    use: { ...(p.use || {}), launchOptions: { ...((p.use || {}).launchOptions || {}), executablePath: exe } },
  })),
};
