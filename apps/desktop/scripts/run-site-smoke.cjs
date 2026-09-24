const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function run(){
  if(process.env.WINDCHIME_SMOKE_ALLOW_WRITES!=='1'||!process.env.WINDCHIME_SMOKE_PASSWORD)throw Error('Set explicit localhost fixture write opt-in and test password');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'windchime-site-smoke-'));console.log(JSON.stringify({directory}));
  for(const phase of ['first','restart'])await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[path.join(__dirname,'site-smoke.cjs')],{stdio:'inherit',windowsHide:true,env:{...process.env,WINDCHIME_SITE_SMOKE_DIRECTORY:directory,WINDCHIME_SITE_SMOKE_PHASE:phase}});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`${phase} exited ${code}`)));
  });
  console.log(JSON.stringify({passed:true,directory,phases:2}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
