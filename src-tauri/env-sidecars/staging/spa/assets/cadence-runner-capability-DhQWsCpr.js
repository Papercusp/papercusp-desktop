import{n as R}from"./chunk-ChpBd9eV.js";import{st as M,t as E}from"./src-8fWtxfEz.js";import{o as m,s as N}from"./resource-profile-DqktAQ65.js";async function h(e,n){const{sql:t}=M();return(await t`
    SELECT 1
    FROM harness_shared.routines
    WHERE workspace_id = ${e}
      AND install_slug = ${n}
      AND active = true
      AND name = ANY(${[...w]}::text[])
    LIMIT 1
  `).length>0}async function T(e,n,t={}){const c=t.now??Date.now,i=t.ttlMs??_,o=`${e}::${n}`,r=c();if(i>0){const s=u.get(o);if(s&&r-s.atMs<i)return s.value}let a=!1;try{(t.dbosLaunches??m)()&&(a=await(t.hasActiveCadenceRoutine??h)(e,n))}catch{a=!1}return i>0&&u.set(o,{value:a,atMs:r}),a}async function v(e,n){const{sql:t}=M();return(await t`
    SELECT DISTINCT name
    FROM harness_shared.routines
    WHERE workspace_id = ${e}
      AND install_slug = ${n}
      AND active = true
    ORDER BY name
  `).map(c=>c.name).filter(c=>typeof c=="string"&&c.length>0)}async function C(e,n,t={}){const c=t.now??Date.now,i=t.ttlMs??_,o=`${e}::${n}`,r=c();if(i>0){const s=l.get(o);if(s&&r-s.atMs<i)return s.value}let a=f;try{if((t.dbosLaunches??m)()){const s=await(t.activeRoutineNames??v)(e,n);a=Object.freeze([...new Set(s)].sort())}}catch{a=f}return i>0&&l.set(o,{value:a,atMs:r}),a}var w,_,u,l,f,L=R((()=>{E(),N(),w=["gym-cycle","scout-cycle"],_=6e4,u=new Map,l=new Map,f=Object.freeze([])}));export{T as i,L as n,C as r,w as t};
