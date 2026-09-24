"use client";
import { useEffect, useState } from "react";
import { createWindChimeDisplayClient, type WindChimeDisplayClient } from "@windchime/embed/client";
import { WindChimeLiveDisplay } from "@windchime/embed/broadcast";
export default function Display() {
  const [client,setClient]=useState<WindChimeDisplayClient|null>(null);
  useEffect(()=>{
    const token=new URLSearchParams(location.hash.slice(1)).get("token");
    if(token) setClient(createWindChimeDisplayClient({token}));
  },[]);
  return client?<WindChimeLiveDisplay client={client}/>:null;
}
