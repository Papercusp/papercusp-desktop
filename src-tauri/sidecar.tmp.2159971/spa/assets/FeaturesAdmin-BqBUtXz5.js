import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{t as n}from"./jsx-runtime-sLPvdpSW.js";import{n as r}from"./dist-CcY72VL8.js";import{t as i}from"./resilient-event-source-DB8lSvOI.js";import{n as a,t as o}from"./types-HiMWUb5q.js";import{t as s}from"./Tooltip-Cs0UWpqD.js";var c=e(t()),l=n(),u={[a.CLOUDFLARE_PUBLISH]:`Cloudflare publishing`,[a.HARNESS_PHASES]:`Harness phases`,[a.DESIGN]:`Design tab`,[a.TESTING]:`Testing surfaces`,[a.INBOX_DURABLE_ESCALATIONS]:`Durable inbox escalations`,[a.IMPROVEMENT_AUTO_IMPLEMENT]:`Auto-implement improvements`,[a.VIDEO_CHANNELS]:`Video channels (desktop)`,[a.VOICE_CHANNELS]:`Voice channels (desktop)`,[a.THE_HIVE]:`The Swarm (bee lexicon)`},d={[a.CLOUDFLARE_PUBLISH]:`Publish-to-Cloudflare flow. Cut for V1 ship.`,[a.HARNESS_PHASES]:`Multi-phase harness (staging / testing / production). Cut for V1 ship.`,[a.DESIGN]:`In-harness design tab + /design route. Cut for V1 ship.`,[a.TESTING]:`Testing-only surfaces: pi tab, + add plugin button, Oracle assistant (tutorial dock + menubar button + /api/oracle). Cut for V1 ship.`,[a.INBOX_DURABLE_ESCALATIONS]:`Mirror chat decision cards to durable coord escalations (answer live or from the inbox).`,[a.IMPROVEMENT_AUTO_IMPLEMENT]:`Master switch for auto-implementing captured improvements. Off = capture + triage only.`,[a.VIDEO_CHANNELS]:`Desktop P2P video channel (participant-grid) for shared harnesses. Off until the live-camera E2E passes.`,[a.VOICE_CHANNELS]:`Desktop P2P voice channel (holepunch) for shared harnesses. Off until the live Tauri+mic pass.`,[a.THE_HIVE]:`Bee-themed user-facing lexicon (Pot→Hive, Fleet→Colony, Operator→Sentinel Bee, Queen=brain, Humans=Keepers; Swarm = a deployment). Presentation only — code/DB/tools unchanged. Off = classic Papercusp.`};function f(){let[e,t]=(0,c.useState)({kind:`loading`}),[n,a]=(0,c.useState)(null),f=(0,c.useCallback)(async()=>{try{let[e,n]=await Promise.all([fetch(`/api/flags/testing-features`,{cache:`no-store`}),fetch(`/api/flags/bootstrap`,{cache:`no-store`})]);if(!e.ok)throw Error(`HTTP ${e.status} on /api/flags/testing-features`);if(!n.ok)throw Error(`HTTP ${n.status} on /api/flags/bootstrap`);let r=await e.json(),i=await n.json();t({kind:`ok`,testingFeatures:r.testingFeatures,source:r.source,flags:i.flags})}catch(e){t({kind:`error`,message:String(e?.message??e)})}},[]);(0,c.useEffect)(()=>{f()},[f]),(0,c.useEffect)(()=>{if(typeof EventSource>`u`)return;let e=i({url:`/api/flags/stream`,withCredentials:!0,handlers:{flag_changed:()=>void f(),flags_payload:()=>void f()}});return()=>e.close()},[f]);async function p(e){a(`preset:${e}`);try{let t=await fetch(`/api/flags/preset`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({name:e})}),n=await t.json();if(!t.ok||!n.ok)throw Error(n.error??`HTTP ${t.status}`);r.success(e===`production`?`Switched to V1 Production`:`Switched to Full testing`),await f()}catch(e){r.error(`Failed to apply preset`,{description:e.message})}finally{a(null)}}async function m(e){a(`testing-features`);try{let t=await fetch(`/api/flags/testing-features`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({enabled:e})}),n=await t.json();if(!t.ok||!n.ok)throw Error(n.error??`HTTP ${t.status}`);await f(),r.success(e?`testingFeatures enabled`:`testingFeatures disabled`)}catch(e){r.error(`Failed to update testingFeatures`,{description:e.message})}finally{a(null)}}async function h(e,t){a(`flag:${e}`);try{let n=await fetch(`/api/flags/set`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({key:e,enabled:t})}),r=await n.json();if(!n.ok||!r.ok)throw Error(r.error??`HTTP ${n.status}`);await f()}catch(t){r.error(`Failed to update ${u[e]}`,{description:t.message})}finally{a(null)}}if(e.kind===`loading`)return(0,l.jsx)(`div`,{className:`fa-shell`,children:(0,l.jsx)(`div`,{className:`fa-spinner`,children:`Loading…`})});if(e.kind===`error`)return(0,l.jsx)(`div`,{className:`fa-shell`,children:(0,l.jsxs)(`div`,{className:`fa-error`,children:[`Failed to load: `,e.message]})});let g=e.testingFeatures,_=e.flags;return(0,l.jsxs)(`div`,{className:`fa-shell`,children:[(0,l.jsxs)(`section`,{className:`fa-section`,children:[(0,l.jsx)(`h2`,{className:`fa-h2`,children:`Preset`}),(0,l.jsx)(`p`,{className:`fa-p`,children:`One-click swap between V1 ship state and the full testing build.`}),(0,l.jsxs)(`div`,{className:`fa-presets`,children:[(0,l.jsxs)(`button`,{type:`button`,className:`fa-preset${g?``:` active`}`,disabled:n!==null,onClick:()=>p(`production`),children:[(0,l.jsx)(`span`,{className:`fa-preset-emoji`,children:`🚀`}),(0,l.jsx)(`span`,{className:`fa-preset-title`,children:`V1 Production`}),(0,l.jsx)(`span`,{className:`fa-preset-blurb`,children:`testingFeatures = false · bundled defaults serve everything · zero PostHog contact`}),n===`preset:production`&&(0,l.jsx)(`span`,{className:`fa-preset-busy`,children:`…`})]}),(0,l.jsxs)(`button`,{type:`button`,className:`fa-preset${g?` active`:``}`,disabled:n!==null,onClick:()=>p(`testing`),children:[(0,l.jsx)(`span`,{className:`fa-preset-emoji`,children:`🧪`}),(0,l.jsx)(`span`,{className:`fa-preset-title`,children:`Full testing`}),(0,l.jsx)(`span`,{className:`fa-preset-blurb`,children:`testingFeatures = true · all flags flipped on in PostHog`}),n===`preset:testing`&&(0,l.jsx)(`span`,{className:`fa-preset-busy`,children:`…`})]})]})]}),(0,l.jsxs)(`section`,{className:`fa-section`,children:[(0,l.jsx)(`h2`,{className:`fa-h2`,children:`Master switch`}),(0,l.jsxs)(`div`,{className:`fa-master`,children:[(0,l.jsxs)(`div`,{className:`fa-master-text`,children:[(0,l.jsx)(`strong`,{children:`testingFeatures`}),` `,(0,l.jsx)(`span`,{className:`fa-pill ${g?`on`:`off`}`,children:g?`on`:`off`}),(0,l.jsxs)(`div`,{className:`fa-master-blurb`,children:[g?`Papercup is phoning home to flags.papercuspai.com. Per-flag toggles below are live.`:`Papercup is using bundled defaults (all flags off). PostHog is not being contacted.`,(0,l.jsx)(`br`,{}),(0,l.jsxs)(`span`,{className:`fa-source`,children:[`Config source: `,e.source]})]})]}),(0,l.jsx)(s,{label:g?`Disable testingFeatures`:`Enable testingFeatures`,side:`top`,align:`end`,children:(0,l.jsx)(`button`,{type:`button`,className:`fa-toggle${g?` on`:``}`,disabled:n!==null,onClick:()=>m(!g),"aria-pressed":g,children:(0,l.jsx)(`span`,{className:`fa-toggle-knob`})})})]})]}),(0,l.jsxs)(`section`,{className:`fa-section`,children:[(0,l.jsx)(`h2`,{className:`fa-h2`,children:`Per-flag toggles`}),(0,l.jsxs)(`p`,{className:`fa-p`,children:[`Effective values shown reflect what the operator is currently serving.`,!g&&(0,l.jsx)(l.Fragment,{children:` When testingFeatures is off, toggles below have no effect — turn it on first.`})]}),(0,l.jsx)(`div`,{className:`fa-flags`,children:o.map(e=>{let t=_[e]??!1,r=u[e],i=d[e];return(0,l.jsxs)(`div`,{className:`fa-flag${g?``:` disabled`}`,children:[(0,l.jsxs)(`div`,{className:`fa-flag-main`,children:[(0,l.jsx)(`div`,{className:`fa-flag-name`,children:r}),(0,l.jsx)(`div`,{className:`fa-flag-blurb`,children:i}),(0,l.jsx)(`div`,{className:`fa-flag-key`,children:e})]}),(0,l.jsx)(s,{label:g?t?`Disable this flag`:`Enable this flag`:`Turn on testingFeatures first`,side:`top`,align:`end`,children:(0,l.jsx)(`button`,{type:`button`,className:`fa-toggle${t?` on`:``}`,disabled:!g||n!==null,onClick:()=>h(e,!t),"aria-pressed":t,children:(0,l.jsx)(`span`,{className:`fa-toggle-knob`})})})]},e)})})]}),(0,l.jsx)(`style`,{children:`
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
          letter-spacing: 0.12em;
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
          border-color: rgba(103, 232, 249, 0.30);
          transform: translateY(-1px);
        }
        .fa-preset.active {
          background: linear-gradient(180deg, color-mix(in srgb, var(--bg-raised), transparent 2%), color-mix(in srgb, var(--bg-1), transparent 1%));
          border-color: rgba(103, 232, 249, 0.42);
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
          font-size: 10px; font-weight: 760; text-transform: uppercase; letter-spacing: 0.08em;
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
          border-color: rgba(103, 232, 249, 0.46);
        }
        .fa-toggle:hover:not(:disabled) {
          border-color: rgba(103, 232, 249, 0.36);
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
      `})]})}export{f as t};