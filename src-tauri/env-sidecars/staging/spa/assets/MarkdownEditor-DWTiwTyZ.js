const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dist-DNJCuEMH.css","assets/dist-BppLel2H.js","assets/chunk-CMxvf4Kt.js"])))=>i.map(i=>d[i]);
import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{t as i}from"./jsx-runtime-sLPvdpSW.js";import{t as a}from"./hard-reload-BGkHoR9m.js";var o=e(t()),s=i();n();function c({style:e,className:t,raw:n}){let r=typeof n==`string`&&n.trim().length>0;return(0,s.jsxs)(`div`,{className:t,style:{display:`flex`,flexDirection:`column`,minHeight:120,fontSize:13,color:`var(--fg-mute, #7f9bb4)`,...e},children:[(0,s.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`center`,gap:12,flexWrap:`wrap`,padding:r?`8px 12px`:16,textAlign:`center`,borderBottom:r?`1px solid var(--border, rgba(125,211,252,0.18))`:void 0},children:[(0,s.jsxs)(`span`,{children:[`Couldn’t load the markdown renderer`,r?` — showing raw text. `:`. `,(0,s.jsx)(`span`,{style:{fontSize:12},children:`The app was likely updated underneath this page.`})]}),(0,s.jsx)(`button`,{type:`button`,onClick:()=>a(),style:{padding:`4px 14px`,fontSize:12,fontWeight:600,color:`#06121b`,background:`var(--accent, #57d7ff)`,border:0,borderRadius:6,cursor:`pointer`,flexShrink:0},children:`Reload`})]}),r&&(0,s.jsx)(`pre`,{style:{flex:1,minHeight:0,margin:0,padding:16,overflow:`auto`,whiteSpace:`pre-wrap`,wordBreak:`break-word`,fontSize:13,lineHeight:1.6,color:`var(--fg, #e6e6e6)`,background:`#19232A`,fontFamily:`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`},children:n})]})}var l=null;function u(){return l||=r(()=>Promise.resolve({}),__vite__mapDeps([0])),l}function d(e){return(e??``).replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,(e,t,n)=>{let r=t.trim(),i=r,a=null,o=r.indexOf(`/`);o>0&&(a=r.slice(0,o),i=r.slice(o+1));let s=(n??r).trim(),c=new URLSearchParams({target:i});return a&&c.set(`harness`,a),`[${s}](/wiki?${c.toString()})`})}function f({value:t,outline:n=!1,className:i,style:a,renderers:l,onParsed:f}){let h=(0,o.useRef)(null),g=(0,o.useRef)(null),_=(0,o.useRef)(l);_.current=l;let v=(0,o.useRef)(f);v.current=f;let[y,b]=(0,o.useState)(!1);if((0,o.useEffect)(()=>{if(!h.current)return;let i=!1;return b(!1),(async()=>{await u();let a=(await r(async()=>{let{default:t}=await import(`./dist-BppLel2H.js`).then(t=>e(t.default));return{default:t}},__vite__mapDeps([1,2]))).default;if(i||!h.current)return;let o={mode:`dark`,theme:{current:`dark`},math:{engine:`KaTeX`},anchor:1,lang:`en_US`};if(_.current&&(o.renderers=_.current),await a.preview(h.current,d(t??``),o),!(i||!h.current)){try{v.current?.(h.current)}catch{}n&&g.current&&h.current&&(g.current.innerHTML=``,a.outlineRender(h.current,g.current),g.current.addEventListener(`click`,e=>{let t=e.target;for(;t&&t!==g.current;){let n=t.getAttribute?.(`data-target-id`);if(n){let t=h.current?.querySelector(`#${CSS.escape(n)}`);t&&(e.preventDefault(),e.stopPropagation(),t.scrollIntoView({block:`start`,behavior:`smooth`}));return}t=t.parentElement}},!0))}})().catch(e=>{i||(b(!0),console.error(`[MarkdownPreview] vditor failed to load:`,e))}),()=>{i=!0}},[t,n]),y)return(0,s.jsx)(c,{className:i,style:a,raw:t});if(n){let e=n===`right`?`right`:`left`;return(0,s.jsxs)(`div`,{className:i,style:{display:`flex`,gap:16,background:`#19232A`,...a},children:[e===`left`&&(0,s.jsx)(`div`,{ref:g,className:`pc-md-outline`,style:m}),(0,s.jsx)(`div`,{ref:h,className:`vditor-reset pc-md-preview`,style:{flex:1,background:`#19232A`,color:`#e6e6e6`,minWidth:0}}),e===`right`&&(0,s.jsx)(`div`,{ref:g,className:`pc-md-outline`,style:m}),(0,s.jsx)(`style`,{children:`
          .pc-md-outline ul { list-style: none; padding-left: 12px; margin: 0; }
          .pc-md-outline > ul { padding-left: 0; }
          .pc-md-outline li { margin: 2px 0; }
          .pc-md-outline a { color: #aaa; text-decoration: none; font-size: 12px; line-height: 1.5; display: block; padding: 1px 4px; border-radius: 2px; }
          .pc-md-outline a:hover { color: #fff; background: #232E37; }
          .pc-md-preview, .pc-md-preview pre, .pc-md-preview code { background-color: #19232A !important; }
          ${p}
        `})]})}return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(`div`,{ref:h,className:`vditor-reset pc-md-preview ${i??``}`,style:{background:`#19232A`,color:`#e6e6e6`,...a}}),(0,s.jsx)(`style`,{children:p})]})}var p=`
  .pc-md-preview :is(pre, pre code) {
    background: color-mix(in srgb, var(--bg-popover, #0d1829), transparent 6%) !important;
    color: var(--fg, #e7f7ff) !important;
  }
  .pc-md-preview pre {
    border: 1px solid var(--border-strong, rgba(125, 211, 252, 0.32)) !important;
    border-radius: 12px !important;
  }
  .pc-md-preview :is(code.language-yaml, code.language-yml, code.language-frontmatter, pre code:first-child) {
    color: var(--fg, #e7f7ff) !important;
  }
  .pc-md-preview :is(.hljs-attr, .hljs-attribute, .hljs-keyword, .hljs-meta) {
    color: var(--accent-strong, #7dd3fc) !important;
  }
  .pc-md-preview :is(.hljs-string, .hljs-literal, .hljs-number) {
    color: var(--fg-dim, #b9d4e8) !important;
  }
`,m={display:`block`,width:220,flexShrink:0,position:`sticky`,top:0,alignSelf:`flex-start`,maxHeight:`calc(100vh - 100px)`,overflowY:`auto`,padding:`8px 4px`,borderRight:`1px solid var(--border, #2a2a2a)`},h=[`headings`,`bold`,`italic`,`strike`,`|`,`list`,`ordered-list`,`check`,`quote`,`|`,`code`,`inline-code`,`link`,`table`,`|`,`edit-mode`,`preview`,`outline`,`export`];function g({value:t,onChange:n,mode:i=`ir`,readOnly:a=!1,height:l=`100%`,minHeight:d=200,toolbar:f=h,outline:p=!1,className:m,style:g,placeholder:_,onInstance:v}){let y=(0,o.useRef)(null),b=(0,o.useRef)(null),x=(0,o.useRef)(n);x.current=n;let S=(0,o.useRef)(v);S.current=v;let C=(0,o.useRef)(t),[w,T]=(0,o.useState)(!1),[E,D]=(0,o.useState)(!1);return(0,o.useEffect)(()=>{let t=!1;return D(!1),(async()=>{await u();let n=(await r(async()=>{let{default:t}=await import(`./dist-BppLel2H.js`).then(t=>e(t.default));return{default:t}},__vite__mapDeps([1,2]))).default;if(t||!y.current)return;let o=new n(y.current,{mode:i,theme:`dark`,lang:`en_US`,cache:{enable:!1},undoDelay:0,minHeight:d,placeholder:_,toolbar:f,outline:p?{enable:!0,position:p}:{enable:!1,position:`left`},preview:{theme:{current:`dark`},math:{engine:`KaTeX`}},input:e=>x.current?.(e),after:()=>{if(!t){if(b.current=o,o.setValue(C.current??``),a?o.disabled():o.enable(),p){let e=()=>{let e=y.current?.querySelector(`.vditor-outline`);e&&(e.style.display=`block`,!e.dataset.pcOutlineWired&&(e.dataset.pcOutlineWired=`1`,e.addEventListener(`click`,t=>{let n=t.target;for(;n&&n!==e;){let e=n.getAttribute?.(`data-target-id`);if(e){let n=y.current?.querySelector(`#${CSS.escape(e)}`);n&&(t.preventDefault(),t.stopPropagation(),n.scrollIntoView({block:`start`,behavior:`smooth`}));return}n=n.parentElement}},!0)))};requestAnimationFrame(()=>requestAnimationFrame(e)),setTimeout(e,100),setTimeout(e,400)}T(!0);try{S.current?.(o)}catch{}}}})})().catch(e=>{t||(D(!0),console.error(`[MarkdownEditor] vditor failed to load:`,e))}),()=>{t=!0;try{S.current?.(null)}catch{}try{b.current?.destroy()}catch{}b.current=null,T(!1)}},[i,JSON.stringify(f)]),(0,o.useEffect)(()=>{if(!w||!b.current)return;let e=b.current;if(e.getValue()===t)return;let n=window.scrollX,r=window.scrollY,i=!!y.current?.contains(document.activeElement);e.setValue(t??``),i||requestAnimationFrame(()=>window.scrollTo(n,r))},[t,w]),(0,o.useEffect)(()=>{!w||!b.current||(a?b.current.disabled():b.current.enable())},[a,w]),E?(0,s.jsx)(c,{className:m,style:{height:l,...g},raw:t}):(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(`style`,{children:`
        /* Vditor mounts INTO the container element and adds .vditor class names
         * to it. To get internal scrolling instead of vertical-overflow, we
         * override Vditor's inline height with !important. The .vditor-ir
         * element is the scroll container — Vditor's outline click handler
         * does \`vditor.ir.element.scrollTop = …\`, so .vditor-ir MUST be the
         * overflow:auto layer (not its inner <pre>) for outline links to work. */
        /* Use the darker blue-tinted gray (#19232A) that the user identified
         * from the screenshot as the preferred tone. Vditor's default dark
         * theme bleeds the lighter greenish-gray (#26-282E ~ #262D32) into
         * scrolled regions. Apply uniformly so scroll never reveals a delta. */
        .pc-md-editor-host.vditor--dark {
          --panel-background-color: #19232A !important;
          --toolbar-background-color: #19232A !important;
          --textarea-background-color: #19232A !important;
          background-color: #19232A !important;
        }
        .pc-md-editor-host.vditor--dark .vditor-content,
        .pc-md-editor-host.vditor--dark .vditor-ir,
        .pc-md-editor-host.vditor--dark .vditor-wysiwyg,
        .pc-md-editor-host.vditor--dark .vditor-sv,
        .pc-md-editor-host.vditor--dark .vditor-reset,
        .pc-md-editor-host.vditor--dark .vditor-outline,
        .pc-md-editor-host.vditor--dark .vditor-toolbar {
          background-color: #19232A !important;
        }
        .pc-md-editor-host.vditor { display: flex !important; flex-direction: column !important; height: 100% !important; min-height: 0; }
        .pc-md-editor-host.vditor > .vditor-toolbar { flex: 0 0 auto; }
        .pc-md-editor-host.vditor > .vditor-content { flex: 1 1 0 !important; min-height: 0 !important; display: flex !important; overflow: hidden !important; }
        .pc-md-editor-host.vditor > .vditor-content > .vditor-outline { flex: 0 0 auto; max-width: 240px; overflow: auto; }
        .pc-md-editor-host.vditor > .vditor-content > .vditor-ir,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-wysiwyg,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-sv { flex: 1 1 0 !important; min-height: 0 !important; overflow: auto !important; background-color: var(--bg-2) !important; }
        .pc-md-editor-host.vditor > .vditor-content > .vditor-ir > pre,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-wysiwyg > pre,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-sv > pre { overflow: visible !important; min-height: 100%; box-sizing: border-box; }
      `}),(0,s.jsx)(`div`,{ref:y,className:`pc-md-editor-host ${m??``}`,style:{height:l,width:`100%`,minHeight:0,...g}})]})}export{f as n,g as t};