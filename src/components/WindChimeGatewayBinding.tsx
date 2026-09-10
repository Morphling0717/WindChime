"use client";
import { useEffect, useMemo, useState } from "react";
import { createWindChimeLiveClient } from "../client/live.js";

type Pending = { gateway: string; pairingId: string; completionToken: string; topicId: string; expiresAt: number; bindingId?: string };
const storageKey = "windchime:gateway-pairing:v1";
/** Private site page only. The site server, not this UI, verifies gateway proofs. */
export function WindChimeGatewayBinding({ gatewayOrigin = "", topicId = "default" }: { gatewayOrigin?: string; topicId?: string }) {
  const client = useMemo(() => createWindChimeLiveClient(), []);
  const [gateway, setGateway] = useState(gatewayOrigin);
  const [scope, setScope] = useState(topicId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [proof, setProof] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    setScope(query.get("topicId") || topicId);
    const hash = new URLSearchParams(location.hash.slice(1));
    const received = hash.get("gatewayBindingProof");
    if (!received) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as Pending | null;
        if (saved?.bindingId && saved.expiresAt > Date.now() / 1000) { setPending(saved); setScope(saved.topicId); }
      } catch { /* An unavailable storage backend requires a new pairing. */ }
      return;
    }
    history.replaceState(null, "", location.pathname + location.search);
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as Pending | null;
      if (!saved || saved.expiresAt <= Date.now() / 1000 || saved.pairingId !== hash.get("gatewayPairingId") || saved.gateway !== hash.get("gatewayOrigin"))
        throw Error("配对已失效或不属于本窗口，请重新发起连接");
      setPending(saved); setProof(received); setScope(saved.topicId); setGateway(saved.gateway);
    } catch (err) { setError(err instanceof Error ? err.message : "读取配对失败"); }
  }, [topicId]);
  async function request(url: string, body: unknown, token?: string) {
    const response = await fetch(url, {method:"POST", credentials:"omit", redirect:"error", cache:"no-store",
      signal:AbortSignal.timeout(10_000), headers:{"content-type":"application/json", ...(token ? {authorization:`Bearer ${token}`} : {})}, body:JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || data.code || "网关请求失败");
    return data;
  }
  async function begin() {
    setBusy(true); setError("");
    try {
      const origin = new URL(gateway).origin;
      if (!origin.startsWith("https://") && !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw Error("网关必须使用 HTTPS");
      const challenge = await client.bindingChallenge(scope);
      const pairing = await request(origin + "/api/pairings", {...challenge, returnUrl:location.origin + "/mail/connect?topicId=" + encodeURIComponent(scope)});
      const target = new URL(pairing.pairingUrl);
      if (target.origin !== origin) throw Error("网关返回了不匹配的配对地址");
      sessionStorage.setItem(storageKey, JSON.stringify({gateway:origin,pairingId:pairing.pairingId,completionToken:pairing.completionToken,topicId:scope,expiresAt:pairing.expiresAt}));
      location.assign(target.href);
    } catch (err) { setError(err instanceof Error ? err.message : "无法发起连接"); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (!pending || (!proof && !pending.bindingId)) return;
    setBusy(true); setError("");
    try {
      const binding = pending.bindingId ? { bindingId: pending.bindingId } : await client.bind(scope, proof);
      const confirmed = { ...pending, bindingId: binding.bindingId };
      setPending(confirmed); sessionStorage.setItem(storageKey, JSON.stringify(confirmed));
      await request(`${pending.gateway}/api/pairings/${pending.pairingId}/complete`, {bindingId:binding.bindingId}, pending.completionToken);
      sessionStorage.removeItem(storageKey); setProof(""); setPending(null); setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "绑定失败"); }
    finally { setBusy(false); }
  }
  return <section style={{maxWidth:700,padding:24,margin:"30px auto",lineHeight:1.8}}>
    <h1>连接 B 站直播插件</h1>
    <p><a href="/mail/live">返回私人控制台</a> · <a href="/mail">网站后台登录</a></p>
    <p>当前话题：{scope}。绑定只允许插件读取这个话题中当前手动上屏的信件。</p>
    <p>网站管理员需预先配置可信网关地址与公钥。B 站密钥只保存在网关服务器。</p>
    {done ? <p role="status">绑定完成。打开直播插件后，在私人控制台手动选择信件上屏。</p> : pending ? <>
      <p>平台身份验证已返回。点击下方按钮，授权该身份连接当前话题；服务器会再次核验身份与配对记录。</p>
      <button disabled={busy} onClick={() => void finish()}>确认绑定当前话题</button>
    </> : <>
      <label>直播网关地址 <input type="url" value={gateway} onChange={e=>setGateway(e.target.value)} placeholder="https://live.example.com" style={{width:"100%"}} /></label>
      <button disabled={busy || !gateway} onClick={() => void begin()}>前往 B 站身份验证</button>
    </>}
    <p><button disabled={busy} onClick={async () => {setBusy(true);setError("");try{await client.unbind(scope);setDone(false);setProof("");setPending(null);sessionStorage.removeItem(storageKey);}catch(err){setError(err instanceof Error?err.message:"解绑失败");}finally{setBusy(false);}}}>撤销此话题的插件绑定并隐藏</button></p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
