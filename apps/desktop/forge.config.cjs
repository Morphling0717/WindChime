const path = require('node:path');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'WindChime',
    icon: path.join(__dirname, 'build/icon.ico'),
    appBundleId: 'org.windchime.desktop',
    // Ship only the bundled local UI and hand-written runtime. This excludes
    // .env, platform keys, signing files, logs, fixtures and development tools.
    ignore: file => !!file && (!/^\/(?:build(?:\/|$)|main\.cjs$|security\.cjs$|workspace\.cjs$|preload-control\.cjs$|preload-display\.cjs$|package\.json$)/.test(file) || /^\/build\/(?:installer(?:\/|$)|license-audit(?:\/|$)|installer-(?:loading\.gif|preview\.png)$)/.test(file)),
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
};
