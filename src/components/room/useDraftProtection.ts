"use client";
import { useEffect } from "react";

/** Drafts remain in memory; native navigation must not silently discard them. */
export function useDraftProtection(dirty: boolean) {
 useEffect(()=>{
  if(!dirty) return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
  const navigate=(event:MouseEvent)=>{
   if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
   const anchor=(event.target as Element|null)?.closest<HTMLAnchorElement>("a[href]");
   if(!anchor || anchor.hasAttribute("data-sfm-navigation") || anchor.target==="_blank" || anchor.hasAttribute("download") || anchor.href===window.location.href) return;
   if(!window.confirm("You have unconfirmed changes in your brief. Leave without saving them?")){event.preventDefault();event.stopPropagation();}
  };
  const cloudNavigate=(event:Event)=>{if(!window.confirm("You have unconfirmed changes in your brief. Leave without saving them?")) event.preventDefault();};
  window.addEventListener("sfm:before-navigate",cloudNavigate);
  window.addEventListener("beforeunload",unload);document.addEventListener("click",navigate,true);
  return()=>{window.removeEventListener("sfm:before-navigate",cloudNavigate);window.removeEventListener("beforeunload",unload);document.removeEventListener("click",navigate,true);};
 },[dirty]);
}
