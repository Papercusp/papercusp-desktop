#!/usr/bin/env -S npx tsx
function parseArgs(argv){let out={slug:"",featureId:""};for(let i=0;i<argv.length;i++){let a=argv[i],next=argv[i+1];switch(a){case"--slug":out.slug=next??"",i++;break;case"--feature-id":out.featureId=next??"",i++;break;default:if(a.startsWith("--"))throw new Error(`unknown flag: ${a}`)}}if(!out.slug)throw new Error("--slug is required");if(!out.featureId)throw new Error("--feature-id is required");return out}async function main(){let args;try{args=parseArgs(process.argv.slice(2))}catch(err){process.stderr.write(`get-plan-context: ${err.message}
`),process.exit(1)}let url=`${process.env.PAPERCUSP_OPERATOR_BASE??"http://localhost:3055"}/api/harness/${args.slug}/features/${args.featureId}/plan-context`;try{let res=await fetch(url,{signal:AbortSignal.timeout(3e3)});res.ok||(res.status===404&&process.exit(0),process.stderr.write(`get-plan-context: HTTP ${res.status} from operator
`),process.exit(0));let section=(await res.json()).section??"";section.trim()&&(process.stdout.write(section),section.endsWith(`
`)||process.stdout.write(`
`))}catch{process.exit(0)}}main();
