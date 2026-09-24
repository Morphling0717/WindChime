/** Preserve reconnect authorization only; never store frames, approval or rendered content. */
export function readDisplayBootstrap(href) {
  const url=new URL(href);const params=new URLSearchParams(url.hash.slice(1));
  const initialProof=params.get('gatewayDisplayProof');const gatewayOrigin=params.get('gatewayOrigin');const bridgeId=params.get('gatewayBridgeId');
  const platformMode=!!(initialProof||gatewayOrigin||bridgeId);
  const preserved=new URLSearchParams();
  const reconnectKeys=platformMode?['siteBaseUrl','gatewayOrigin','gatewayBridgeId','gatewayBindingId']:['siteBaseUrl','token'];
  for(const key of reconnectKeys)if(params.has(key))preserved.set(key,params.get(key));
  url.hash=preserved.toString(); // An already-used JWT cannot be redeemed a second time after reload.
  url.search='';
  return {siteBaseUrl:params.get('siteBaseUrl'),displayToken:platformMode?'':(params.get('token')||''),initialProof,gatewayOrigin,bridgeId,platformMode,reloadUrl:url.pathname+url.hash};
}
