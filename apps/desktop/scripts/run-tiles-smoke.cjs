const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
async function run(name) {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, name)], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(name + ' failed: ' + code)));
  });
}
(async () => { await run('tiles-smoke.cjs'); await run('tiles-restart-smoke.cjs'); })().catch(error => { console.error(error.message); process.exitCode = 1; });
