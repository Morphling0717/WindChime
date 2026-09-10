const path = require('node:path');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'WindChime',
    icon: path.join(__dirname, 'build/icon.ico'),
    appBundleId: 'org.windchime.desktop',
    // Ship only the bundled local UI and hand-written runtime. This excludes
    // .env, platform keys, signing files, logs, fixtures and development tools.
    ignore: file => !!file && !/^\/(?:build(?:\/|$)|main\.cjs$|security\.cjs$|preload-control\.cjs$|preload-display\.cjs$|package\.json$)/.test(file),
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { name: 'WindChime', setupExe: 'WindChime-Setup.exe', authors: 'WindChime contributors', description: '风铃直播信箱控制台', setupIcon: path.join(__dirname, 'build/icon.ico'),
      ...(process.env.WINDCHIME_CERTIFICATE_FILE ? { certificateFile: process.env.WINDCHIME_CERTIFICATE_FILE, certificatePassword: process.env.WINDCHIME_CERTIFICATE_PASSWORD } : {}),
    } },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
};
