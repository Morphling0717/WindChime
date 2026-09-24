const {describe,test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {execFile}=require('node:child_process');
const exec=promisify(execFile);
const {buildTransactionEngine}=require('../scripts/build-transaction-engine.cjs');
const {listPayload}=require('../scripts/build-glass-setup.cjs');

describe('NSIS stage-only engine with synthetic payload',{skip:process.platform!=='win32'},()=>{
 let temporary,engine,payload;
 before(async()=>{
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'windchime-stage-engine-tests-'));
  const source=path.join(temporary,'source');await fs.mkdir(path.join(source,'resources'),{recursive:true});
  await fs.writeFile(path.join(source,'WindChime.exe'),'Synthetic executable fixture; never launch this file.');
  await fs.writeFile(path.join(source,'resources/app.asar'),'Synthetic runtime fixture.');
  ({engine,payload}=await buildTransactionEngine({root:path.resolve(__dirname,'..'),packaged:source,outputDirectory:path.join(temporary,'build')}));
 });
 async function prepare(options={}){
  const parent=await fs.mkdtemp(path.join(temporary,'case-')),id=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(16).toString('hex');
  const root=path.join(parent,'.WindChime-Setup-'+id),stage=path.join(root,'new'),file=path.join(root,'WindChime-Extract-'+id+'.exe');
  await fs.mkdir(stage,{recursive:true});await fs.copyFile(engine,file);
  await fs.writeFile(path.join(root,'request.ini'),'\ufeff[WindChime]\r\nProtocol=2\r\nAppId=org.windchime.desktop\r\nToken='+token+'\r\nTransaction='+id+'\r\nStage='+(options.outside?parent:stage)+'\r\n','utf16le');
  return {parent,id,token,root,stage,file};
 }
 async function run(value,args,expected){try{await exec(value.file,args,{windowsHide:true,timeout:15000});assert.equal(expected,0);}catch(error){assert.equal(error.code,expected,error.stderr||error.message);}}
 test('opening the internal engine directly does not extract or install',async()=>{const value=await prepare();await run(value,[],87);assert.deepEqual(await fs.readdir(value.stage),[]);});
 test('a wrong private token is rejected',async()=>{const value=await prepare();await run(value,['/S','/WC_BOOTSTRAP='+ '0'.repeat(32)],87);assert.deepEqual(await fs.readdir(value.stage),[]);});
 test('a request cannot redirect extraction outside its fresh transaction',async()=>{const value=await prepare({outside:true});await run(value,['/S','/WC_BOOTSTRAP='+value.token],87);assert.deepEqual(await fs.readdir(value.parent),[path.basename(value.root)]);});
 test('the real engine writes all declared files only into the private stage',async()=>{const value=await prepare();const existing=path.join(value.parent,'WindChime');await fs.mkdir(existing);await fs.writeFile(path.join(existing,'sentinel'),'existing installation remains available');await run(value,['/S','/WC_BOOTSTRAP='+value.token],0);assert.deepEqual(await listPayload(value.stage),await listPayload(payload));assert.equal(await fs.readFile(path.join(existing,'sentinel'),'utf8'),'existing installation remains available');assert.deepEqual(await fs.readdir(value.parent),[path.basename(value.root),'WindChime']);});
 test('nonempty staging directories are not overwritten',async()=>{const value=await prepare();await fs.writeFile(path.join(value.stage,'sentinel'),'never overwrite');await run(value,['/S','/WC_BOOTSTRAP='+value.token],87);assert.equal(await fs.readFile(path.join(value.stage,'sentinel'),'utf8'),'never overwrite');});
 test('linked staging directories cannot redirect extraction',async()=>{const value=await prepare();const outside=path.join(value.parent,'outside');await fs.mkdir(outside);await fs.rmdir(value.stage);await fs.symlink(outside,value.stage,'junction');await run(value,['/S','/WC_BOOTSTRAP='+value.token],87);assert.deepEqual(await fs.readdir(outside),[]);});
});
