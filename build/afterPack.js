const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  // Only relevant for Linux builds — chrome-sandbox is a Linux-specific
  // setuid binary that must be owned by root with mode 4755 to work.
  if (context.electronPlatformName !== 'linux') return;

  const sandboxPath = path.join(context.appOutDir, 'chrome-sandbox');

  if (!fs.existsSync(sandboxPath)) {
    console.warn('[afterPack] chrome-sandbox not found at', sandboxPath);
    return;
  }

  try {
    fs.chmodSync(sandboxPath, 0o4755);
    console.log('[afterPack] set chrome-sandbox to mode 4755 at', sandboxPath);
  } catch (err) {
    console.warn('[afterPack] could not chmod chrome-sandbox:', err.message);
  }
};