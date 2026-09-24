"use client";
import {useEffect,useMemo,useState} from "react";
import {createWindChimeLiveClient} from "@windchime/embed/client";
import {WindChimeLiveControlPanel} from "@windchime/embed/broadcast";
export default function Live() {
  const client=useMemo(()=>createWindChimeLiveClient(),[]);
  const [displayUrl,setDisplayUrl]=useState("");
  const [topicId,setTopicId]=useState("default");
  useEffect(()=>{setDisplayUrl(location.origin+"/display");setTopicId(new URLSearchParams(location.search).get("topicId")||"default");},[]);
  return <><p><a href="/admin">返回管理后台 / 登录</a></p><WindChimeLiveControlPanel client={client} topicId={topicId} displayUrl={displayUrl}/></>;
}
