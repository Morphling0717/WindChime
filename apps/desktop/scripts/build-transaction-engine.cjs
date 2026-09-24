const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { getMakeNsisPath, getNsisPluginsPath } = require('app-builder-lib/out/toolsets/windows');
const { nsisEscapeString } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
const { listPayload } = require('./build-glass-setup.cjs');

// Standalone two-pass NSIS compilation: the first helper writes an uninstaller
// only inside this fresh build staging directory. No registry/install operation
// is present in its installer section. The second embeds that exact uninstaller.
async function buildTransactionEngine({root,packaged,outputDirectory}) {
  if(process.env.WINDCHIME_CERTIFICATE_FILE)throw new Error('The transaction installer does not yet implement certificate signing. Do not distribute an unsigned package as a signed build.');
  const { version } = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  await listPayload(packaged); // reject symlinks before copying the runtime
  await fs.mkdir(outputDirectory,{recursive:true});
  const payload=path.join(outputDirectory,'transaction-payload');
  await fs.cp(packaged,payload,{recursive:true,errorOnExist:true,force:false});
  const uninstaller=path.join(payload,'Uninstall WindChime.exe');
  const compiler=await getMakeNsisPath();const plugins=await getNsisPluginsPath();
  const definitions={APP_ID:'org.windchime.desktop',APP_GUID:'e76db02f-8e92-5190-9ffc-b8c1df592d69',APP_EXECUTABLE_FILENAME:'WindChime.exe',SHORTCUT_NAME:'风铃 WindChime',VERSION:version,
    WC_ICON:path.join(root,'build/icon.ico'),WC_PAYLOAD:payload,WC_UNINSTALLER:uninstaller};
  const source=await fs.readFile(path.join(root,'installer/transaction-engine.nsi'),'utf8');
  async function compile(name,generate) {
    const output=path.join(outputDirectory,name+'.exe');const script=path.join(outputDirectory,name+'.nsi');
    const header=[...Object.entries({...definitions,WC_OUTPUT:output}).map(([key,value])=>`!define ${key} "${nsisEscapeString(value)}"`),
      `!addincludedir "${nsisEscapeString(path.join(root,'installer'))}"`,
      `!addplugindir /x86-unicode "${nsisEscapeString(path.join(plugins,'x86-unicode'))}"`,generate?'!define WC_GENERATE_UNINSTALLER':''].join('\n');
    await fs.writeFile(script,header+'\n'+source);
    await exec(compiler.path,['-INPUTCHARSET','UTF8','-V2',script],{windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,...compiler.env}});
    return output;
  }
  const generator=await compile('WindChime-Uninstaller-Writer',true);
  await exec(generator,[],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  await fs.writeFile(path.join(payload,'resources/windchime-install.ini'),'\ufeff[WindChime]\r\nAppId=org.windchime.desktop\r\nVersion='+version+'\r\n','utf16le');
  const engine=await compile('WindChime-Engine-'+version,false);
  return {engine,payload};
}
module.exports={buildTransactionEngine};
