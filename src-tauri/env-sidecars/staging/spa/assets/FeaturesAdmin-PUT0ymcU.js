import{o as j}from"./chunk-ChpBd9eV.js";import{t as w}from"./react-DqHYuLt-.js";import{t as y}from"./jsx-runtime-BmDUFisN.js";import{r as S}from"./resilient-event-source-DhKUSc87.js";import{n as g}from"./dist-C7mPGmVK.js";import{o as T,s}from"./client-Dg3eibAg.js";import{t as m}from"./Tooltip-BRMSMTLQ.js";import{t as P}from"./useLexicon-DWO-_pBS.js";var l=j(w()),e=y();function O(n){return{[s.CLOUDFLARE_PUBLISH]:"Cloudflare publishing",[s.HARNESS_PHASES]:`${n("pot")} phases`,[s.DESIGN]:"Design tab",[s.CONVERSATIONS_RAIL_TAB]:"Convos tab (middle rail)",[s.TESTING]:"Testing surfaces",[s.INBOX_DURABLE_ESCALATIONS]:"Durable inbox escalations",[s.IMPROVEMENT_AUTO_IMPLEMENT]:"Auto-implement improvements",[s.VIDEO_CHANNELS]:"Video channels (desktop)",[s.VOICE_CHANNELS]:"Voice channels (desktop)",[s.THE_HIVE]:"The Swarm (bee lexicon)",[s.OPEN_SIGNUP]:"Open signup",[s.ENDPOINT_AUTH_TIERS]:"Endpoint auth tiers",[s.ACCEPT_DELEGATED_SEATS]:"Accept delegated seats"}}function _(n){return{[s.CLOUDFLARE_PUBLISH]:"Publish-to-Cloudflare flow. Cut for V1 ship.",[s.CONVERSATIONS_RAIL_TAB]:"The 💬 Convos tab in the middle steering rail. OFF (default): the rail ends at Spend. ON: Convos returns to its owner-set last position. Nothing is lost while it is off — /adv keeps its own Conversations tab on the same data.",[s.HARNESS_PHASES]:`Multi-phase ${n("pot")} (staging / testing / production). Cut for V1 ship.`,[s.DESIGN]:`In-${n("pot")} design tab + /design route. Cut for V1 ship.`,[s.TESTING]:"Testing-only surfaces: pi tab, + add plugin button, Oracle assistant (tutorial dock + menubar button + /api/oracle). Cut for V1 ship.",[s.INBOX_DURABLE_ESCALATIONS]:"Mirror chat decision cards to durable coord escalations (answer live or from the inbox).",[s.IMPROVEMENT_AUTO_IMPLEMENT]:"Master switch for auto-implementing captured improvements. Off = capture + triage only.",[s.VIDEO_CHANNELS]:`Desktop P2P video channel (participant-grid) for shared ${n("pot",{plural:!0,lower:!0})}. Off until the live-camera E2E passes.`,[s.VOICE_CHANNELS]:`Desktop P2P voice channel (holepunch) for shared ${n("pot",{plural:!0,lower:!0})}. Off until the live Tauri+mic pass.`,[s.THE_HIVE]:"Bee-themed user-facing lexicon, internal/testing skin (Pot→Hive, Fleet→Colony, Papercup→Sentinel, Mug→Queen, Cup→Bee, Humans→Keepers; Swarm = a deployment). Presentation only — code/DB/tools unchanged. Off = classic Papercusp (the public one-identity lexicon, voice-release D-001).",[s.OPEN_SIGNUP]:"Allow new account signup after the first user exists. Off (default): the internet-facing /auth/signup only bootstraps the first account — security gate, deliberate default-OFF.",[s.ENDPOINT_AUTH_TIERS]:"Enforce loopback-tier routes at the dispatch chokepoint (auth-tier Wave 1: mutating routes reject non-loopback hosts). Off = emergency revert to pre-rollout behavior.",[s.ACCEPT_DELEGATED_SEATS]:"Let a REMOTE fleet owner spawn agents on THIS host (delegated agent seats — agent-allocation P-008). Off (default): this host honors no delegated-seat spawn requests. On: opt in to run agents delegated by fleets you belong to, bounded by this host’s capability envelope + the seat count/account/budget caps. A trust decision — enable only for owners you intend to contribute capacity to."}}function M(){const n=P(),u=(0,l.useMemo)(()=>O(n),[n]),x=(0,l.useMemo)(()=>_(n),[n]),[c,b]=(0,l.useState)({kind:"loading"}),[p,d]=(0,l.useState)(null),i=(0,l.useCallback)(async()=>{try{const[a,t]=await Promise.all([fetch("/api/flags/testing-features",{cache:"no-store"}),fetch("/api/flags/bootstrap",{cache:"no-store"})]);if(!a.ok)throw new Error(`HTTP ${a.status} on /api/flags/testing-features`);if(!t.ok)throw new Error(`HTTP ${t.status} on /api/flags/bootstrap`);const r=await a.json(),f=await t.json();b({kind:"ok",testingFeatures:r.testingFeatures,source:r.source,flags:f.flags})}catch(a){b({kind:"error",message:String(a?.message??a)})}},[]);(0,l.useEffect)(()=>{i()},[i]),(0,l.useEffect)(()=>{if(typeof EventSource>"u")return;const a=S({url:"/api/flags/stream",withCredentials:!0,handlers:{flag_changed:()=>{i()},flags_payload:()=>{i()}}});return()=>a.close()},[i]);async function h(a){d(`preset:${a}`);try{const t=await fetch("/api/flags/preset",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:a})}),r=await t.json();if(!t.ok||!r.ok)throw new Error(r.error??`HTTP ${t.status}`);g.success(a==="production"?"Switched to V1 Production":"Switched to Full testing"),await i()}catch(t){g.error("Failed to apply preset",{description:t.message})}finally{d(null)}}async function N(a){d("testing-features");try{const t=await fetch("/api/flags/testing-features",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({enabled:a})}),r=await t.json();if(!t.ok||!r.ok)throw new Error(r.error??`HTTP ${t.status}`);await i(),g.success(a?"testingFeatures enabled":"testingFeatures disabled")}catch(t){g.error("Failed to update testingFeatures",{description:t.message})}finally{d(null)}}async function v(a,t){d(`flag:${a}`);try{const r=await fetch("/api/flags/set",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:a,enabled:t})}),f=await r.json();if(!r.ok||!f.ok)throw new Error(f.error??`HTTP ${r.status}`);await i()}catch(r){g.error(`Failed to update ${u[a]??a}`,{description:r.message})}finally{d(null)}}if(c.kind==="loading")return(0,e.jsx)("div",{className:"fa-shell",children:(0,e.jsx)("div",{className:"fa-spinner",children:"Loading…"})});if(c.kind==="error")return(0,e.jsx)("div",{className:"fa-shell",children:(0,e.jsxs)("div",{className:"fa-error",children:["Failed to load: ",c.message]})});const o=c.testingFeatures,E=c.flags;return(0,e.jsxs)("div",{className:"fa-shell",children:[(0,e.jsxs)("section",{className:"fa-section",children:[(0,e.jsx)("h2",{className:"fa-h2",children:"Preset"}),(0,e.jsx)("p",{className:"fa-p",children:"One-click swap between V1 ship state and the full testing build."}),(0,e.jsxs)("div",{className:"fa-presets",children:[(0,e.jsxs)("button",{type:"button",className:`fa-preset${o?"":" active"}`,disabled:p!==null,onClick:()=>h("production"),children:[(0,e.jsx)("span",{className:"fa-preset-emoji",children:"🚀"}),(0,e.jsx)("span",{className:"fa-preset-title",children:"V1 Production"}),(0,e.jsx)("span",{className:"fa-preset-blurb",children:"testingFeatures = false · bundled defaults serve everything · zero PostHog contact"}),p==="preset:production"&&(0,e.jsx)("span",{className:"fa-preset-busy",children:"…"})]}),(0,e.jsxs)("button",{type:"button",className:`fa-preset${o?" active":""}`,disabled:p!==null,onClick:()=>h("testing"),children:[(0,e.jsx)("span",{className:"fa-preset-emoji",children:"🧪"}),(0,e.jsx)("span",{className:"fa-preset-title",children:"Full testing"}),(0,e.jsx)("span",{className:"fa-preset-blurb",children:"testingFeatures = true · all flags flipped on in PostHog"}),p==="preset:testing"&&(0,e.jsx)("span",{className:"fa-preset-busy",children:"…"})]})]})]}),(0,e.jsxs)("section",{className:"fa-section",children:[(0,e.jsx)("h2",{className:"fa-h2",children:"Master switch"}),(0,e.jsxs)("div",{className:"fa-master",children:[(0,e.jsxs)("div",{className:"fa-master-text",children:[(0,e.jsx)("strong",{children:"testingFeatures"})," ",(0,e.jsx)("span",{className:`fa-pill ${o?"on":"off"}`,children:o?"on":"off"}),(0,e.jsxs)("div",{className:"fa-master-blurb",children:[o?"Papercusp is phoning home to flags.papercuspai.com. Per-flag toggles below are live.":"Papercusp is using bundled defaults (most finished flags on by default). PostHog is not being contacted.",(0,e.jsx)("br",{}),(0,e.jsxs)("span",{className:"fa-source",children:["Config source: ",c.source]})]})]}),(0,e.jsx)(m,{label:o?"Disable testingFeatures":"Enable testingFeatures",side:"top",align:"end",children:(0,e.jsx)("button",{type:"button",className:`fa-toggle${o?" on":""}`,disabled:p!==null,onClick:()=>N(!o),"aria-pressed":o,children:(0,e.jsx)("span",{className:"fa-toggle-knob"})})})]})]}),(0,e.jsxs)("section",{className:"fa-section",children:[(0,e.jsx)("h2",{className:"fa-h2",children:"Per-flag toggles"}),(0,e.jsxs)("p",{className:"fa-p",children:["Effective values shown reflect what the operator is currently serving.",!o&&(0,e.jsx)(e.Fragment,{children:" When testingFeatures is off, toggles below have no effect — turn it on first."})]}),(0,e.jsx)("div",{className:"fa-flags",children:T.map(a=>{const t=E[a]??!1,r=u[a]??a,f=x[a]??"";return(0,e.jsxs)("div",{className:`fa-flag${o?"":" disabled"}`,children:[(0,e.jsxs)("div",{className:"fa-flag-main",children:[(0,e.jsx)("div",{className:"fa-flag-name",children:r}),(0,e.jsx)("div",{className:"fa-flag-blurb",children:f}),(0,e.jsx)("div",{className:"fa-flag-key",children:a})]}),(0,e.jsx)(m,{label:o?t?"Disable this flag":"Enable this flag":"Turn on testingFeatures first",side:"top",align:"end",children:(0,e.jsx)("button",{type:"button",className:`fa-toggle${t?" on":""}`,disabled:!o||p!==null,onClick:()=>v(a,!t),"aria-pressed":t,children:(0,e.jsx)("span",{className:"fa-toggle-knob"})})})]},a)})})]}),(0,e.jsx)("style",{children:`
        .fa-shell {
          padding: 24px 24px 56px;
          max-width: 1060px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .fa-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 18px 18px 20px;
          border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 86%);
          border-radius: 16px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-1), transparent 6%), color-mix(in srgb, var(--bg-deep), transparent 2%));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.035),
            0 18px 34px rgba(0,0,0,0.18);
        }
        .fa-h2 {
          margin: 0;
          font-size: 11px;
          font-weight: 760;
          color: rgba(203, 238, 255, 0.76);
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .fa-p {
          margin: 0;
          color: rgba(214, 236, 248, 0.72);
          font-size: 13px;
          line-height: 1.55;
        }
        .fa-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 4px; }
        .fa-preset {
          display: flex; flex-direction: column; gap: 6px;
          padding: 18px 16px; min-height: 110px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-deep), transparent 8%);
          border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 84%);
          color: #eff8ff;
          text-align: left;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
          transition: background 120ms, border-color 120ms, transform 120ms;
        }
        .fa-preset:hover:not(:disabled) {
          background: color-mix(in srgb, var(--bg-1), transparent 2%);
          border-color: rgb(from var(--accent-strong) r g b / 0.30);
          transform: translateY(-1px);
        }
        .fa-preset.active {
          background: linear-gradient(180deg, color-mix(in srgb, var(--bg-raised), transparent 2%), color-mix(in srgb, var(--bg-1), transparent 1%));
          border-color: rgb(from var(--accent-strong) r g b / 0.42);
        }
        .fa-preset:disabled { opacity: 0.62; cursor: progress; }
        .fa-preset-emoji { font-size: 20px; }
        .fa-preset-title { font-size: 16px; font-weight: 700; }
        .fa-preset-blurb { font-size: 12px; color: rgba(205, 226, 240, 0.76); line-height: 1.5; }
        .fa-preset-busy { font-size: 11px; color: color-mix(in srgb, var(--accent-soft), transparent 36%); }
        .fa-master,
        .fa-flag {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 14px 16px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-deep), transparent 12%);
          border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 86%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
        }
        .fa-master-text,
        .fa-flag-main { flex: 1; min-width: 0; }
        .fa-master-blurb { color: rgba(205, 226, 240, 0.74); font-size: 12px; line-height: 1.5; margin-top: 6px; }
        .fa-source,
        .fa-flag-key { color: rgba(148, 163, 184, 0.78); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
        .fa-pill {
          display: inline-block; padding: 2px 8px; border-radius: 999px;
          font-size: 10px; font-weight: 760; text-transform: uppercase; letter-spacing: 0;
          margin-left: 8px;
        }
        .fa-pill.on  { background: rgba(34, 197, 94, 0.18); color: #86efac; }
        .fa-pill.off { background: rgba(148, 163, 184, 0.18); color: rgba(214, 236, 248, 0.72); }
        .fa-flags { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
        .fa-flag.disabled { opacity: 0.62; }
        .fa-flag-name { font-size: 14px; font-weight: 650; color: #eff8ff; }
        .fa-flag-blurb { color: rgba(205, 226, 240, 0.76); font-size: 12px; line-height: 1.5; margin-top: 2px; }
        .fa-toggle {
          flex: 0 0 auto;
          width: 42px; height: 24px;
          padding: 2px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 82%);
          position: relative; cursor: pointer;
          transition: background 120ms, border-color 120ms, transform 120ms;
        }
        .fa-toggle.on {
          background: color-mix(in srgb, var(--accent), transparent 66%);
          border-color: rgb(from var(--accent-strong) r g b / 0.46);
        }
        .fa-toggle:hover:not(:disabled) {
          border-color: rgb(from var(--accent-strong) r g b / 0.36);
        }
        .fa-toggle:disabled { cursor: not-allowed; }
        .fa-toggle-knob {
          display: block; width: 18px; height: 18px;
          border-radius: 50%;
          background: #f3fbff;
          transform: translateX(0);
          transition: transform 120ms;
          box-shadow: 0 2px 8px rgba(0,0,0,0.24);
        }
        .fa-toggle.on .fa-toggle-knob { transform: translateX(18px); }
        .fa-error,
        .fa-spinner {
          padding: 16px 18px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 86%);
          background: color-mix(in srgb, var(--bg), transparent 6%);
        }
        .fa-error { color: #fda4af; }
        .fa-spinner { color: rgba(214, 236, 248, 0.72); }
        @media (max-width: 880px) {
          .fa-presets { grid-template-columns: 1fr; }
        }
      `})]})}export{M as t};
