import{n as _}from"./chunk-ChpBd9eV.js";function N(o,t){const n=t?`${t}.`:"",a=o.unsafe(`${n}call_origin`),e=o.unsafe(`${n}tool_name`);return o`(
    ${a} = ANY(${[...c]}::text[])
    OR (${a} IS NULL AND ${e} = ANY(${[...i]}::text[]))
  )`}function $(o,t){const n=t?`${t}.`:"",a=o.unsafe(`${n}call_origin`),e=o.unsafe(`${n}tool_name`);return o`(
    ${a} = ANY(${[...r]}::text[])
    OR (${a} IS NULL AND ${e} <> ALL(${[...i]}::text[]))
  )`}var i,s,c,r,O=_((()=>{i=["activity:report","coord:glance","coord:inbox"],s=["loop:checkpoint","work_items:checkpoint"],c=["hook","ui","system"],r=["agent","unknown"]}));export{$ as a,s as i,c as n,N as o,i as r,O as s,r as t};
