const path = require('node:path');

// Forge still owns the runtime allowlist. electron-builder receives only its
// already-packaged application; it does not walk the repository for app files.
function installerConfig(root, output) {
  return {
    appId: 'org.windchime.desktop',
    productName: 'WindChime',
    copyright: 'Copyright (c) 2026 WindChime contributors',
    directories: { output, buildResources: path.join(root, 'build/installer') },
    publish: null,
    npmRebuild: false,
    win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(root, 'build/icon.ico'),
      ...(process.env.WINDCHIME_CERTIFICATE_FILE ? { signtoolOptions: { certificateFile: process.env.WINDCHIME_CERTIFICATE_FILE, certificatePassword: process.env.WINDCHIME_CERTIFICATE_PASSWORD } } : {}),
    },
    nsis: {
      artifactName: 'WindChime-Engine-${version}.exe',
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      runAfterFinish: true,
      packElevateHelper: false,
      differentialPackage: false,
      // Our confirmation page owns both explicit shortcut choices. Their names
      // differ from Squirrel's WindChime.lnk so an old uninstall cannot remove them.
      createDesktopShortcut: false,
      createStartMenuShortcut: false,
      shortcutName: '风铃 WindChime',
      uninstallDisplayName: 'WindChime ${version}（安装向导版）',
      installerLanguages: ['zh_CN'],
      language: '2052',
      displayLanguageSelector: false,
      installerIcon: path.join(root, 'build/icon.ico'),
      uninstallerIcon: path.join(root, 'build/icon.ico'),
      installerHeader: path.join(root, 'build/installer/wizard-header.bmp'),
      installerSidebar: path.join(root, 'build/installer/wizard-sidebar.bmp'),
      include: path.join(root, 'installer/wizard.nsh'),
      license: path.join(root, 'build/licenses/WindChime-MIT.txt'),
    },
  };
}
module.exports = { installerConfig };
