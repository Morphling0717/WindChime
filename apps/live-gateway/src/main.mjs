import { createGateway,configFromEnv } from './server.mjs';
import { GatewayState,loadSigningKey } from './state.mjs';

const config=configFromEnv();
const state=await GatewayState.open(config.dataDir);
const signingKey=await loadSigningKey(config.dataDir);
const gateway=createGateway({config,state,signingKey});
gateway.server.listen(config.port,config.host,()=> {
  console.log(`WindChime gateway listening at ${config.origin}. Inbox content is never stored here.`);
  console.log(`Public signing key metadata: ${config.origin}/.well-known/windchime-gateway.json`);
});
let closing=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=> {
  if(closing) return; closing=true;
  await gateway.close(); process.exit(0);
});
