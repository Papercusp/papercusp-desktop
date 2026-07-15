import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{t as n}from"./jsx-runtime-sLPvdpSW.js";import{i as r,t as i}from"./src-9yZgxa51.js";import{n as a}from"./dist-CcY72VL8.js";import{s as o,t as s}from"./types-qZw2Z8cE.js";import{t as c}from"./src-C_84UHfx.js";import{t as l}from"./Tooltip-S0_1wvLs.js";import{t as u}from"./useLexicon-CKUxYaO4.js";var d=e(t());i(),c();var f=n();function p(e){return{[o.CLOUDFLARE_PUBLISH]:`Cloudflare publishing`,[o.HARNESS_PHASES]:`${e(`pot`)} phases`,[o.DESIGN]:`Design tab`,[o.TESTING]:`Testing surfaces`,[o.INBOX_DURABLE_ESCALATIONS]:`Durable inbox escalations`,[o.IMPROVEMENT_AUTO_IMPLEMENT]:`Auto-implement improvements`,[o.VIDEO_CHANNELS]:`Video channels (desktop)`,[o.VOICE_CHANNELS]:`Voice channels (desktop)`,[o.THE_HIVE]:`The Swarm (bee lexicon)`,[o.OPEN_SIGNUP]:`Open signup`,[o.ENDPOINT_AUTH_TIERS]:`Endpoint auth tiers`,[o.ACCEPT_DELEGATED_SEATS]:`Accept delegated seats`}}function m(e){return{[o.CLOUDFLARE_PUBLISH]:`Publish-to-Cloudflare flow. Cut for V1 ship.`,[o.HARNESS_PHASES]:`Multi-phase ${e(`pot`)} (staging / testing / production). Cut for V1 ship.`,[o.DESIGN]:`In-${e(`pot`)} design tab + /design route. Cut for V1 ship.`,[o.TESTING]:`Testing-only surfaces: pi tab, + add plugin button, Oracle assistant (tutorial dock + menubar button + /api/oracle). Cut for V1 ship.`,[o.INBOX_DURABLE_ESCALATIONS]:`Mirror chat decision cards to durable coord escalations (answer live or from the inbox).`,[o.IMPROVEMENT_AUTO_IMPLEMENT]:`Master switch for auto-implementing captured improvements. Off = capture + triage only.`,[o.VIDEO_CHANNELS]:`Desktop P2P video channel (participant-grid) for shared ${e(`pot`,{plural:!0,lower:!0})}. Off until the live-camera E2E passes.`,[o.VOICE_CHANNELS]:`Desktop P2P voice channel (holepunch) for shared ${e(`pot`,{plural:!0,lower:!0})}. Off until the live Tauri+mic pass.`,[o.THE_HIVE]:`Bee-themed user-facing lexicon, internal/testing skin (Pot→Hive, Fleet→Colony, Papercup→Sentinel, Mug→Queen, Cup→Bee, Humans→Keepers; Swarm = a deployment). Presentation only — code/DB/tools unchanged. Off = classic Papercusp (the public one-identity lexicon, voice-release D-001).`,[o.OPEN_SIGNUP]:`Allow new account signup after the first user exists. Off (default): the internet-facing /auth/signup only bootstraps the first account — security gate, deliberate default-OFF.`,[o.ENDPOINT_AUTH_TIERS]:`Enforce loopback-tier routes at the dispatch chokepoint (auth-tier Wave 1: mutating routes reject non-loopback hosts). Off = emergency revert to pre-rollout behavior.`,[o.ACCEPT_DELEGATED_SEATS]:`Let a REMOTE fleet owner spawn agents on THIS host (delegated agent seats — agent-allocation P-008). Off (default): this host honors no delegated-seat spawn requests. On: opt in to run agents delegated by fleets you belong to, bounded by this host’s capability envelope + the seat count/account/budget caps. A trust decision — enable only for owners you intend to contribute capacity to.`}}function h(){let e=u(),t=(0,d.useMemo)(()=>p(e),[e]),n=(0,d.useMemo)(()=>m(e),[e]),[i,o]=(0,d.useState)({kind:`loading`}),[c,h]=(0,d.useState)(null),g=(0,d.useCallback)(async()=>{try{let[e,t]=await Promise.all([fetch(`/api/flags/testing-features`,{cache:`no-store`}),fetch(`/api/flags/bootstrap`,{cache:`no-store`})]);if(!e.ok)throw Error(`HTTP ${e.status} on /api/flags/testing-features`);if(!t.ok)throw Error(`HTTP ${t.status} on /api/flags/bootstrap`);let n=await e.json(),r=await t.json();o({kind:`ok`,testingFeatures:n.testingFeatures,source:n.source,flags:r.flags})}catch(e){o({kind:`error`,message:String(e?.message??e)})}},[]);(0,d.useEffect)(()=>{g()},[g]),(0,d.useEffect)(()=>{if(typeof EventSource>`u`)return;let e=r({url:`/api/flags/stream`,withCredentials:!0,handlers:{flag_changed:()=>void g(),flags_payload:()=>void g()}});return()=>e.close()},[g]);async function _(e){h(`preset:${e}`);try{let t=await fetch(`/api/flags/preset`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({name:e})}),n=await t.json();if(!t.ok||!n.ok)throw Error(n.error??`HTTP ${t.status}`);a.success(e===`production`?`Switched to V1 Production`:`Switched to Full testing`),await g()}catch(e){a.error(`Failed to apply preset`,{description:e.message})}finally{h(null)}}async function v(e){h(`testing-features`);try{let t=await fetch(`/api/flags/testing-features`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({enabled:e})}),n=await t.json();if(!t.ok||!n.ok)throw Error(n.error??`HTTP ${t.status}`);await g(),a.success(e?`testingFeatures enabled`:`testingFeatures disabled`)}catch(e){a.error(`Failed to update testingFeatures`,{description:e.message})}finally{h(null)}}async function y(e,n){h(`flag:${e}`);try{let t=await fetch(`/api/flags/set`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({key:e,enabled:n})}),r=await t.json();if(!t.ok||!r.ok)throw Error(r.error??`HTTP ${t.status}`);await g()}catch(n){a.error(`Failed to update ${t[e]??e}`,{description:n.message})}finally{h(null)}}if(i.kind===`loading`)return(0,f.jsx)(`div`,{className:`fa-shell`,children:(0,f.jsx)(`div`,{className:`fa-spinner`,children:`Loading…`})});if(i.kind===`error`)return(0,f.jsx)(`div`,{className:`fa-shell`,children:(0,f.jsxs)(`div`,{className:`fa-error`,children:[`Failed to load: `,i.message]})});let b=i.testingFeatures,x=i.flags;return(0,f.jsxs)(`div`,{className:`fa-shell`,children:[(0,f.jsxs)(`section`,{className:`fa-section`,children:[(0,f.jsx)(`h2`,{className:`fa-h2`,children:`Preset`}),(0,f.jsx)(`p`,{className:`fa-p`,children:`One-click swap between V1 ship state and the full testing build.`}),(0,f.jsxs)(`div`,{className:`fa-presets`,children:[(0,f.jsxs)(`button`,{type:`button`,className:`fa-preset${b?``:` active`}`,disabled:c!==null,onClick:()=>_(`production`),children:[(0,f.jsx)(`span`,{className:`fa-preset-emoji`,children:`🚀`}),(0,f.jsx)(`span`,{className:`fa-preset-title`,children:`V1 Production`}),(0,f.jsx)(`span`,{className:`fa-preset-blurb`,children:`testingFeatures = false · bundled defaults serve everything · zero PostHog contact`}),c===`preset:production`&&(0,f.jsx)(`span`,{className:`fa-preset-busy`,children:`…`})]}),(0,f.jsxs)(`button`,{type:`button`,className:`fa-preset${b?` active`:``}`,disabled:c!==null,onClick:()=>_(`testing`),children:[(0,f.jsx)(`span`,{className:`fa-preset-emoji`,children:`🧪`}),(0,f.jsx)(`span`,{className:`fa-preset-title`,children:`Full testing`}),(0,f.jsx)(`span`,{className:`fa-preset-blurb`,children:`testingFeatures = true · all flags flipped on in PostHog`}),c===`preset:testing`&&(0,f.jsx)(`span`,{className:`fa-preset-busy`,children:`…`})]})]})]}),(0,f.jsxs)(`section`,{className:`fa-section`,children:[(0,f.jsx)(`h2`,{className:`fa-h2`,children:`Master switch`}),(0,f.jsxs)(`div`,{className:`fa-master`,children:[(0,f.jsxs)(`div`,{className:`fa-master-text`,children:[(0,f.jsx)(`strong`,{children:`testingFeatures`}),` `,(0,f.jsx)(`span`,{className:`fa-pill ${b?`on`:`off`}`,children:b?`on`:`off`}),(0,f.jsxs)(`div`,{className:`fa-master-blurb`,children:[b?`Papercusp is phoning home to flags.papercuspai.com. Per-flag toggles below are live.`:`Papercusp is using bundled defaults (all flags off). PostHog is not being contacted.`,(0,f.jsx)(`br`,{}),(0,f.jsxs)(`span`,{className:`fa-source`,children:[`Config source: `,i.source]})]})]}),(0,f.jsx)(l,{label:b?`Disable testingFeatures`:`Enable testingFeatures`,side:`top`,align:`end`,children:(0,f.jsx)(`button`,{type:`button`,className:`fa-toggle${b?` on`:``}`,disabled:c!==null,onClick:()=>v(!b),"aria-pressed":b,children:(0,f.jsx)(`span`,{className:`fa-toggle-knob`})})})]})]}),(0,f.jsxs)(`section`,{className:`fa-section`,children:[(0,f.jsx)(`h2`,{className:`fa-h2`,children:`Per-flag toggles`}),(0,f.jsxs)(`p`,{className:`fa-p`,children:[`Effective values shown reflect what the operator is currently serving.`,!b&&(0,f.jsx)(f.Fragment,{children:` When testingFeatures is off, toggles below have no effect — turn it on first.`})]}),(0,f.jsx)(`div`,{className:`fa-flags`,children:s.map(e=>{let r=x[e]??!1,i=t[e]??e,a=n[e]??``;return(0,f.jsxs)(`div`,{className:`fa-flag${b?``:` disabled`}`,children:[(0,f.jsxs)(`div`,{className:`fa-flag-main`,children:[(0,f.jsx)(`div`,{className:`fa-flag-name`,children:i}),(0,f.jsx)(`div`,{className:`fa-flag-blurb`,children:a}),(0,f.jsx)(`div`,{className:`fa-flag-key`,children:e})]}),(0,f.jsx)(l,{label:b?r?`Disable this flag`:`Enable this flag`:`Turn on testingFeatures first`,side:`top`,align:`end`,children:(0,f.jsx)(`button`,{type:`button`,className:`fa-toggle${r?` on`:``}`,disabled:!b||c!==null,onClick:()=>y(e,!r),"aria-pressed":r,children:(0,f.jsx)(`span`,{className:`fa-toggle-knob`})})})]},e)})})]}),(0,f.jsx)(`style`,{children:`
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
      `})]})}export{h as t};