import{t as e}from"./jsx-runtime-sLPvdpSW.js";import{t}from"./link-CCrlx5uS.js";import{t as n}from"./useRouterState-CZv534nG.js";import{t as r}from"./useLexicon-CKUxYaO4.js";import{i,n as a,r as o}from"./dist-DumK3KbQ.js";var s=e(),c=[{href:`/admin/run`,label:`Run`},{href:`/admin/features`,label:`Features`},{href:`/admin/recipes`,label:`Recipes`},{href:`/admin/git`,label:`Git`},{href:`/admin/dogfood-substrate`,label:`Substrate`},{href:`/admin/dbos`,label:`DBOS`},{href:`/admin/schedules`,label:`Schedules`},{href:`/admin/cupboard-moderation`,label:`Cupboard`,term:`cupboard`}];function l({title:e=`Admin`,children:l}){let u=r(),d=n({select:e=>e.location.pathname})||`/admin/run`,f=c.find(e=>d===e.href||d.startsWith(`${e.href}/`))??c[0];return(0,s.jsxs)(`div`,{className:`pc-adminshell`,children:[(0,s.jsxs)(`header`,{className:`pc-adminshell__header`,children:[(0,s.jsxs)(`div`,{className:`pc-adminshell__copy`,children:[(0,s.jsx)(`span`,{className:`pc-adminshell__kicker`,children:`Admin console`}),(0,s.jsx)(`h1`,{children:e})]}),(0,s.jsx)(o,{value:f.href,className:`pc-adminshell__tabs`,children:(0,s.jsx)(a,{className:`pc-adminshell__tablist`,"aria-label":`Admin sections`,children:c.map(e=>(0,s.jsx)(i,{value:e.href,asChild:!0,className:`pc-adminshell__tab`,children:(0,s.jsx)(t,{to:e.href,children:e.term?u(e.term):e.label})},e.href))})}),(0,s.jsx)(`span`,{className:`pc-adminshell__spacer`}),(0,s.jsx)(`span`,{className:`pc-adminshell__host`,children:`localhost · :3055`})]}),(0,s.jsx)(`div`,{className:`pc-adminshell__body`,children:l}),(0,s.jsx)(`style`,{children:`
        .pc-adminshell {
          display: flex;
          flex-direction: column;
          min-height: calc(100vh - 56px);
          background:
            radial-gradient(circle at top left, color-mix(in srgb, var(--accent), transparent 94%), transparent 28%),
            linear-gradient(180deg, rgba(5, 12, 22, 0.99), rgba(4, 10, 18, 1));
        }
        .pc-adminshell__header {
          display: flex;
          align-items: flex-end;
          gap: 16px;
          padding: 14px 18px 12px;
          border-bottom: 1px solid var(--border, rgba(125, 211, 252, 0.14));
          background:
            linear-gradient(180deg, rgba(7, 16, 29, 0.98), rgba(6, 13, 24, 0.98));
          box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.02);
        }
        .pc-adminshell__copy {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .pc-adminshell__kicker {
          color: var(--fg-mute);
          font-size: 10px;
          font-weight: 760;
          letter-spacing: 0;
          line-height: 1;
          text-transform: uppercase;
        }
        .pc-adminshell__header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 760;
          line-height: 1;
          letter-spacing: 0;
          color: var(--fg);
        }
        .pc-adminshell__tabs {
          align-self: stretch;
          display: flex;
          align-items: flex-end;
        }
        .pc-adminshell__tablist {
          display: inline-flex;
          align-items: flex-end;
          gap: 6px;
          padding: 0 0 1px;
        }
        .pc-adminshell__tab {
          display: inline-flex;
          align-items: center;
          min-height: 34px;
          padding: 0 12px;
          border: 1px solid var(--border, rgba(125, 211, 252, 0.14));
          border-bottom-color: color-mix(in oklab, var(--border, rgba(125, 211, 252, 0.14)), transparent 45%);
          border-radius: 10px 10px 0 0;
          background: rgba(255, 255, 255, 0.02);
          color: rgba(214, 236, 248, 0.72);
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0;
          text-decoration: none !important;
          transition: background-color 120ms, border-color 120ms, color 120ms;
        }
        .pc-adminshell__tab:hover {
          color: #eff8ff;
          background: rgba(12, 24, 38, 0.96);
          border-color: var(--border-strong, rgba(125, 211, 252, 0.28));
          text-decoration: none !important;
        }
        .pc-adminshell__tab[aria-selected="true"] {
          color: #f7fdff;
          background:
            linear-gradient(180deg, rgba(17, 34, 53, 0.98), rgba(10, 20, 33, 0.99));
          border-color: color-mix(in srgb, var(--accent), transparent 62%);
          border-bottom-color: rgba(7, 16, 29, 0.98);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
        }
        .pc-adminshell__tab:focus-visible {
          outline: 2px solid color-mix(in srgb, var(--accent), transparent 42%);
          outline-offset: 2px;
        }
        .pc-adminshell__spacer { flex: 1; }
        .pc-adminshell__host {
          align-self: center;
          padding: 5px 10px;
          border: 1px solid var(--border, rgba(125, 211, 252, 0.12));
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.025);
          color: var(--fg-mute);
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .pc-adminshell__body {
          flex: 1;
          min-height: 0;
          overflow: auto;
        }
      `})]})}export{l as t};