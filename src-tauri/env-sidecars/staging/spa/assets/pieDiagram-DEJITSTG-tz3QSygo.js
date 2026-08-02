import{n as d,r as F}from"./src-SfaqZv-j.js";import{B as q,C as H,V as J,W as K,_ as Q,a as Y,b as tt,c as et,d as at,v as rt}from"./chunk-ICPOFSXX-BgiMGcnZ.js";import{t as nt}from"./ordinal-C1DmprlB.js";import{n as v}from"./path-Bx2OKYRV.js";import{m as _}from"./dist-CnFgoskq.js";import{t as P}from"./arc-BG7xhugh.js";import{t as it}from"./array-DbBWA3E_.js";import{f as ot,r as st}from"./chunk-5PVQY5BW-pGe-S9Vj.js";import{t as lt}from"./chunk-426QAEUC-Cc2dI6Zy.js";import{t as ct}from"./chunk-4BX2VUAB-C-GhTeHJ.js";import{t as ut}from"./mermaid-parser.core-BiyKqtEn.js";function dt(t,a){return a<t?-1:a>t?1:a>=t?0:NaN}function pt(t){return t}function ft(){var t=pt,a=dt,f=null,s=v(0),l=v(_),S=v(0);function i(e){var o,g=(e=it(e)).length,p,y,h=0,c=new Array(g),n=new Array(g),x=+s.apply(this,arguments),w=Math.min(_,Math.max(-_,l.apply(this,arguments)-x)),m,D=Math.min(Math.abs(w)/g,S.apply(this,arguments)),$=D*(w<0?-1:1),u;for(o=0;o<g;++o)(u=n[c[o]=o]=+t(e[o],o,e))>0&&(h+=u);for(a!=null?c.sort(function(A,C){return a(n[A],n[C])}):f!=null&&c.sort(function(A,C){return f(e[A],e[C])}),o=0,y=h?(w-g*$)/h:0;o<g;++o,x=m)p=c[o],u=n[p],m=x+(u>0?u*y:0)+$,n[p]={data:e[p],index:o,value:u,startAngle:x,endAngle:m,padAngle:D};return n}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:v(+e),i):t},i.sortValues=function(e){return arguments.length?(a=e,f=null,i):a},i.sort=function(e){return arguments.length?(f=e,a=null,i):f},i.startAngle=function(e){return arguments.length?(s=typeof e=="function"?e:v(+e),i):s},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:v(+e),i):l},i.padAngle=function(e){return arguments.length?(S=typeof e=="function"?e:v(+e),i):S},i}var B=at.pie,R={sections:new Map,showData:!1,config:B},T=R.sections,W=R.showData,gt=structuredClone(B),I={getConfig:d(()=>structuredClone(gt),"getConfig"),clear:d(()=>{T=new Map,W=R.showData,Y()},"clear"),setDiagramTitle:K,getDiagramTitle:H,setAccTitle:J,getAccTitle:rt,setAccDescription:q,getAccDescription:Q,addSection:d(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);T.has(t)||(T.set(t,a),F.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),getSections:d(()=>T,"getSections"),setShowData:d(t=>{W=t},"setShowData"),getShowData:d(()=>W,"getShowData")},mt=d((t,a)=>{ct(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),ht={parse:d(async t=>{const a=await ut("pie",t);F.debug(a),mt(a,I)},"parse")},xt=d(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),vt=d(t=>{const a=[...t.values()].reduce((s,l)=>s+l,0),f=[...t.entries()].map(([s,l])=>({label:s,value:l})).filter(s=>s.value/a*100>=1);return ft().value(s=>s.value).sort(null)(f)},"createPieArcs"),_t={parser:ht,db:I,renderer:{draw:d((t,a,f,s)=>{F.debug(`rendering pie chart
`+t);const l=s.db,S=tt(),i=st(l.getConfig(),S.pie),e=40,o=18,g=4,p=450,y=p,h=lt(a),c=h.append("g");c.attr("transform","translate(225,225)");const{themeVariables:n}=S;let[x]=ot(n.pieOuterStrokeWidth);x??=2;const w=i.textPosition,m=Math.min(y,p)/2-e,D=P().innerRadius(0).outerRadius(m),$=P().innerRadius(m*w).outerRadius(m*w);c.append("circle").attr("cx",0).attr("cy",0).attr("r",m+x/2).attr("class","pieOuterCircle");const u=l.getSections(),A=vt(u),C=[n.pie1,n.pie2,n.pie3,n.pie4,n.pie5,n.pie6,n.pie7,n.pie8,n.pie9,n.pie10,n.pie11,n.pie12];let b=0;u.forEach(r=>{b+=r});const z=A.filter(r=>(r.data.value/b*100).toFixed(0)!=="0"),k=nt(C).domain([...u.keys()]);c.selectAll("mySlices").data(z).enter().append("path").attr("d",D).attr("fill",r=>k(r.data.label)).attr("class","pieCircle"),c.selectAll("mySlices").data(z).enter().append("text").text(r=>(r.data.value/b*100).toFixed(0)+"%").attr("transform",r=>"translate("+$.centroid(r)+")").style("text-anchor","middle").attr("class","slice");const V=c.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),G=[...u.entries()].map(([r,M])=>({label:r,value:M})),E=c.selectAll(".legend").data(G).enter().append("g").attr("class","legend").attr("transform",(r,M)=>{const Z=22*G.length/2;return"translate(216,"+(M*22-Z)+")"});E.append("rect").attr("width",o).attr("height",o).style("fill",r=>k(r.label)).style("stroke",r=>k(r.label)),E.append("text").attr("x",22).attr("y",o-g).text(r=>l.getShowData()?`${r.label} [${r.value}]`:r.label);const U=512+Math.max(...E.selectAll("text").nodes().map(r=>r?.getBoundingClientRect().width??0)),L=V.node()?.getBoundingClientRect().width??0,j=y/2-L/2,X=y/2+L/2,N=Math.min(0,j),O=Math.max(U,X)-N;h.attr("viewBox",`${N} 0 ${O} ${p}`),et(h,p,O,i.useMaxWidth)},"draw")},styles:xt};export{_t as diagram};
