const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const {hashFile,listPayload}=require('./build-glass-setup.cjs');

// This executes only the stage-only engine against a brand-new private fixture.
// It never starts the public setup, installed application or uninstaller, never
// writes registry/shortcuts, and cannot touch the user's existing installation.
async function verifyInstallerStage(stage) {
 assert.equal(process.platform,'win32');
 stage=path.resolve(stage);assert.match(path.basename(stage),/^windchime-make-[A-Za-z0-9_-]+$/);
 const root=path.resolve(__dirname,'..'),{version}=require('../package.json');
 const manifest=JSON.parse(await fs.readFile(path.join(stage,'nsis/glass-build/Payload.json'),'utf8'));
 assert.equal(manifest.version,version);assert.equal(manifest.appId,'org.windchime.desktop');
 const source=path.join(stage,`nsis/WindChime-Engine-${version}.exe`);
 assert.equal(await hashFile(source),manifest.engineSha256);
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'windchime-full-stage-fixture-'));
 const id=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(16).toString('hex');
 const transaction=path.join(temporary,'.WindChime-Setup-'+id),destination=path.join(transaction,'new');
 await fs.mkdir(destination,{recursive:true});
 const existing=path.join(temporary,'WindChime');await fs.mkdir(existing);
 const sentinel=crypto.randomBytes(64);await fs.writeFile(path.join(existing,'existing-program-sentinel'),sentinel);
 const engine=path.join(transaction,'WindChime-Extract-'+id+'.exe');await fs.copyFile(source,engine);
 await fs.writeFile(path.join(transaction,'request.ini'),'\ufeff[WindChime]\r\nProtocol=2\r\nAppId=org.windchime.desktop\r\nToken='+token+'\r\nTransaction='+id+'\r\nStage='+destination+'\r\n','utf16le');
 const started=Date.now();await exec(engine,['/S','/WC_BOOTSTRAP='+token],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 assert.deepEqual(await listPayload(destination),manifest.files);
 assert((await fs.readFile(path.join(existing,'existing-program-sentinel'))).equals(sentinel));
 assert.deepEqual(await fs.readdir(existing),['existing-program-sentinel']);
 const report={passed:true,version,testedAt:new Date().toISOString(),stage,temporary,elapsedMs:Date.now()-started,payloadFilesMatched:manifest.files.length,engineSha256:manifest.engineSha256,existingSyntheticProgramUnchanged:true,executedStageOnlyEngine:true,executedPublicSetup:false,registeredApplication:false,executedUninstaller:false,limitations:['This verifies full extraction only; Windows registry/shortcut install and uninstall have not been performed.']};
 await fs.writeFile(path.join(root,`out/releases/${version}/installer-stage-verification.json`),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module)verifyInstallerStage(process.argv[2]).then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyInstallerStage};
