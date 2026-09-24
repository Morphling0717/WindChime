const {spawn}=require('node:child_process');
const path=require('node:path');
const electron=require('electron');
async function run(script){await new Promise((resolve,reject)=>{const child=spawn(electron,[path.join(__dirname,script)],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(script+' failed: '+code)));});}
(async()=>{await run('management-smoke.cjs');await run('poster-restore-smoke.cjs');})().catch(error=>{console.error(error.message);process.exitCode=1;});
