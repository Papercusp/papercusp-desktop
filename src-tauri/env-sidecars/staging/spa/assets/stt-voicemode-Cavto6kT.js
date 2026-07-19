import{i as vt,t as lt}from"./chunk-ChpBd9eV.js";import{n as Tp,t as Ep}from"./preload-helper-CcgcQsTF.js";import{n as Ac,t as Oc}from"./whisper-B9oEIv_a.js";var Ip=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.baseAssetPath=void 0;var Te=typeof window<"u"&&typeof window.document<"u"?window.document.currentScript:null,ge="/";Te&&(ge=Te.src.replace(/#.*$/,"").replace(/\?.*$/,"").replace(/\/[^/]+$/,"/")),U.baseAssetPath=ge})),Fn=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.defaultModelFetcher=void 0;var Te=ge=>fetch(ge).then(Ce=>Ce.arrayBuffer());U.defaultModelFetcher=Te})),oa=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.log=void 0;var Te=ge=>Ce=>{console.log(`VAD | ${ge} >`,Ce)};U.log={error:Te("error"),debug:Te("debug"),warn:Te("warn")}})),Ia=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.Message=void 0;var Te;(function(ge){ge.AudioFrame="AUDIO_FRAME",ge.SpeechStart="SPEECH_START",ge.VADMisfire="VAD_MISFIRE",ge.SpeechEnd="SPEECH_END",ge.SpeechStop="SPEECH_STOP",ge.SpeechRealStart="SPEECH_REAL_START",ge.FrameProcessed="FRAME_PROCESSED"})(Te||(U.Message=Te={}))})),Gn=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.FrameProcessor=U.validateOptions=U.defaultFrameProcessorOptions=void 0;var Te=oa(),ge=Ia();U.defaultFrameProcessorOptions={positiveSpeechThreshold:.3,negativeSpeechThreshold:.25,preSpeechPadMs:800,redemptionMs:1400,minSpeechMs:400,submitUserSpeechOnPause:!1};function Ce(K){(K.positiveSpeechThreshold<0||K.positiveSpeechThreshold>1)&&Te.log.error("positiveSpeechThreshold should be a number between 0 and 1"),(K.negativeSpeechThreshold<0||K.negativeSpeechThreshold>K.positiveSpeechThreshold)&&Te.log.error("negativeSpeechThreshold should be between 0 and positiveSpeechThreshold"),K.preSpeechPadMs<0&&Te.log.error("preSpeechPadMs should be positive"),K.redemptionMs<0&&Te.log.error("redemptionMs should be positive"),K.minSpeechMs<0&&Te.log.error("minSpeechMs should be positive")}U.validateOptions=Ce;var Ie=K=>{const k=K.reduce((xe,pe)=>(xe.push(xe.at(-1)+pe.length),xe),[0]),ie=new Float32Array(k.at(-1));return K.forEach((xe,pe)=>{const X=k[pe];ie.set(xe,X)}),ie};function be(K,k){return{redemptionFrames:Math.floor(K.redemptionMs/k),preSpeechPadFrames:Math.floor(K.preSpeechPadMs/k),minSpeechFrames:Math.floor(K.minSpeechMs/k)}}var $e=class{constructor(K,k,ie,xe){this.modelProcessFunc=K,this.modelResetFunc=k,this.options=ie,this.msPerFrame=xe,this.speaking=!1,this.redemptionCounter=0,this.speechFrameCount=0,this.active=!1,this.speechRealStartFired=!1,this.setOptions=le=>{this.options={...this.options,...le};const{redemptionFrames:ke,preSpeechPadFrames:he,minSpeechFrames:Le}=be(this.options,this.msPerFrame);this.redemptionFrames=ke,this.preSpeechPadFrames=he,this.minSpeechFrames=Le},this.reset=()=>{this.speaking=!1,this.speechRealStartFired=!1,this.audioBuffer=[],this.modelResetFunc(),this.redemptionCounter=0,this.speechFrameCount=0},this.pause=le=>{this.active=!1,this.options.submitUserSpeechOnPause?this.endSegment(le):this.reset()},this.resume=()=>{this.active=!0},this.endSegment=le=>{const ke=this.audioBuffer;this.audioBuffer=[];const he=this.speaking;if(this.reset(),he)if(ke.reduce((Le,at)=>at.isSpeech?Le+1:Le,0)>=this.minSpeechFrames){const Le=Ie(ke.map(at=>at.frame));le({msg:ge.Message.SpeechEnd,audio:Le})}else le({msg:ge.Message.VADMisfire});return{}},this.process=async(le,ke)=>{if(!this.active)return;const he=await this.modelProcessFunc(le),Le=he.isSpeech>=this.options.positiveSpeechThreshold;if(ke({probs:he,msg:ge.Message.FrameProcessed,frame:le}),this.audioBuffer.push({frame:le,isSpeech:Le}),Le&&(this.speechFrameCount++,this.redemptionCounter=0),Le&&!this.speaking&&(this.speaking=!0,ke({msg:ge.Message.SpeechStart})),this.speaking&&this.speechFrameCount===this.minSpeechFrames&&!this.speechRealStartFired&&(this.speechRealStartFired=!0,ke({msg:ge.Message.SpeechRealStart})),he.isSpeech<this.options.negativeSpeechThreshold&&this.speaking&&++this.redemptionCounter>=this.redemptionFrames){this.redemptionCounter=0,this.speechFrameCount=0,this.speaking=!1,this.speechRealStartFired=!1;const at=this.audioBuffer;if(this.audioBuffer=[],at.reduce((Ae,Ee)=>Ee.isSpeech?Ae+1:Ae,0)>=this.minSpeechFrames){const Ae=Ie(at.map(Ee=>Ee.frame));ke({msg:ge.Message.SpeechEnd,audio:Ae})}else ke({msg:ge.Message.VADMisfire})}if(!this.speaking){for(;this.audioBuffer.length>this.preSpeechPadFrames;)this.audioBuffer.shift();this.speechFrameCount=0}},this.audioBuffer=[];const{redemptionFrames:pe,preSpeechPadFrames:X,minSpeechFrames:ee}=be(this.options,this.msPerFrame);this.redemptionFrames=pe,this.preSpeechPadFrames=X,this.minSpeechFrames=ee,this.reset()}};U.FrameProcessor=$e})),Rc=lt(((U,Te)=>{Tp();var ge=(()=>{var Ce=Object.defineProperty,Ie=Object.getOwnPropertyDescriptor,be=Object.getOwnPropertyNames,$e=Object.prototype.hasOwnProperty,K=(e=>typeof vt<"u"?vt:typeof Proxy<"u"?new Proxy(e,{get:(t,r)=>(typeof vt<"u"?vt:t)[r]}):e)(function(e){if(typeof vt<"u")return vt.apply(this,arguments);throw Error('Dynamic require of "'+e+'" is not supported')}),k=(e,t)=>()=>(e&&(t=e(e=0)),t),ie=(e,t)=>{for(var r in t)Ce(e,r,{get:t[r],enumerable:!0})},xe=(e,t,r,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of be(t))!$e.call(e,a)&&a!==r&&Ce(e,a,{get:()=>t[a],enumerable:!(i=Ie(t,a))||i.enumerable});return e},pe=e=>xe(Ce({},"__esModule",{value:!0}),e),X,ee,le,ke,he,Le=k(()=>{"use strict";X=new Map,ee=[],le=(e,t,r)=>{if(t&&typeof t.init=="function"&&typeof t.createInferenceSessionHandler=="function"){let i=X.get(e);if(i===void 0)X.set(e,{backend:t,priority:r});else{if(i.priority>r)return;if(i.priority===r&&i.backend!==t)throw new Error(`cannot register backend "${e}" using priority ${r}`)}if(r>=0){let a=ee.indexOf(e);a!==-1&&ee.splice(a,1);for(let n=0;n<ee.length;n++)if(X.get(ee[n]).priority<=r){ee.splice(n,0,e);return}ee.push(e)}return}throw new TypeError("not a valid backend")},ke=async e=>{let t=X.get(e);if(!t)return"backend not found.";if(t.initialized)return t.backend;if(t.aborted)return t.error;{let r=!!t.initPromise;try{return r||(t.initPromise=t.backend.init(e)),await t.initPromise,t.initialized=!0,t.backend}catch(i){return r||(t.error=`${i}`,t.aborted=!0),t.error}finally{delete t.initPromise}}},he=async e=>{let t=e.executionProviders||[],r=t.map(u=>typeof u=="string"?u:u.name),i=r.length===0?ee:r,a,n=[],s=new Set;for(let u of i){let l=await ke(u);typeof l=="string"?n.push({name:u,err:l}):(a||(a=l),a===l&&s.add(u))}if(!a)throw new Error(`no available backend found. ERR: ${n.map(u=>`[${u.name}] ${u.err}`).join(", ")}`);for(let{name:u,err:l}of n)r.includes(u)&&console.warn(`removing requested execution provider "${u}" from session options because it is not available: ${l}`);let o=t.filter(u=>s.has(typeof u=="string"?u:u.name));return[a,new Proxy(e,{get:(u,l)=>l==="executionProviders"?o:Reflect.get(u,l)})]}}),at=k(()=>{"use strict";Le()}),Ae,Ee=k(()=>{"use strict";Ae="1.24.1"}),ye,oe,Ge=k(()=>{"use strict";Ee(),ye="warning",oe={wasm:{},webgl:{},webgpu:{},versions:{common:Ae},set logLevel(e){if(e!==void 0){if(typeof e!="string"||["verbose","info","warning","error","fatal"].indexOf(e)===-1)throw new Error(`Unsupported logging level: ${e}`);ye=e}},get logLevel(){return ye}},Object.defineProperty(oe,"logLevel",{enumerable:!0})}),te,dt=k(()=>{"use strict";Ge(),te=oe}),We,xt,Mt=k(()=>{"use strict";We=(e,t)=>{let r=typeof document<"u"?document.createElement("canvas"):new OffscreenCanvas(1,1);r.width=e.dims[3],r.height=e.dims[2];let i=r.getContext("2d");if(i!=null){let a,n;t?.tensorLayout!==void 0&&t.tensorLayout==="NHWC"?(a=e.dims[2],n=e.dims[3]):(a=e.dims[3],n=e.dims[2]);let s=t?.format!==void 0?t.format:"RGB",o=t?.norm,u,l;o===void 0||o.mean===void 0?u=[255,255,255,255]:typeof o.mean=="number"?u=[o.mean,o.mean,o.mean,o.mean]:(u=[o.mean[0],o.mean[1],o.mean[2],0],o.mean[3]!==void 0&&(u[3]=o.mean[3])),o===void 0||o.bias===void 0?l=[0,0,0,0]:typeof o.bias=="number"?l=[o.bias,o.bias,o.bias,o.bias]:(l=[o.bias[0],o.bias[1],o.bias[2],0],o.bias[3]!==void 0&&(l[3]=o.bias[3]));let p=n*a,d=0,h=p,f=p*2,g=-1;s==="RGBA"?(d=0,h=p,f=p*2,g=p*3):s==="RGB"?(d=0,h=p,f=p*2):s==="RBG"&&(d=0,f=p,h=p*2);for(let w=0;w<n;w++)for(let $=0;$<a;$++){let _=(e.data[d++]-l[0])*u[0],y=(e.data[h++]-l[1])*u[1],v=(e.data[f++]-l[2])*u[2],x=g===-1?255:(e.data[g++]-l[3])*u[3];i.fillStyle="rgba("+_+","+y+","+v+","+x+")",i.fillRect($,w,1,1)}if("toDataURL"in r)return r.toDataURL();throw new Error("toDataURL is not supported")}else throw new Error("Can not access image data")},xt=(e,t)=>{let r=typeof document<"u"?document.createElement("canvas").getContext("2d"):new OffscreenCanvas(1,1).getContext("2d"),i;if(r!=null){let a,n,s;t?.tensorLayout!==void 0&&t.tensorLayout==="NHWC"?(a=e.dims[2],n=e.dims[1],s=e.dims[3]):(a=e.dims[3],n=e.dims[2],s=e.dims[1]);let o=t!==void 0&&t.format!==void 0?t.format:"RGB",u=t?.norm,l,p;u===void 0||u.mean===void 0?l=[255,255,255,255]:typeof u.mean=="number"?l=[u.mean,u.mean,u.mean,u.mean]:(l=[u.mean[0],u.mean[1],u.mean[2],255],u.mean[3]!==void 0&&(l[3]=u.mean[3])),u===void 0||u.bias===void 0?p=[0,0,0,0]:typeof u.bias=="number"?p=[u.bias,u.bias,u.bias,u.bias]:(p=[u.bias[0],u.bias[1],u.bias[2],0],u.bias[3]!==void 0&&(p[3]=u.bias[3]));let d=n*a;if(t!==void 0&&(t.format!==void 0&&s===4&&t.format!=="RGBA"||s===3&&t.format!=="RGB"&&t.format!=="BGR"))throw new Error("Tensor format doesn't match input tensor dims");let h=4,f=0,g=1,w=2,$=3,_=0,y=d,v=d*2,x=-1;o==="RGBA"?(_=0,y=d,v=d*2,x=d*3):o==="RGB"?(_=0,y=d,v=d*2):o==="RBG"&&(_=0,v=d,y=d*2),i=r.createImageData(a,n);for(let I=0;I<n*a;f+=h,g+=h,w+=h,$+=h,I++)i.data[f]=(e.data[_++]-p[0])*l[0],i.data[g]=(e.data[y++]-p[1])*l[1],i.data[w]=(e.data[v++]-p[2])*l[2],i.data[$]=x===-1?255:(e.data[x++]-p[3])*l[3]}else throw new Error("Can not access image data");return i}}),nt,or,ur,lr,Pe,Ft,li=k(()=>{"use strict";pr(),nt=(e,t)=>{if(e===void 0)throw new Error("Image buffer must be defined");if(t.height===void 0||t.width===void 0)throw new Error("Image height and width must be defined");if(t.tensorLayout==="NHWC")throw new Error("NHWC Tensor layout is not supported yet");let{height:r,width:i}=t,a=t.norm??{mean:255,bias:0},n,s;typeof a.mean=="number"?n=[a.mean,a.mean,a.mean,a.mean]:n=[a.mean[0],a.mean[1],a.mean[2],a.mean[3]??255],typeof a.bias=="number"?s=[a.bias,a.bias,a.bias,a.bias]:s=[a.bias[0],a.bias[1],a.bias[2],a.bias[3]??0];let o=t.format!==void 0?t.format:"RGBA",u=t.tensorFormat!==void 0&&t.tensorFormat!==void 0?t.tensorFormat:"RGB",l=r*i,p=u==="RGBA"?new Float32Array(l*4):new Float32Array(l*3),d=4,h=0,f=1,g=2,w=3,$=0,_=l,y=l*2,v=-1;o==="RGB"&&(d=3,h=0,f=1,g=2,w=-1),u==="RGBA"?v=l*3:u==="RBG"?($=0,y=l,_=l*2):u==="BGR"&&(y=0,_=l,$=l*2);for(let x=0;x<l;x++,h+=d,g+=d,f+=d,w+=d)p[$++]=(e[h]+s[0])/n[0],p[_++]=(e[f]+s[1])/n[1],p[y++]=(e[g]+s[2])/n[2],v!==-1&&w!==-1&&(p[v++]=(e[w]+s[3])/n[3]);return u==="RGBA"?new Ue("float32",p,[1,4,r,i]):new Ue("float32",p,[1,3,r,i])},or=async(e,t)=>{let r=typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement,i=typeof ImageData<"u"&&e instanceof ImageData,a=typeof ImageBitmap<"u"&&e instanceof ImageBitmap,n=typeof e=="string",s,o=t??{},u=()=>{if(typeof document<"u")return document.createElement("canvas");if(typeof OffscreenCanvas<"u")return new OffscreenCanvas(1,1);throw new Error("Canvas is not supported")},l=p=>typeof HTMLCanvasElement<"u"&&p instanceof HTMLCanvasElement||p instanceof OffscreenCanvas?p.getContext("2d"):null;if(r){let p=u();p.width=e.width,p.height=e.height;let d=l(p);if(d!=null){let h=e.height,f=e.width;if(t!==void 0&&t.resizedHeight!==void 0&&t.resizedWidth!==void 0&&(h=t.resizedHeight,f=t.resizedWidth),t!==void 0){if(o=t,t.tensorFormat!==void 0)throw new Error("Image input config format must be RGBA for HTMLImageElement");o.tensorFormat="RGBA",o.height=h,o.width=f}else o.tensorFormat="RGBA",o.height=h,o.width=f;d.drawImage(e,0,0),s=d.getImageData(0,0,f,h).data}else throw new Error("Can not access image data")}else if(i){let p,d;if(t!==void 0&&t.resizedWidth!==void 0&&t.resizedHeight!==void 0?(p=t.resizedHeight,d=t.resizedWidth):(p=e.height,d=e.width),t!==void 0&&(o=t),o.format="RGBA",o.height=p,o.width=d,t!==void 0){let h=u();h.width=d,h.height=p;let f=l(h);if(f!=null)f.putImageData(e,0,0),s=f.getImageData(0,0,d,p).data;else throw new Error("Can not access image data")}else s=e.data}else if(a){if(t===void 0)throw new Error("Please provide image config with format for Imagebitmap");let p=u();p.width=e.width,p.height=e.height;let d=l(p);if(d!=null){let h=e.height,f=e.width;return d.drawImage(e,0,0,f,h),s=d.getImageData(0,0,f,h).data,o.height=h,o.width=f,nt(s,o)}else throw new Error("Can not access image data")}else{if(n)return new Promise((p,d)=>{let h=u(),f=l(h);if(!e||!f)return d();let g=new Image;g.crossOrigin="Anonymous",g.src=e,g.onload=()=>{h.width=g.width,h.height=g.height,f.drawImage(g,0,0,h.width,h.height);let w=f.getImageData(0,0,h.width,h.height);o.height=h.height,o.width=h.width,p(nt(w.data,o))}});throw new Error("Input data provided is not supported - aborted tensor creation")}if(s!==void 0)return nt(s,o);throw new Error("Input data provided is not supported - aborted tensor creation")},ur=(e,t)=>{let{width:r,height:i,download:a,dispose:n}=t;return new Ue({location:"texture",type:"float32",texture:e,dims:[1,i,r,4],download:a,dispose:n})},lr=(e,t)=>{let{dataType:r,dims:i,download:a,dispose:n}=t;return new Ue({location:"gpu-buffer",type:r??"float32",gpuBuffer:e,dims:i,download:a,dispose:n})},Pe=(e,t)=>{let{dataType:r,dims:i,download:a,dispose:n}=t;return new Ue({location:"ml-tensor",type:r??"float32",mlTensor:e,dims:i,download:a,dispose:n})},Ft=(e,t,r)=>new Ue({location:"cpu-pinned",type:e,data:t,dims:r??[t.length]})}),tt,St,dr,di,ka=k(()=>{"use strict";tt=new Map([["float32",Float32Array],["uint8",Uint8Array],["int8",Int8Array],["uint16",Uint16Array],["int16",Int16Array],["int32",Int32Array],["bool",Uint8Array],["float64",Float64Array],["uint32",Uint32Array],["int4",Uint8Array],["uint4",Uint8Array]]),St=new Map([[Float32Array,"float32"],[Uint8Array,"uint8"],[Int8Array,"int8"],[Uint16Array,"uint16"],[Int16Array,"int16"],[Int32Array,"int32"],[Float64Array,"float64"],[Uint32Array,"uint32"]]),dr=!1,di=()=>{if(!dr){dr=!0;let e=typeof BigInt64Array<"u"&&BigInt64Array.from,t=typeof BigUint64Array<"u"&&BigUint64Array.from,r=globalThis.Float16Array,i=typeof r<"u"&&r.from;e&&(tt.set("int64",BigInt64Array),St.set(BigInt64Array,"int64")),t&&(tt.set("uint64",BigUint64Array),St.set(BigUint64Array,"uint64")),i?(tt.set("float16",r),St.set(r,"float16")):tt.set("float16",Uint16Array)}}}),pi,ci,za=k(()=>{"use strict";pr(),pi=e=>{let t=1;for(let r=0;r<e.length;r++){let i=e[r];if(typeof i!="number"||!Number.isSafeInteger(i))throw new TypeError(`dims[${r}] must be an integer, got: ${i}`);if(i<0)throw new RangeError(`dims[${r}] must be a non-negative integer, got: ${i}`);t*=i}return t},ci=(e,t)=>{switch(e.location){case"cpu":return new Ue(e.type,e.data,t);case"cpu-pinned":return new Ue({location:"cpu-pinned",data:e.data,type:e.type,dims:t});case"texture":return new Ue({location:"texture",texture:e.texture,type:e.type,dims:t});case"gpu-buffer":return new Ue({location:"gpu-buffer",gpuBuffer:e.gpuBuffer,type:e.type,dims:t});case"ml-tensor":return new Ue({location:"ml-tensor",mlTensor:e.mlTensor,type:e.type,dims:t});default:throw new Error(`tensorReshape: tensor location ${e.location} is not supported`)}}}),Ue,pr=k(()=>{"use strict";Mt(),li(),ka(),za(),Ue=class{constructor(e,t,r){di();let i,a;if(typeof e=="object"&&"location"in e)switch(this.dataLocation=e.location,i=e.type,a=e.dims,e.location){case"cpu-pinned":{let s=tt.get(i);if(!s)throw new TypeError(`unsupported type "${i}" to create tensor from pinned buffer`);if(!(e.data instanceof s))throw new TypeError(`buffer should be of type ${s.name}`);this.cpuData=e.data;break}case"texture":if(i!=="float32")throw new TypeError(`unsupported type "${i}" to create tensor from texture`);this.gpuTextureData=e.texture,this.downloader=e.download,this.disposer=e.dispose;break;case"gpu-buffer":if(i!=="float32"&&i!=="float16"&&i!=="int32"&&i!=="int64"&&i!=="uint32"&&i!=="uint8"&&i!=="bool"&&i!=="uint4"&&i!=="int4")throw new TypeError(`unsupported type "${i}" to create tensor from gpu buffer`);this.gpuBufferData=e.gpuBuffer,this.downloader=e.download,this.disposer=e.dispose;break;case"ml-tensor":if(i!=="float32"&&i!=="float16"&&i!=="int32"&&i!=="int64"&&i!=="uint32"&&i!=="uint64"&&i!=="int8"&&i!=="uint8"&&i!=="bool"&&i!=="uint4"&&i!=="int4")throw new TypeError(`unsupported type "${i}" to create tensor from MLTensor`);this.mlTensorData=e.mlTensor,this.downloader=e.download,this.disposer=e.dispose;break;default:throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`)}else{let s,o;if(typeof e=="string")if(i=e,o=r,e==="string"){if(!Array.isArray(t))throw new TypeError("A string tensor's data must be a string array.");s=t}else{let u=tt.get(e);if(u===void 0)throw new TypeError(`Unsupported tensor type: ${e}.`);if(Array.isArray(t)){if(e==="float16"&&u===Uint16Array||e==="uint4"||e==="int4")throw new TypeError(`Creating a ${e} tensor from number array is not supported. Please use ${u.name} as data.`);e==="uint64"||e==="int64"?s=u.from(t,BigInt):s=u.from(t)}else if(t instanceof u)s=t;else if(t instanceof Uint8ClampedArray)if(e==="uint8")s=Uint8Array.from(t);else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");else if(e==="float16"&&t instanceof Uint16Array&&u!==Uint16Array)s=new globalThis.Float16Array(t.buffer,t.byteOffset,t.length);else throw new TypeError(`A ${i} tensor's data must be type of ${u}`)}else if(o=t,Array.isArray(e)){if(e.length===0)throw new TypeError("Tensor type cannot be inferred from an empty array.");let u=typeof e[0];if(u==="string")i="string",s=e;else if(u==="boolean")i="bool",s=Uint8Array.from(e);else throw new TypeError(`Invalid element type of data array: ${u}.`)}else if(e instanceof Uint8ClampedArray)i="uint8",s=Uint8Array.from(e);else{let u=St.get(e.constructor);if(u===void 0)throw new TypeError(`Unsupported type for tensor data: ${e.constructor}.`);i=u,s=e}if(o===void 0)o=[s.length];else if(!Array.isArray(o))throw new TypeError("A tensor's dims must be a number array");a=o,this.cpuData=s,this.dataLocation="cpu"}let n=pi(a);if(this.cpuData&&n!==this.cpuData.length&&!((i==="uint4"||i==="int4")&&Math.ceil(n/2)===this.cpuData.length))throw new Error(`Tensor's size(${n}) does not match data length(${this.cpuData.length}).`);this.type=i,this.dims=a,this.size=n}static async fromImage(e,t){return or(e,t)}static fromTexture(e,t){return ur(e,t)}static fromGpuBuffer(e,t){return lr(e,t)}static fromMLTensor(e,t){return Pe(e,t)}static fromPinnedBuffer(e,t,r){return Ft(e,t,r)}toDataURL(e){return We(this,e)}toImageData(e){return xt(this,e)}get data(){if(this.ensureValid(),!this.cpuData)throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");return this.cpuData}get location(){return this.dataLocation}get texture(){if(this.ensureValid(),!this.gpuTextureData)throw new Error("The data is not stored as a WebGL texture.");return this.gpuTextureData}get gpuBuffer(){if(this.ensureValid(),!this.gpuBufferData)throw new Error("The data is not stored as a WebGPU buffer.");return this.gpuBufferData}get mlTensor(){if(this.ensureValid(),!this.mlTensorData)throw new Error("The data is not stored as a WebNN MLTensor.");return this.mlTensorData}async getData(e){switch(this.ensureValid(),this.dataLocation){case"cpu":case"cpu-pinned":return this.data;case"texture":case"gpu-buffer":case"ml-tensor":if(!this.downloader)throw new Error("The current tensor is not created with a specified data downloader.");if(this.isDownloading)throw new Error("The current tensor is being downloaded.");try{this.isDownloading=!0;let t=await this.downloader();return this.downloader=void 0,this.dataLocation="cpu",this.cpuData=t,e&&this.disposer&&(this.disposer(),this.disposer=void 0),t}finally{this.isDownloading=!1}default:throw new Error(`cannot get data from location: ${this.dataLocation}`)}}dispose(){if(this.isDownloading)throw new Error("The current tensor is being downloaded.");this.disposer&&(this.disposer(),this.disposer=void 0),this.cpuData=void 0,this.gpuTextureData=void 0,this.gpuBufferData=void 0,this.mlTensorData=void 0,this.downloader=void 0,this.isDownloading=void 0,this.dataLocation="none"}ensureValid(){if(this.dataLocation==="none")throw new Error("The tensor is disposed.")}reshape(e){if(this.ensureValid(),this.downloader||this.disposer)throw new Error("Cannot reshape a tensor that owns GPU resource.");return ci(this,e)}}}),He,hi=k(()=>{"use strict";pr(),He=Ue}),Dt,cr,et,Qe,st,ot,fi=k(()=>{"use strict";Ge(),Dt=(e,t)=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||console.timeStamp(`${e}::ORT::${t}`)},cr=(e,t)=>{let r=new Error().stack?.split(/\r\n|\r|\n/g)||[],i=!1;for(let a=0;a<r.length;a++){if(i&&!r[a].includes("TRACE_FUNC")){let n=`FUNC_${e}::${r[a].trim().split(" ")[1]}`;t&&(n+=`::${t}`),Dt("CPU",n);return}r[a].includes("TRACE_FUNC")&&(i=!0)}},et=e=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||cr("BEGIN",e)},Qe=e=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||cr("END",e)},st=e=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||console.time(`ORT::${e}`)},ot=e=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||console.timeEnd(`ORT::${e}`)}}),mi,Ca=k(()=>{"use strict";Le(),hi(),fi(),mi=class kp{constructor(t){this.handler=t}async run(t,r,i){et(),st("InferenceSession.run");let a={},n={};if(typeof t!="object"||t===null||t instanceof He||Array.isArray(t))throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");let s=!0;if(typeof r=="object"){if(r===null)throw new TypeError("Unexpected argument[1]: cannot be null.");if(r instanceof He)throw new TypeError("'fetches' cannot be a Tensor");if(Array.isArray(r)){if(r.length===0)throw new TypeError("'fetches' cannot be an empty array.");s=!1;for(let l of r){if(typeof l!="string")throw new TypeError("'fetches' must be a string array or an object.");if(this.outputNames.indexOf(l)===-1)throw new RangeError(`'fetches' contains invalid output name: ${l}.`);a[l]=null}if(typeof i=="object"&&i!==null)n=i;else if(typeof i<"u")throw new TypeError("'options' must be an object.")}else{let l=!1,p=Object.getOwnPropertyNames(r);for(let d of this.outputNames)if(p.indexOf(d)!==-1){let h=r[d];(h===null||h instanceof He)&&(l=!0,s=!1,a[d]=h)}if(l){if(typeof i=="object"&&i!==null)n=i;else if(typeof i<"u")throw new TypeError("'options' must be an object.")}else n=r}}else if(typeof r<"u")throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");for(let l of this.inputNames)if(typeof t[l]>"u")throw new Error(`input '${l}' is missing in 'feeds'.`);if(s)for(let l of this.outputNames)a[l]=null;let o=await this.handler.run(t,a,n),u={};for(let l in o)if(Object.hasOwnProperty.call(o,l)){let p=o[l];p instanceof He?u[l]=p:u[l]=new He(p.type,p.data,p.dims)}return ot("InferenceSession.run"),Qe(),u}async release(){return this.handler.dispose()}static async create(t,r,i,a){et(),st("InferenceSession.create");let n,s={};if(typeof t=="string"){if(n=t,typeof r=="object"&&r!==null)s=r;else if(typeof r<"u")throw new TypeError("'options' must be an object.")}else if(t instanceof Uint8Array){if(n=t,typeof r=="object"&&r!==null)s=r;else if(typeof r<"u")throw new TypeError("'options' must be an object.")}else if(t instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&t instanceof SharedArrayBuffer){let p=t,d=0,h=t.byteLength;if(typeof r=="object"&&r!==null)s=r;else if(typeof r=="number"){if(d=r,!Number.isSafeInteger(d))throw new RangeError("'byteOffset' must be an integer.");if(d<0||d>=p.byteLength)throw new RangeError(`'byteOffset' is out of range [0, ${p.byteLength}).`);if(h=t.byteLength-d,typeof i=="number"){if(h=i,!Number.isSafeInteger(h))throw new RangeError("'byteLength' must be an integer.");if(h<=0||d+h>p.byteLength)throw new RangeError(`'byteLength' is out of range (0, ${p.byteLength-d}].`);if(typeof a=="object"&&a!==null)s=a;else if(typeof a<"u")throw new TypeError("'options' must be an object.")}else if(typeof i<"u")throw new TypeError("'byteLength' must be a number.")}else if(typeof r<"u")throw new TypeError("'options' must be an object.");n=new Uint8Array(p,d,h)}else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");let[o,u]=await he(s),l=await o.createInferenceSessionHandler(n,u);return ot("InferenceSession.create"),Qe(),new kp(l)}startProfiling(){this.handler.startProfiling()}endProfiling(){this.handler.endProfiling()}get inputNames(){return this.handler.inputNames}get outputNames(){return this.handler.outputNames}get inputMetadata(){return this.handler.inputMetadata}get outputMetadata(){return this.handler.outputMetadata}}}),hr,Aa=k(()=>{"use strict";Ca(),hr=mi}),Oa=k(()=>{"use strict"}),Ra=k(()=>{"use strict"}),Ba=k(()=>{"use strict"}),Ma=k(()=>{"use strict"}),gi={};ie(gi,{InferenceSession:()=>hr,TRACE:()=>Dt,TRACE_EVENT_BEGIN:()=>st,TRACE_EVENT_END:()=>ot,TRACE_FUNC_BEGIN:()=>et,TRACE_FUNC_END:()=>Qe,Tensor:()=>He,env:()=>te,registerBackend:()=>le});var Xe=k(()=>{"use strict";at(),dt(),Aa(),hi(),Oa(),Ra(),fi(),Ba(),Ma()}),fr=k(()=>{"use strict"}),yi={};ie(yi,{default:()=>wi});var mr,gr,wi,Da=k(()=>{"use strict";dp(),ht(),$r(),mr="ort-wasm-proxy-worker",gr=globalThis.self?.name===mr,gr&&(self.onmessage=e=>{let{type:t,in:r}=e.data;try{switch(t){case"init-wasm":Sr(r.wasm).then(()=>{Cn(r).then(()=>{postMessage({type:t})},i=>{postMessage({type:t,err:i})})},i=>{postMessage({type:t,err:i})});break;case"init-ep":{let{epName:i,env:a}=r;An(a,i).then(()=>{postMessage({type:t})},n=>{postMessage({type:t,err:n})});break}case"copy-from":{let{buffer:i}=r,a=xa(i);postMessage({type:t,out:a});break}case"create":{let{model:i,options:a}=r;Rn(i,a).then(n=>{postMessage({type:t,out:n})},n=>{postMessage({type:t,err:n})});break}case"release":Bn(r),postMessage({type:t});break;case"run":{let{sessionId:i,inputIndices:a,inputs:n,outputIndices:s,options:o}=r;Dn(i,a,n,s,new Array(s.length).fill(null),o).then(u=>{u.some(l=>l[3]!=="cpu")?postMessage({type:t,err:"Proxy does not support non-cpu tensor location."}):postMessage({type:t,out:u},Un([...n,...u]))},u=>{postMessage({type:t,err:u})});break}case"end-profiling":Pn(r),postMessage({type:t});break;default:}}catch(i){postMessage({type:t,err:i})}}),wi=gr?null:e=>new Worker(e??Ne,{type:"classic",name:mr})}),_i,bi,Ne,yr,Gt,$i,vi,wr,xi,_r,Si,br,Ti,$r=k(()=>{"use strict";fr(),_i=typeof location>"u"?void 0:location.origin,bi=()=>typeof document<"u"?document.currentScript?.src:typeof self<"u"?self.location?.href:void 0,Ne=bi(),yr=()=>{if(Ne&&!Ne.startsWith("blob:"))return Ne.substring(0,Ne.lastIndexOf("/")+1)},Gt=(e,t)=>{try{let r=t??Ne;return(r?new URL(e,r):new URL(e)).origin===_i}catch{return!1}},$i=(e,t)=>{let r=t??Ne;try{return(r?new URL(e,r):new URL(e)).href}catch{return}},vi=(e,t)=>`${t??"./"}${e}`,wr=async e=>{let t=await(await fetch(e,{credentials:"same-origin"})).blob();return URL.createObjectURL(t)},xi=async e=>(await Ep(async()=>{const{default:t}=await import(e);return{default:t}},[])).default,_r=(Da(),pe(yi)).default,Si=async()=>{if(!Ne)throw new Error("Failed to load proxy worker: cannot determine the script source URL.");if(Gt(Ne))return[void 0,_r()];let e=await wr(Ne);return[e,_r(e)]},br=void 0,Ti=async(e,t,r,i)=>{let a=br&&!(e||t);if(a)if(Ne)a=Gt(Ne);else if(i&&!r)a=!0;else throw new Error("cannot determine the script source URL.");if(a)return[void 0,br];{let n="ort-wasm-simd-threaded.jsep.mjs",s=e??$i(n,t),o=r&&s&&!Gt(s,t),u=o?await wr(s):s??vi(n,t);return[o?u:void 0,await xi(u)]}}}),vr,Wt,Tt,xr,Ei,Ii,ki,Sr,de,ht=k(()=>{"use strict";$r(),Wt=!1,Tt=!1,xr=!1,Ei=()=>{if(typeof SharedArrayBuffer>"u")return!1;try{return typeof MessageChannel<"u"&&new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)),WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,4,1,3,1,1,10,11,1,9,0,65,0,254,16,2,0,26,11]))}catch{return!1}},Ii=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,30,1,28,0,65,0,253,15,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,186,1,26,11]))}catch{return!1}},ki=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,19,1,17,0,65,1,253,15,65,2,253,15,65,3,253,15,253,147,2,11]))}catch{return!1}},Sr=async e=>{if(Wt)return Promise.resolve();if(Tt)throw new Error("multiple calls to 'initializeWebAssembly()' detected.");if(xr)throw new Error("previous call to 'initializeWebAssembly()' failed.");Tt=!0;let t=e.initTimeout,r=e.numThreads;if(e.simd!==!1){if(e.simd==="relaxed"){if(!ki())throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.")}else if(!Ii())throw new Error("WebAssembly SIMD is not supported in the current environment.")}let i=Ei();r>1&&!i&&(typeof self<"u"&&!self.crossOriginIsolated&&console.warn("env.wasm.numThreads is set to "+r+", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."),console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."),e.numThreads=r=1);let a=e.wasmPaths,n=typeof a=="string"?a:void 0,s=a?.mjs,o=s?.href??s,u=a?.wasm,l=u?.href??u,p=e.wasmBinary,[d,h]=await Ti(o,n,r>1,!!p||!!l),f=!1,g=[];if(t>0&&g.push(new Promise(w=>{setTimeout(()=>{f=!0,w()},t)})),g.push(new Promise((w,$)=>{let _={numThreads:r};if(p)_.wasmBinary=p;else if(l||n)_.locateFile=y=>l??n+y;else if(o&&o.indexOf("blob:")!==0)_.locateFile=y=>new URL(y,o).href;else if(d){let y=yr();y&&(_.locateFile=v=>y+v)}h(_).then(y=>{Tt=!1,Wt=!0,vr=y,w(),d&&URL.revokeObjectURL(d)},y=>{Tt=!1,xr=!0,$(y)})})),await Promise.race(g),f)throw new Error(`WebAssembly backend initializing failed due to timeout: ${t}ms`)},de=()=>{if(Wt&&vr)return vr;throw new Error("WebAssembly is not initialized yet.")}}),je,Ht,ae,Tr=k(()=>{"use strict";ht(),je=(e,t)=>{let r=de(),i=r.lengthBytesUTF8(e)+1,a=r._malloc(i);return r.stringToUTF8(e,a,i),t.push(a),a},Ht=(e,t,r,i)=>{if(typeof e=="object"&&e!==null){if(r.has(e))throw new Error("Circular reference in options");r.add(e)}Object.entries(e).forEach(([a,n])=>{let s=t?t+a:a;if(typeof n=="object")Ht(n,s+".",r,i);else if(typeof n=="string"||typeof n=="number")i(s,n.toString());else if(typeof n=="boolean")i(s,n?"1":"0");else throw new Error(`Can't handle extra config type: ${typeof n}`)})},ae=e=>{let t=de(),r=t.stackSave();try{let i=t.PTR_SIZE,a=t.stackAlloc(2*i);t._OrtGetLastError(a,a+i);let n=Number(t.getValue(a,i===4?"i32":"i64")),s=t.getValue(a+i,"*"),o=s?t.UTF8ToString(s):"";throw new Error(`${e} ERROR_CODE: ${n}, ERROR_MESSAGE: ${o}`)}finally{t.stackRestore(r)}}}),zi,Pa=k(()=>{"use strict";ht(),Tr(),zi=e=>{let t=de(),r=0,i=[],a=e||{};try{if(e?.logSeverityLevel===void 0)a.logSeverityLevel=2;else if(typeof e.logSeverityLevel!="number"||!Number.isInteger(e.logSeverityLevel)||e.logSeverityLevel<0||e.logSeverityLevel>4)throw new Error(`log severity level is not valid: ${e.logSeverityLevel}`);if(e?.logVerbosityLevel===void 0)a.logVerbosityLevel=0;else if(typeof e.logVerbosityLevel!="number"||!Number.isInteger(e.logVerbosityLevel))throw new Error(`log verbosity level is not valid: ${e.logVerbosityLevel}`);e?.terminate===void 0&&(a.terminate=!1);let n=0;return e?.tag!==void 0&&(n=je(e.tag,i)),r=t._OrtCreateRunOptions(a.logSeverityLevel,a.logVerbosityLevel,!!a.terminate,n),r===0&&ae("Can't create run options."),e?.extra!==void 0&&Ht(e.extra,"",new WeakSet,(s,o)=>{let u=je(s,i),l=je(o,i);t._OrtAddRunConfigEntry(r,u,l)!==0&&ae(`Can't set a run config entry: ${s} - ${o}.`)}),[r,i]}catch(n){throw r!==0&&t._OrtReleaseRunOptions(r),i.forEach(s=>t._free(s)),n}}}),Ci,Ai,Oi,Et,Ri,Bi,Ua=k(()=>{"use strict";ht(),Tr(),Ci=e=>{switch(e){case"disabled":return 0;case"basic":return 1;case"extended":return 2;case"layout":return 3;case"all":return 99;default:throw new Error(`unsupported graph optimization level: ${e}`)}},Ai=e=>{switch(e){case"sequential":return 0;case"parallel":return 1;default:throw new Error(`unsupported execution mode: ${e}`)}},Oi=e=>{e.extra||(e.extra={}),e.extra.session||(e.extra.session={});let t=e.extra.session;t.use_ort_model_bytes_directly||(t.use_ort_model_bytes_directly="1"),e.executionProviders&&e.executionProviders.some(r=>(typeof r=="string"?r:r.name)==="webgpu")&&(e.enableMemPattern=!1)},Et=(e,t,r,i)=>{let a=je(t,i),n=je(r,i);de()._OrtAddSessionConfigEntry(e,a,n)!==0&&ae(`Can't set a session config entry: ${t} - ${r}.`)},Ri=async(e,t,r)=>{let i=t.executionProviders;for(let a of i){let n=typeof a=="string"?a:a.name,s=[];switch(n){case"webnn":if(n="WEBNN",typeof a!="string"){let d=a?.deviceType;d&&Et(e,"deviceType",d,r)}break;case"webgpu":if(n="JS",typeof a!="string"){let d=a;if(d?.preferredLayout){if(d.preferredLayout!=="NCHW"&&d.preferredLayout!=="NHWC")throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${d.preferredLayout}`);Et(e,"preferredLayout",d.preferredLayout,r)}}break;case"wasm":case"cpu":continue;default:throw new Error(`not supported execution provider: ${n}`)}let o=je(n,r),u=s.length,l=0,p=0;if(u>0){l=de()._malloc(u*de().PTR_SIZE),r.push(l),p=de()._malloc(u*de().PTR_SIZE),r.push(p);for(let d=0;d<u;d++)de().setValue(l+d*de().PTR_SIZE,s[d][0],"*"),de().setValue(p+d*de().PTR_SIZE,s[d][1],"*")}await de()._OrtAppendExecutionProvider(e,o,l,p,u)!==0&&ae(`Can't append execution provider: ${n}.`)}},Bi=async e=>{let t=de(),r=0,i=[],a=e||{};Oi(a);try{let n=Ci(a.graphOptimizationLevel??"all"),s=Ai(a.executionMode??"sequential"),o=typeof a.logId=="string"?je(a.logId,i):0,u=a.logSeverityLevel??2;if(!Number.isInteger(u)||u<0||u>4)throw new Error(`log severity level is not valid: ${u}`);let l=a.logVerbosityLevel??0;if(!Number.isInteger(l)||l<0||l>4)throw new Error(`log verbosity level is not valid: ${l}`);let p=typeof a.optimizedModelFilePath=="string"?je(a.optimizedModelFilePath,i):0;if(r=t._OrtCreateSessionOptions(n,!!a.enableCpuMemArena,!!a.enableMemPattern,s,!!a.enableProfiling,0,o,u,l,p),r===0&&ae("Can't create session options."),a.executionProviders&&await Ri(r,a,i),a.enableGraphCapture!==void 0){if(typeof a.enableGraphCapture!="boolean")throw new Error(`enableGraphCapture must be a boolean value: ${a.enableGraphCapture}`);Et(r,"enableGraphCapture",a.enableGraphCapture.toString(),i)}if(a.freeDimensionOverrides)for(let[d,h]of Object.entries(a.freeDimensionOverrides)){if(typeof d!="string")throw new Error(`free dimension override name must be a string: ${d}`);if(typeof h!="number"||!Number.isInteger(h)||h<0)throw new Error(`free dimension override value must be a non-negative integer: ${h}`);let f=je(d,i);t._OrtAddFreeDimensionOverride(r,f,h)!==0&&ae(`Can't set a free dimension override: ${d} - ${h}.`)}return a.extra!==void 0&&Ht(a.extra,"",new WeakSet,(d,h)=>{Et(r,d,h,i)}),[r,i]}catch(n){throw r!==0&&t._OrtReleaseSessionOptions(r)!==0&&ae("Can't release session options."),i.forEach(s=>t._free(s)),n}}}),ft,mt,gt,Er,Ir,kr,zr,Gr,ue=k(()=>{"use strict";ft=e=>{switch(e){case"int8":return 3;case"uint8":return 2;case"bool":return 9;case"int16":return 5;case"uint16":return 4;case"int32":return 6;case"uint32":return 12;case"float16":return 10;case"float32":return 1;case"float64":return 11;case"string":return 8;case"int64":return 7;case"uint64":return 13;case"int4":return 22;case"uint4":return 21;default:throw new Error(`unsupported data type: ${e}`)}},mt=e=>{switch(e){case 3:return"int8";case 2:return"uint8";case 9:return"bool";case 5:return"int16";case 4:return"uint16";case 6:return"int32";case 12:return"uint32";case 10:return"float16";case 1:return"float32";case 11:return"float64";case 8:return"string";case 7:return"int64";case 13:return"uint64";case 22:return"int4";case 21:return"uint4";default:throw new Error(`unsupported data type: ${e}`)}},gt=(e,t)=>{let r=[-1,4,1,1,2,2,4,8,-1,1,2,8,4,8,-1,-1,-1,-1,-1,-1,-1,.5,.5][e],i=typeof t=="number"?t:t.reduce((a,n)=>a*n,1);return r>0?Math.ceil(i*r):void 0},Er=e=>{switch(e){case"float16":return typeof Float16Array<"u"&&Float16Array.from?Float16Array:Uint16Array;case"float32":return Float32Array;case"uint8":return Uint8Array;case"int8":return Int8Array;case"uint16":return Uint16Array;case"int16":return Int16Array;case"int32":return Int32Array;case"bool":return Uint8Array;case"float64":return Float64Array;case"uint32":return Uint32Array;case"int64":return BigInt64Array;case"uint64":return BigUint64Array;default:throw new Error(`unsupported type: ${e}`)}},Ir=e=>{switch(e){case"verbose":return 0;case"info":return 1;case"warning":return 2;case"error":return 3;case"fatal":return 4;default:throw new Error(`unsupported logging level: ${e}`)}},kr=e=>e==="float32"||e==="float16"||e==="int32"||e==="int64"||e==="uint32"||e==="uint8"||e==="bool"||e==="uint4"||e==="int4",zr=e=>e==="float32"||e==="float16"||e==="int32"||e==="int64"||e==="uint32"||e==="uint64"||e==="int8"||e==="uint8"||e==="bool"||e==="uint4"||e==="int4",Gr=e=>{switch(e){case"none":return 0;case"cpu":return 1;case"cpu-pinned":return 2;case"texture":return 3;case"gpu-buffer":return 4;case"ml-tensor":return 5;default:throw new Error(`unsupported data location: ${e}`)}}}),Cr,Mi=k(()=>{"use strict";fr(),Cr=async e=>{if(typeof e=="string"){let t=await fetch(e);if(!t.ok)throw new Error(`failed to load external data file: ${e}`);let r=t.headers.get("Content-Length"),i=r?parseInt(r,10):0;if(i<1073741824)return new Uint8Array(await t.arrayBuffer());{if(!t.body)throw new Error(`failed to load external data file: ${e}, no response body.`);let a=t.body.getReader(),n;try{n=new ArrayBuffer(i)}catch(o){if(o instanceof RangeError){let u=Math.ceil(i/65536);n=new WebAssembly.Memory({initial:u,maximum:u}).buffer}else throw o}let s=0;for(;;){let{done:o,value:u}=await a.read();if(o)break;let l=u.byteLength;new Uint8Array(n,s,l).set(u),s+=l}return new Uint8Array(n,0,i)}}else return e instanceof Blob?new Uint8Array(await e.arrayBuffer()):e instanceof Uint8Array?e:new Uint8Array(e)}}),Di,Wr,Hr,Pt,jr,Kr,ze,yt=k(()=>{"use strict";ue(),Di=["V","I","W","E","F"],Wr=(e,t)=>{console.log(`[${Di[e]},${new Date().toISOString()}]${t}`)},jr=(e,t)=>{Hr=e,Pt=t},Kr=(e,t)=>{let r=Ir(e);r>=Ir(Hr)&&Wr(r,typeof t=="function"?t():t)},ze=(...e)=>{Pt&&Kr(...e)}}),Zr,Ut,M,Qt,Qr,Pi,It,ne=k(()=>{"use strict";Zr=class{static calcMatMulShape(e,t){return e[1]!==t[0]?void 0:[e[0],t[1]]}},Ut=class{static calcShape(e,t,r=!1){let i=e.length,a=t.length;if(i===0)return t;if(a===0)return e;let n=Math.max(e.length,t.length),s=new Array(n);if(r){if(i<2||a<2)return;let o=Zr.calcMatMulShape([e[i-2],e[i-1]],[t[a-2],t[a-1]]);if(o===void 0)return;[s[n-2],s[n-1]]=o}for(let o=r?3:1;o<=n;o++){let u=i-o<0?1:e[i-o],l=a-o<0?1:t[a-o];if(u!==l&&u>1&&l>1)return;let p=Math.max(u,l);if(u&&l)s[n-o]=Math.max(u,l);else{if(p>1)return;s[n-o]=0}}return s}static isValidBroadcast(e,t){let r=e.length,i=t.length;if(r>i)return!1;for(let a=1;a<=r;a++)if(e[r-a]!==1&&e[r-a]!==t[i-a])return!1;return!0}},M=class Ea{static size(t){return Ea.getSizeFromDimensionRange(t,0,t.length)}static convertShape(t,r=4){let i=t.length;if(i===0)return[];let a=new Array(i),n=i-1;for(;n>=0;){if(t[n]%r===0){a[n]=t[n]/r;break}if(r%t[n]!==0)throw new Error("cannot convert shape");a[n]=1,r/=t[n],n--}for(n--;n>=0;n--)a[n]=t[n];return a}static sizeFromDimension(t,r){if(r<0||r>t.length)throw new Error(`invalid dimension of ${r} for sizeFromDimension as Tensor has ${t.length} dimensions.`);return Ea.getSizeFromDimensionRange(t,r,t.length)}static sizeToDimension(t,r){if(r<0||r>t.length)throw new Error(`invalid dimension of ${r} for sizeToDimension as Tensor has ${t.length} dimensions.`);return Ea.getSizeFromDimensionRange(t,0,r)}static getSizeFromDimensionRange(t,r,i){let a=1;for(let n=r;n<i;n++){if(t[n]<0)throw new Error("cannot get valid size from specified dimension range. Most likely the range contains negative values in them.");a*=Number(t[n])}return a}static computeStrides(t){let r=t.length;if(r===0)return[];if(r===1)return[1];let i=new Array(r);i[r-1]=1,i[r-2]=t[r-1];for(let a=r-3;a>=0;--a)i[a]=i[a+1]*t[a+1];return i}static normalizeAxis(t,r){if(t<-r&&t>=r)throw new Error("unsupported axis for this operation.");return t<0?t+r:t}static normalizeAxes(t,r){return t.map(i=>this.normalizeAxis(i,r??t.length))}static sortBasedOnPerm(t,r){return r?r.map(i=>t[i]):t.slice().reverse()}static padShape(t,r){let i=t.length;return t.map((a,n)=>a+r[n]+r[n+i])}static areEqual(t,r){return t.length!==r.length?!1:t.every((i,a)=>i===r[a])}},Qt=class sa{static adjustPoolAttributes(t,r,i,a,n,s){if(!t&&i.length!==r.length-2)throw new Error("length of specified kernel shapes should be 2 less than length of input dimensions");if(t)for(let o=0;o<r.length-2;o++)o>=i.length?i.push(r[o+2]):i[o]=r[o+2];for(let o=0;o<i.length;o++)if(o<a.length){if(a[o]<0)throw new Error("strides should be greater than or equal to 1")}else a.push(1);for(let o=0;o<i.length;o++)if(o<n.length){if(n[o]<0)throw new Error("dilations should be greater than or equal to 1")}else n.push(1);for(let o=0;o<i.length*2;o++)if(o<s.length){if(s[o]<0)throw new Error("pad should be greater than or equal to 1")}else s.push(0);for(let o=0;o<i.length;o++){if(i[o]<=0)throw new Error("kernel shapes need to be greater than 0");if(s[o]>=i[o]||s[o+i.length]>=i[o])throw new Error("pads should be smaller than kernel")}}static adjustPadsBasedOnAutoPad(t,r,i,a,n,s,o){if(o){if(n.length!==2*(t.length-2))throw new Error("length of pads should be twice the length of data dimensions");if(r.length!==t.length-2)throw new Error("length of strides should be the length of data dimensions");if(a.length!==t.length-2)throw new Error("length of kernel shapes should be the length of data dimensions");for(let u=0;u<t.length-2;u++)sa.adjustPadAndReturnShape(t[u+(s?1:2)],r[u],i[u],a[u],n,u,u+t.length-2,o)}}static computePoolOutputShape(t,r,i,a,n,s,o){if(r.length<=0)throw new Error("input shape must be of size greater than 0");let u=[r[0],r[1]];return sa.computeShapeHelper(t,r,u,i,a,n,s,o),u}static computeConvOutputShape(t,r,i,a,n,s,o){if(t.length<=0||r.length<=0)throw new Error("invalid input tensor dims or invalid filter tensor dims");let u=[t[0],r[0]];return sa.computeShapeHelper(!1,t,u,i,a,n,s,o),u}static computeShapeHelper(t,r,i,a,n,s,o,u){if(t)for(let l=0;l<r.length-2;l++)i.push(1);else for(let l=0;l<r.length-2;l++)i.push(sa.adjustPadAndReturnShape(r[l+2],a[l],n[l],s[l],o,l,l+r.length-2,u))}static adjustPadAndReturnShape(t,r,i,a,n,s,o,u){let l=i*(a-1)+1;if(u&&u!=="NOTSET")switch(u){case"VALID":return n[s]=0,n[o]=0,Math.floor((t-l)/r+1);case"SAME_LOWER":case"SAME_UPPER":if(i!==1)throw new Error("Dilation not supported for SAME_UPPER or SAME_LOWER");{let p=((t+r-1)/r-1)*r+a-t;return n[s]=Math.floor(u==="SAME_LOWER"?(p+1)/2:p/2),n[o]=p-n[s],Math.floor((t+p-a)/r+1)}default:throw new Error("Unsupported AutoPad type")}else return Math.floor((t+n[s]+n[o]-l)/r+1)}},Qr=class{static getShapeOfGemmResult(e,t,r,i,a){if(e.length!==2||r.length!==2)throw new Error("shape need to be of size 2");let n,s,o;t?(n=e[1],s=e[0]):(n=e[0],s=e[1]);let u=-1;if(i?(o=r[0],u=1):(o=r[1],u=0),r[u]!==s)throw new Error("dimension mismatch");if(n<=0||o<=0||s<=0)throw new Error("invalid shape specified");if(a&&!Ut.isValidBroadcast(a,[n,o]))throw new Error("gemm: invalid bias shape for broadcast");return[n,o,s]}},Pi=-34028234663852886e22,It=34028234663852886e22}),Nt,Xt=k(()=>{"use strict";ue(),Nt=(e,t)=>new(Er(t))(e)}),jt,Yt,Ar,Or,kt,Lt,Xr,Yr,Jr,Ui,Ni,ua=k(()=>{"use strict";ue(),yt(),jt=new Map([["float32",32],["float16",16],["int32",32],["uint32",32],["int64",64],["uint64",64],["int8",8],["uint8",8],["int4",4],["uint4",4]]),Yt=(e,t)=>{if(t==="int32")return e;let r=jt.get(t);if(!r)throw new Error(`WebNN backend does not support data type: ${t}`);let i=r/8;if(e.byteLength%i!==0)throw new Error(`Invalid Uint8Array length - must be a multiple of ${i}.`);let a=e.byteLength/i,n=new(Er(t))(e.buffer,e.byteOffset,a);switch(t){case"int64":case"uint64":{let s=new Int32Array(a);for(let o=0;o<a;o++){let u=n[o];if(u>2147483647n||u<-2147483648n)throw new Error("Can not convert int64 data to int32 - value out of range.");s[o]=Number(u)}return new Uint8Array(s.buffer)}case"int8":case"uint8":case"uint32":{if(t==="uint32"&&n.some(o=>o>2147483647))throw new Error("Can not convert uint32 data to int32 - value out of range.");let s=Int32Array.from(n,Number);return new Uint8Array(s.buffer)}default:throw new Error(`Unsupported data conversion from ${t} to 'int32'`)}},Ar=(e,t)=>{if(t==="int32")return e;if(e.byteLength%4!==0)throw new Error("Invalid Uint8Array length - must be a multiple of 4 (int32).");let r=e.byteLength/4,i=new Int32Array(e.buffer,e.byteOffset,r);switch(t){case"int64":{let a=BigInt64Array.from(i,BigInt);return new Uint8Array(a.buffer)}case"uint64":{if(i.some(n=>n<0))throw new Error("Can not convert int32 data to uin64 - negative value found.");let a=BigUint64Array.from(i,BigInt);return new Uint8Array(a.buffer)}case"int8":{if(i.some(n=>n<-128||n>127))throw new Error("Can not convert int32 data to int8 - value out of range.");let a=Int8Array.from(i,Number);return new Uint8Array(a.buffer)}case"uint8":if(i.some(a=>a<0||a>255))throw new Error("Can not convert int32 data to uint8 - value out of range.");return Uint8Array.from(i,Number);case"uint32":{if(i.some(n=>n<0))throw new Error("Can not convert int32 data to uint32 - negative value found.");let a=Uint32Array.from(i,Number);return new Uint8Array(a.buffer)}default:throw new Error(`Unsupported data conversion from 'int32' to ${t}`)}},Or=1,kt=()=>Or++,Lt=new Map([["int8","int32"],["uint8","int32"],["uint32","int32"],["int64","int32"]]),Xr=(e,t)=>{let r=jt.get(e);if(!r)throw new Error(`WebNN backend does not support data type: ${e}`);return t.length>0?Math.ceil(t.reduce((i,a)=>i*a)*r/8):0},Yr=class{constructor(e){this.isDataConverted=!1;let{sessionId:t,context:r,tensor:i,dataType:a,shape:n,fallbackDataType:s}=e;this.sessionId=t,this.mlContext=r,this.mlTensor=i,this.dataType=a,this.tensorShape=n,this.fallbackDataType=s}get tensor(){return this.mlTensor}get type(){return this.dataType}get fallbackType(){return this.fallbackDataType}get shape(){return this.tensorShape}get byteLength(){return Xr(this.dataType,this.tensorShape)}destroy(){ze("verbose",()=>"[WebNN] TensorWrapper.destroy"),this.mlTensor.destroy()}write(e){this.mlContext.writeTensor(this.mlTensor,e)}async read(e){if(this.fallbackDataType){let t=await this.mlContext.readTensor(this.mlTensor),r=Ar(new Uint8Array(t),this.dataType);if(e){(e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength)).set(r);return}else return r.buffer}else return e?this.mlContext.readTensor(this.mlTensor,e):this.mlContext.readTensor(this.mlTensor)}canReuseTensor(e,t,r){return this.mlContext===e&&this.dataType===t&&this.tensorShape.length===r.length&&this.tensorShape.every((i,a)=>i===r[a])}setIsDataConverted(e){this.isDataConverted=e}},Jr=class{constructor(e,t){this.tensorManager=e,this.wrapper=t}get tensorWrapper(){return this.wrapper}releaseTensor(){this.tensorWrapper&&(this.tensorManager.releaseTensor(this.tensorWrapper),this.wrapper=void 0)}async ensureTensor(e,t,r,i){let a=this.tensorManager.getMLContext(e),n=this.tensorManager.getMLOpSupportLimits(e),s;if(!n?.input.dataTypes.includes(t)){if(s=Lt.get(t),!s||n?.input.dataTypes.includes(s))throw new Error(`WebNN backend does not support data type: ${t}`);ze("verbose",()=>`[WebNN] TensorIdTracker.ensureTensor: fallback dataType from ${t} to ${s}`)}if(this.wrapper){if(this.wrapper.canReuseTensor(a,t,r))return this.wrapper.tensor;if(i){if(this.wrapper.byteLength!==Xr(t,r))throw new Error("Unable to copy data to tensor with different size.");this.activeUpload=new Uint8Array(await this.wrapper.read())}this.tensorManager.releaseTensor(this.wrapper)}let o=typeof MLTensorUsage>"u"?void 0:MLTensorUsage.READ|MLTensorUsage.WRITE;return this.wrapper=await this.tensorManager.getCachedTensor(e,t,r,o,!0,!0,s),i&&this.activeUpload&&(this.wrapper.write(this.activeUpload),this.activeUpload=void 0),this.wrapper.tensor}upload(e){let t=e;if(this.wrapper){if(this.wrapper.fallbackType)if(this.wrapper.fallbackType==="int32")t=Yt(e,this.wrapper.type),this.wrapper.setIsDataConverted(!0);else throw new Error(`Unsupported fallback data type: ${this.wrapper.fallbackType}`);if(e.byteLength===this.wrapper.byteLength){this.wrapper.write(t);return}else ze("verbose",()=>"Data size does not match tensor size. Releasing tensor."),this.releaseTensor()}this.activeUpload?this.activeUpload.set(t):this.activeUpload=new Uint8Array(t)}async download(e){if(this.activeUpload){let t=this.wrapper?.isDataConverted?Ar(this.activeUpload,this.wrapper?.type):this.activeUpload;if(e){e instanceof ArrayBuffer?new Uint8Array(e).set(t):new Uint8Array(e.buffer,e.byteOffset,e.byteLength).set(t);return}else return t.buffer}if(!this.wrapper)throw new Error("Tensor has not been created.");return e?this.wrapper.read(e):this.wrapper.read()}},Ui=class{constructor(e){this.backend=e,this.tensorTrackersById=new Map,this.freeTensors=[],this.externalTensors=new Set}getMLContext(e){let t=this.backend.getMLContext(e);if(!t)throw new Error("MLContext not found for session.");return t}getMLOpSupportLimits(e){return this.backend.getMLOpSupportLimits(e)}reserveTensorId(){let e=kt();return this.tensorTrackersById.set(e,new Jr(this)),e}releaseTensorId(e){let t=this.tensorTrackersById.get(e);t&&(this.tensorTrackersById.delete(e),t.tensorWrapper&&this.releaseTensor(t.tensorWrapper))}async ensureTensor(e,t,r,i,a){ze("verbose",()=>`[WebNN] TensorManager.ensureTensor {tensorId: ${t}, dataType: ${r}, shape: ${i}, copyOld: ${a}}`);let n=this.tensorTrackersById.get(t);if(!n)throw new Error("Tensor not found.");return n.ensureTensor(e,r,i,a)}upload(e,t){let r=this.tensorTrackersById.get(e);if(!r)throw new Error("Tensor not found.");r.upload(t)}async download(e,t){ze("verbose",()=>`[WebNN] TensorManager.download {tensorId: ${e}, dstBuffer: ${t?.byteLength}}`);let r=this.tensorTrackersById.get(e);if(!r)throw new Error("Tensor not found.");return r.download(t)}releaseTensorsForSession(e){for(let t of this.freeTensors)t.sessionId===e&&t.destroy();this.freeTensors=this.freeTensors.filter(t=>t.sessionId!==e)}registerTensor(e,t,r,i){let a=this.getMLContext(e),n=kt(),s=new Yr({sessionId:e,context:a,tensor:t,dataType:r,shape:i});return this.tensorTrackersById.set(n,new Jr(this,s)),this.externalTensors.add(s),n}async getCachedTensor(e,t,r,i,a,n,s){let o=this.getMLContext(e);for(let[l,p]of this.freeTensors.entries())if(p.canReuseTensor(o,t,r)){ze("verbose",()=>`[WebNN] Reusing tensor {dataType: ${t}, ${s?`fallbackDataType: ${s},`:""} shape: ${r}`);let d=this.freeTensors.splice(l,1)[0];return d.sessionId=e,d}ze("verbose",()=>`[WebNN] MLContext.createTensor {dataType: ${t}, ${s?`fallbackDataType: ${s},`:""} shape: ${r}}`);let u=await o.createTensor({dataType:s??t,shape:r,dimensions:r,usage:i,writable:a,readable:n});return new Yr({sessionId:e,context:o,tensor:u,dataType:t,shape:r,fallbackDataType:s})}releaseTensor(e){this.externalTensors.has(e)&&this.externalTensors.delete(e),this.freeTensors.push(e)}},Ni=(...e)=>new Ui(...e)}),Jt,Li,Vi,qi=k(()=>{"use strict";ue(),ht(),Xt(),ua(),yt(),Jt=new Map([[1,"float32"],[10,"float16"],[6,"int32"],[12,"uint32"],[7,"int64"],[13,"uint64"],[22,"int4"],[21,"uint4"],[3,"int8"],[2,"uint8"],[9,"uint8"]]),Li=(e,t)=>{if(e===t)return!0;if(e===void 0||t===void 0)return!1;let r=Object.keys(e).sort(),i=Object.keys(t).sort();return r.length===i.length&&r.every((a,n)=>a===i[n]&&e[a]===t[a])},Vi=class{constructor(e){this.tensorManager=Ni(this),this.mlContextBySessionId=new Map,this.sessionIdsByMLContext=new Map,this.mlContextCache=[],this.sessionGraphInputs=new Map,this.sessionGraphOutputs=new Map,this.temporaryGraphInputs=[],this.temporaryGraphOutputs=[],this.temporarySessionTensorIds=new Map,this.mlOpSupportLimitsBySessionId=new Map,jr(e.logLevel,!!e.debug)}get currentSessionId(){if(this.activeSessionId===void 0)throw new Error("No active session");return this.activeSessionId}onRunStart(e){ze("verbose",()=>`[WebNN] onRunStart {sessionId: ${e}}`),this.activeSessionId=e}onRunEnd(e){ze("verbose",()=>`[WebNN] onRunEnd {sessionId: ${e}}`);let t=this.temporarySessionTensorIds.get(e);if(t){for(let r of t)ze("verbose",()=>`[WebNN] releasing temporary tensor {tensorId: ${r}}`),this.tensorManager.releaseTensorId(r);this.temporarySessionTensorIds.delete(e),this.activeSessionId=void 0}}async createMLContext(e){if(e instanceof GPUDevice){let r=this.mlContextCache.findIndex(i=>i.gpuDevice===e);if(r!==-1)return this.mlContextCache[r].mlContext;{let i=await navigator.ml.createContext(e);return this.mlContextCache.push({gpuDevice:e,mlContext:i}),i}}else if(e===void 0){let r=this.mlContextCache.findIndex(i=>i.options===void 0&&i.gpuDevice===void 0);if(r!==-1)return this.mlContextCache[r].mlContext;{let i=await navigator.ml.createContext();return this.mlContextCache.push({mlContext:i}),i}}let t=this.mlContextCache.findIndex(r=>Li(r.options,e));if(t!==-1)return this.mlContextCache[t].mlContext;{let r=await navigator.ml.createContext(e);return this.mlContextCache.push({options:e,mlContext:r}),r}}registerMLContext(e,t){this.mlContextBySessionId.set(e,t);let r=this.sessionIdsByMLContext.get(t);r||(r=new Set,this.sessionIdsByMLContext.set(t,r)),r.add(e),this.mlOpSupportLimitsBySessionId.has(e)||this.mlOpSupportLimitsBySessionId.set(e,t.opSupportLimits()),this.temporaryGraphInputs.length>0&&(this.sessionGraphInputs.set(e,this.temporaryGraphInputs),this.temporaryGraphInputs=[]),this.temporaryGraphOutputs.length>0&&(this.sessionGraphOutputs.set(e,this.temporaryGraphOutputs),this.temporaryGraphOutputs=[])}onReleaseSession(e){this.sessionGraphInputs.delete(e),this.sessionGraphOutputs.delete(e);let t=this.mlContextBySessionId.get(e);if(!t)return;this.tensorManager.releaseTensorsForSession(e),this.mlContextBySessionId.delete(e),this.mlOpSupportLimitsBySessionId.delete(e);let r=this.sessionIdsByMLContext.get(t);if(r.delete(e),r.size===0){this.sessionIdsByMLContext.delete(t);let i=this.mlContextCache.findIndex(a=>a.mlContext===t);i!==-1&&this.mlContextCache.splice(i,1)}}getMLContext(e){return this.mlContextBySessionId.get(e)}getMLOpSupportLimits(e){return this.mlOpSupportLimitsBySessionId.get(e)}reserveTensorId(){return this.tensorManager.reserveTensorId()}releaseTensorId(e){ze("verbose",()=>`[WebNN] releaseTensorId {tensorId: ${e}}`),this.tensorManager.releaseTensorId(e)}async ensureTensor(e,t,r,i,a){let n=Jt.get(r);if(!n)throw new Error(`Unsupported ONNX data type: ${r}`);return this.tensorManager.ensureTensor(e??this.currentSessionId,t,n,i,a)}async createTemporaryTensor(e,t,r){ze("verbose",()=>`[WebNN] createTemporaryTensor {onnxDataType: ${t}, shape: ${r}}`);let i=Jt.get(t);if(!i)throw new Error(`Unsupported ONNX data type: ${t}`);let a=this.tensorManager.reserveTensorId();await this.tensorManager.ensureTensor(e,a,i,r,!1);let n=this.temporarySessionTensorIds.get(e);return n?n.push(a):this.temporarySessionTensorIds.set(e,[a]),a}uploadTensor(e,t){if(!de().shouldTransferToMLTensor)throw new Error("Trying to upload to a MLTensor while shouldTransferToMLTensor is false");ze("verbose",()=>`[WebNN] uploadTensor {tensorId: ${e}, data: ${t.byteLength}}`),this.tensorManager.upload(e,t)}async downloadTensor(e,t){return this.tensorManager.download(e,t)}createMLTensorDownloader(e,t){return async()=>{let r=await this.tensorManager.download(e);return Nt(r,t)}}registerMLTensor(e,t,r,i){let a=Jt.get(r);if(!a)throw new Error(`Unsupported ONNX data type: ${r}`);let n=this.tensorManager.registerTensor(e,t,a,i);return ze("verbose",()=>`[WebNN] registerMLTensor {tensor: ${t}, dataType: ${a}, dimensions: ${i}} -> {tensorId: ${n}}`),n}registerMLConstant(e,t,r,i,a,n,s=!1){if(!n)throw new Error("External mounted files are not available.");let o=e;e.startsWith("./")&&(o=e.substring(2));let u=n.get(o);if(!u)throw new Error(`File with name ${o} not found in preloaded files.`);if(t+r>u.byteLength)throw new Error("Out of bounds: data offset and length exceed the external file data size.");let l=u.slice(t,t+r).buffer,p;switch(a.dataType){case"float32":p=new Float32Array(l);break;case"float16":p=typeof Float16Array<"u"&&Float16Array.from?new Float16Array(l):new Uint16Array(l);break;case"int32":p=new Int32Array(l);break;case"uint32":p=new Uint32Array(l);break;case"int64":if(s){let d=Yt(new Uint8Array(l),"int64");p=new Int32Array(d.buffer),a.dataType="int32"}else p=new BigInt64Array(l);break;case"uint64":p=new BigUint64Array(l);break;case"int8":p=new Int8Array(l);break;case"int4":case"uint4":case"uint8":p=new Uint8Array(l);break;default:throw new Error(`Unsupported data type: ${a.dataType} in creating WebNN Constant from external data.`)}return ze("verbose",()=>`[WebNN] registerMLConstant {dataType: ${a.dataType}, shape: ${a.shape}}} ${s?"(Note: it was int64 data type and registered to int32 as workaround)":""}`),i.constant(a,p)}registerGraphInput(e){this.temporaryGraphInputs.push(e)}registerGraphOutput(e){this.temporaryGraphOutputs.push(e)}isGraphInput(e,t){let r=this.sessionGraphInputs.get(e);return r?r.includes(t):!1}isGraphOutput(e,t){let r=this.sessionGraphOutputs.get(e);return r?r.includes(t):!1}isGraphInputOutputTypeSupported(e,t,r=!0){let i=Jt.get(ft(t)),a=this.mlOpSupportLimitsBySessionId.get(e);return typeof i>"u"?!1:r?!!a?.input.dataTypes.includes(i):!!a?.output.dataTypes.includes(i)}flush(){}}}),ei=k(()=>{"use strict"}),ti,ri,Rr,ii,ai,ni,Fi,Gi,la,Na=k(()=>{"use strict";yt(),ei(),ti=new Map([[64,250],[128,200],[256,200],[512,200],[2048,230],[4096,200],[8192,50],[16384,50],[32768,50],[65536,50],[131072,50],[262144,50],[524288,50],[1048576,50],[2097152,30],[4194304,20],[8388608,10],[12582912,10],[16777216,10],[26214400,15],[33554432,22],[44236800,2],[58982400,6],[67108864,6],[134217728,6],[167772160,6]]),ri=[],Rr=e=>Math.ceil(Number(e)/16)*16,ii=e=>{for(let t=0;t<ri.length;t++){let r=ri[t];if(e<=r)return r}return Math.ceil(e/16)*16},ai=1,ni=()=>ai++,Fi=async(e,t,r,i)=>{let a=Rr(r),n=e.device.createBuffer({size:a,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{let s=e.getCommandEncoder();e.endComputePass(),s.copyBufferToBuffer(t,0,n,0,a),e.flush(),await n.mapAsync(GPUMapMode.READ);let o=n.getMappedRange();if(i){let u=i();return u.set(new Uint8Array(o,0,r)),u}else return new Uint8Array(o.slice(0,r))}finally{n.destroy()}},Gi=class{constructor(e){this.backend=e,this.storageCache=new Map,this.freeBuffers=new Map,this.freeUniformBuffers=new Map,this.buffersPending=[],this.capturedPendingBuffers=new Map;for(let[t]of ti)ri.push(t),this.freeBuffers.set(t,[]),this.freeUniformBuffers.set(t,[]);this.sessionCount=0}upload(e,t){let r=t.buffer,i=t.byteOffset,a=t.byteLength,n=Rr(a),s=this.storageCache.get(e);if(!s)throw new Error("gpu data for uploading does not exist");if(Number(s.originalSize)!==a)throw new Error(`inconsistent data size. gpu data size=${s.originalSize}, data size=${a}`);let o=this.backend.device.createBuffer({mappedAtCreation:!0,size:n,usage:GPUBufferUsage.MAP_WRITE|GPUBufferUsage.COPY_SRC}),u=o.getMappedRange();new Uint8Array(u).set(new Uint8Array(r,i,a)),o.unmap();let l=this.backend.device.createCommandEncoder();l.copyBufferToBuffer(o,0,s.gpuData.buffer,0,n),this.backend.device.queue.submit([l.finish()]),o.destroy(),ze("verbose",()=>`[WebGPU] GpuDataManager.upload(id=${e})`)}memcpy(e,t){let r=this.storageCache.get(e);if(!r)throw new Error("source gpu data for memcpy does not exist");let i=this.storageCache.get(t);if(!i)throw new Error("destination gpu data for memcpy does not exist");if(r.originalSize!==i.originalSize)throw new Error("inconsistent source and destination gpu data size");let a=Rr(r.originalSize),n=this.backend.getCommandEncoder();this.backend.endComputePass(),n.copyBufferToBuffer(r.gpuData.buffer,0,i.gpuData.buffer,0,a)}registerExternalBuffer(e,t,r){let i;if(r){if(i=r[0],e===r[1])return ze("verbose",()=>`[WebGPU] GpuDataManager.registerExternalBuffer(size=${t}) => id=${i}, buffer is the same, skip.`),i;if(this.backend.capturedCommandList.has(this.backend.currentSessionId))throw new Error(`Registering a different external buffer under graph capture mode is not supported yet.
             Please use the previous external buffer!`)}else i=ni();return this.storageCache.set(i,{gpuData:{id:i,type:0,buffer:e},originalSize:t}),ze("verbose",()=>`[WebGPU] GpuDataManager.registerExternalBuffer(size=${t}) => id=${i}, registered.`),i}unregisterExternalBuffer(e){e!==void 0&&(this.storageCache.delete(e),ze("verbose",()=>`[WebGPU] GpuDataManager.unregisterExternalBuffer() => id=${e}`))}create(e,t=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST){let r=ii(e),i,a=(t&GPUBufferUsage.STORAGE)===GPUBufferUsage.STORAGE,n=(t&GPUBufferUsage.UNIFORM)===GPUBufferUsage.UNIFORM;if(a||n){let o=(a?this.freeBuffers:this.freeUniformBuffers).get(r);o?o.length>0?i=o.pop():i=this.backend.device.createBuffer({size:r,usage:t}):i=this.backend.device.createBuffer({size:r,usage:t})}else i=this.backend.device.createBuffer({size:r,usage:t});let s={id:ni(),type:0,buffer:i};return this.storageCache.set(s.id,{gpuData:s,originalSize:Number(e)}),ze("verbose",()=>`[WebGPU] GpuDataManager.create(size=${e}) => id=${s.id}`),s}get(e){return this.storageCache.get(e)?.gpuData}release(e){let t=typeof e=="bigint"?Number(e):e,r=this.storageCache.get(t);if(!r){if(this.storageCache.size===0)return 0;throw new Error("releasing data does not exist")}return ze("verbose",()=>`[WebGPU] GpuDataManager.release(id=${t}), gpuDataId=${r.gpuData.id}`),this.storageCache.delete(t),this.buffersPending.push(r.gpuData.buffer),r.originalSize}async download(e,t){let r=this.storageCache.get(Number(e));if(!r)throw new Error("data does not exist");await Fi(this.backend,r.gpuData.buffer,r.originalSize,t)}refreshPendingBuffers(){if(this.buffersPending.length!==0)if(this.backend.sessionStatus==="default"){for(let e of this.buffersPending){let t=ti.get(e.size);if((e.usage&GPUBufferUsage.STORAGE)===GPUBufferUsage.STORAGE){let r=this.freeBuffers.get(e.size)||[];t===void 0||r.length>=t?e.destroy():r.push(e)}else if((e.usage&GPUBufferUsage.UNIFORM)===GPUBufferUsage.UNIFORM){let r=this.freeUniformBuffers.get(e.size)||[];t===void 0||r.length>=t?e.destroy():r.push(e)}else e.destroy()}this.buffersPending=[]}else{let e=this.capturedPendingBuffers.get(this.backend.currentSessionId);e||(e=[],this.capturedPendingBuffers.set(this.backend.currentSessionId,e));for(let t of this.buffersPending)e.push(t);this.buffersPending=[]}}dispose(){this.freeBuffers.forEach(e=>{e.forEach(t=>{t.destroy()})}),this.freeUniformBuffers.forEach(e=>{e.forEach(t=>{t.destroy()})}),this.storageCache.forEach(e=>{e.gpuData.buffer.destroy()}),this.capturedPendingBuffers.forEach(e=>{e.forEach(t=>{t.destroy()})}),this.storageCache=new Map,this.freeBuffers=new Map,this.freeUniformBuffers=new Map,this.capturedPendingBuffers=new Map}onCreateSession(){this.sessionCount+=1}onReleaseSession(e){let t=this.capturedPendingBuffers.get(e);t&&(t.forEach(r=>{r.destroy()}),this.capturedPendingBuffers.delete(e)),this.sessionCount-=1,this.sessionCount===0&&(ze("warning",()=>"[WebGPU] Clearing webgpu buffer cache"),this.storageCache.forEach(r=>{r.gpuData.buffer.destroy()}),this.storageCache=new Map)}},la=(...e)=>new Gi(...e)}),c,m,b=k(()=>{"use strict";c=class{constructor(e){Object.assign(this,e)}get cacheKey(){return this.key||(this.key=Object.getOwnPropertyNames(this).sort().map(e=>`${this[e]}`).join(";")),this.key}},m=e=>new c(e)}),T,S,O,z,E,A,L,q,P,D,Y,C,F,Ve,re,Q,Oe,j=k(()=>{"use strict";ue(),ne(),T=64,S=(e,t)=>{if(t===3)throw new Error("vec3 has same alignment as vec4, use vec4 instead");switch(Number(e)){case 10:return t>1?`vec${t}<f16>`:"f16";case 1:return t>1?`vec${t}<f32>`:"f32";case 6:return t>1?`vec${t}<i32>`:"i32";case 12:return t>1?`vec${t}<u32>`:"u32";case 7:if(t>1)throw new Error("currently not supported vecX of uint64 yet");return["vec2<u32>","i32"];case 13:if(t>1)throw new Error("currently not supported vecX of uint64 yet");return["vec2<u32>","u32"];case 9:if(t!==4)throw new Error("bool must be vec4");return["u32","vec4<bool>"];case 22:return"i32";case 21:return"u32";default:throw new Error(`Unknown data type: ${e}`)}},O=(e,t=1)=>{let r=S(e,t);return typeof r=="string"?r:r[0]},z=(e,t=1)=>{let r=S(e,t);return typeof r=="string"?r:r[1]},E=(...e)=>{let t=[];return e.forEach(r=>{r.length!==0&&t.push({type:12,data:r},{type:12,data:M.computeStrides(r)})}),t},A=e=>e%4===0?4:e%2===0?2:1,L=(e="f32",t,r="0")=>!t||t===1?`${e}(${r})`:`vec${t}<${e}>(${r})`,q=(e,t,r)=>e==="f32"?r:t===1?`f32(${r})`:`vec${t}<f32>(${r})`,P=(e,t)=>t===4?`(${e}.x + ${e}.y + ${e}.z + ${e}.w)`:t===2?`(${e}.x + ${e}.y)`:t===3?`(${e}.x + ${e}.y + ${e}.z)`:e,D=(e,t,r,i)=>e.startsWith("uniforms.")&&r>4?typeof t=="string"?i==="f16"?`${e}[(${t}) / 8][(${t}) % 8 / 4][(${t}) % 8 % 4]`:`${e}[(${t}) / 4][(${t}) % 4]`:i==="f16"?`${e}[${Math.floor(t/8)}][${Math.floor(t%8/4)}][${t%8%4}]`:`${e}[${Math.floor(t/4)}][${t%4}]`:r>1?`${e}[${t}]`:e,Y=(e,t,r,i,a)=>{let n=typeof r=="number",s=n?r:r.length,o=[...new Array(s).keys()],u=s<2?"u32":s<=4?`vec${s}<u32>`:`array<u32, ${s}>`,l=S(t,a),p=typeof l=="string"?l:l[1],d={indices:u,value:p,storage:typeof l=="string"?l:l[0],tensor:t},h=V=>typeof V=="string"?V:`${V}u`,f={offsetToIndices:!1,indicesToOffset:!1,broadcastedIndicesToOffset:!1,set:!1,setByIndices:!1,get:!1,getByIndices:!1},g=n?"uniforms.":"",w=`${g}${e}_shape`,$=`${g}${e}_strides`,_="";for(let V=0;V<s-1;V++)_+=`
    let dim${V} = current / ${D($,V,s)};
    let rest${V} = current % ${D($,V,s)};
    indices[${V}] = dim${V};
    current = rest${V};
    `;_+=`indices[${s-1}] = current;`;let y=s<2?"":`
  fn o2i_${e}(offset: u32) -> ${d.indices} {
    var indices: ${d.indices};
    var current = offset;
    ${_}
    return indices;
  }`,v=V=>(f.offsetToIndices=!0,s<2?V:`o2i_${e}(${V})`),x=[];if(s>=2)for(let V=s-1;V>=0;V--)x.push(`${D($,V,s)} * (indices[${V}])`);let I=s<2?"":`
  fn i2o_${e}(indices: ${d.indices}) -> u32 {
    return ${x.join("+")};
  }`,B=V=>(f.indicesToOffset=!0,s<2?V:`i2o_${e}(${V})`),R=(...V)=>s===0?"0u":`${d.indices}(${V.map(h).join(",")})`,N=(V,Z)=>s<2?`${V}`:`${D(V,Z,s)}`,G=(V,Z,me)=>s<2?`${V}=${me};`:`${D(V,Z,s)}=${me};`,H={},ve=(V,Z)=>{f.broadcastedIndicesToOffset=!0;let me=`${Z.name}broadcastedIndicesTo${e}Offset`;if(me in H)return`${me}(${V})`;let De=[];for(let Be=s-1;Be>=0;Be--){let aa=Z.indicesGet("outputIndices",Be+Z.rank-s);De.push(`${N($,Be)} * (${aa} % ${N(w,Be)})`)}return H[me]=`fn ${me}(outputIndices: ${Z.type.indices}) -> u32 {
             return ${De.length>0?De.join("+"):"0u"};
           }`,`${me}(${V})`},se=(V,Z)=>(()=>{if(d.storage===d.value)return`${e}[${V}]=${Z};`;if(d.storage==="vec2<u32>"&&d.value==="i32")return`${e}[${V}]=vec2<u32>(u32(${Z}), select(0u, 0xFFFFFFFFu, ${Z} < 0));`;if(d.storage==="vec2<u32>"&&d.value==="u32")return`${e}[${V}]=vec2<u32>(u32(${Z}), 0u);`;if(d.storage==="u32"&&d.value==="vec4<bool>")return`${e}[${V}]=dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(${Z}));`;throw new Error(`not supported combination of storage type ${d.storage} and value type ${d.value} yet`)})(),ce=V=>(()=>{if(d.storage===d.value)return`${e}[${V}]`;if(d.storage==="vec2<u32>"&&d.value==="i32")return`i32(${e}[${V}].x)`;if(d.storage==="vec2<u32>"&&d.value==="u32")return`u32(${e}[${V}].x)`;if(d.storage==="u32"&&d.value==="vec4<bool>")return`vec4<bool>(bool(${e}[${V}] & 0xFFu), bool(${e}[${V}] & 0xFF00u), bool(${e}[${V}] & 0xFF0000u), bool(${e}[${V}] & 0xFF000000u))`;throw new Error(`not supported combination of storage type ${d.storage} and value type ${d.value} yet`)})(),Me=s<2?"":`
  fn get_${e}ByIndices(indices: ${d.indices}) -> ${p} {
    return ${ce(`i2o_${e}(indices)`)};
  }`,W=s<2?"":`
  fn get_${e}(${o.map(V=>`d${V}: u32`).join(", ")}) -> ${p} {
    return get_${e}ByIndices(${R(o.map(V=>`d${V}`).join(", "))});
  }`,J=(...V)=>{if(V.length!==s)throw new Error(`indices length must be ${s}`);let Z=V.map(h).join(",");return s===0?ce("0u"):s===1?ce(Z[0]):(f.get=!0,f.getByIndices=!0,f.indicesToOffset=!0,`get_${e}(${Z})`)},Se=V=>s<2?ce(V):(f.getByIndices=!0,f.indicesToOffset=!0,`get_${e}ByIndices(${V})`),_e=s<2?"":`
  fn set_${e}ByIndices(indices: ${d.indices}, value: ${p}) {
    ${se(`i2o_${e}(indices)`,"value")}
  }`,fe=s<2?"":`
  fn set_${e}(${o.map(V=>`d${V}: u32`).join(", ")}, value: ${p}) {
    set_${e}ByIndices(${R(o.map(V=>`d${V}`).join(", "))}, value);
  }`;return{impl:()=>{let V=[],Z=!1;return f.offsetToIndices&&(V.push(y),Z=!0),f.indicesToOffset&&(V.push(I),Z=!0),f.broadcastedIndicesToOffset&&(Object.values(H).forEach(me=>V.push(me)),Z=!0),f.set&&(V.push(fe),Z=!0),f.setByIndices&&(V.push(_e),Z=!0),f.get&&(V.push(W),Z=!0),f.getByIndices&&(V.push(Me),Z=!0),!n&&Z&&V.unshift(`const ${w} = ${d.indices}(${r.join(",")});`,`const ${$} = ${d.indices}(${M.computeStrides(r).join(",")});`),V.join(`
`)},type:d,offsetToIndices:v,indicesToOffset:B,broadcastedIndicesToOffset:ve,indices:R,indicesGet:N,indicesSet:G,set:(...V)=>{if(V.length!==s+1)throw new Error(`indices length must be ${s}`);let Z=V[s];if(typeof Z!="string")throw new Error("value must be string");let me=V.slice(0,s).map(h).join(",");return s===0?se("0u",Z):s===1?se(me[0],Z):(f.set=!0,f.setByIndices=!0,f.indicesToOffset=!0,`set_${e}(${me}, ${Z})`)},setByOffset:se,setByIndices:(V,Z)=>s<2?se(V,Z):(f.setByIndices=!0,f.indicesToOffset=!0,`set_${e}ByIndices(${V}, ${Z});`),get:J,getByOffset:ce,getByIndices:Se,usage:i,name:e,strides:$,shape:w,rank:s}},C=(e,t,r,i=1)=>Y(e,t,r,"input",i),F=(e,t,r,i=1)=>Y(e,t,r,"output",i),Ve=(e,t,r)=>Y(e,t,r,"atomicOutput",1),re=(e,t,r,i=1)=>Y(e,t,r,"internal",i),Q=class{constructor(e,t){this.normalizedDispatchGroup=e,this.limits=t,this.internalVariables=[],this.variables=[],this.uniforms=[],this.variableIndex=0}guardAgainstOutOfBoundsWorkgroupSizes(e){return`if (global_idx >= ${typeof e=="number"?`${e}u`:e}) { return; }`}mainStart(e=T){let t=typeof e=="number"?e:e[0],r=typeof e=="number"?1:e[1],i=typeof e=="number"?1:e[2];if(t>this.limits.maxComputeWorkgroupSizeX||r>this.limits.maxComputeWorkgroupSizeY||i>this.limits.maxComputeWorkgroupSizeZ)throw new Error(`workgroup size [${t}, ${r}, ${i}] exceeds the maximum workgroup size [${this.limits.maxComputeWorkgroupSizeX}, ${this.limits.maxComputeWorkgroupSizeY}, ${this.limits.maxComputeWorkgroupSizeZ}].`);if(t*r*i>this.limits.maxComputeInvocationsPerWorkgroup)throw new Error(`workgroup size [${t}, ${r}, ${i}] exceeds the maximum workgroup invocations ${this.limits.maxComputeInvocationsPerWorkgroup}.`);let a=this.normalizedDispatchGroup[1]===1&&this.normalizedDispatchGroup[2]===1;return`@compute @workgroup_size(${t}, ${r}, ${i})
  fn main(${a?`@builtin(global_invocation_id) global_id : vec3<u32>,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(local_invocation_id) local_id : vec3<u32>`:`@builtin(global_invocation_id) global_id : vec3<u32>,
                                             @builtin(local_invocation_id) local_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(num_workgroups) num_workgroups : vec3<u32>`}) {
    ${a?`let global_idx = global_id.x;
         let workgroup_index = workgroup_id.x;`:`let workgroup_index = workgroup_id.z * num_workgroups[0] * num_workgroups[1] +
             workgroup_id.y * num_workgroups[0] + workgroup_id.x;
         let global_idx = workgroup_index * ${t*r*i}u + local_idx;`}
  `}appendVariableUniforms(e){e.rank!==0&&(e.shape.startsWith("uniforms.")&&this.uniforms.push({name:e.shape.replace("uniforms.",""),type:"u32",length:e.rank}),e.strides.startsWith("uniforms.")&&this.uniforms.push({name:e.strides.replace("uniforms.",""),type:"u32",length:e.rank}))}declareVariable(e,t){if(e.usage==="internal")throw new Error("cannot use internal variable with declareVariable(). use registerInternalVariables() instead.");this.variables.push(e),this.appendVariableUniforms(e);let r=e.usage==="input"?"read":"read_write",i=e.usage==="atomicOutput"?"atomic<i32>":e.type.storage;return`@group(0) @binding(${t}) var<storage, ${r}> ${e.name}: array<${i}>;`}declareVariables(...e){return e.map(t=>this.declareVariable(t,this.variableIndex++)).join(`
`)}registerInternalVariable(e){if(e.usage!=="internal")throw new Error("cannot use input or output variable with registerInternalVariable(). use declareVariables() instead.");this.internalVariables.push(e),this.appendVariableUniforms(e)}registerInternalVariables(...e){return e.forEach(t=>this.registerInternalVariable(t)),this}registerUniform(e,t,r=1){return this.uniforms.push({name:e,type:t,length:r}),this}registerUniforms(e){return this.uniforms=this.uniforms.concat(e),this}uniformDeclaration(){if(this.uniforms.length===0)return"";let e=[];for(let{name:t,type:r,length:i}of this.uniforms)if(i&&i>4)r==="f16"?e.push(`@align(16) ${t}:array<mat2x4<${r}>, ${Math.ceil(i/8)}>`):e.push(`${t}:array<vec4<${r}>, ${Math.ceil(i/4)}>`);else{let a=i==null||i===1?r:`vec${i}<${r}>`;e.push(`${t}:${a}`)}return`
      struct Uniforms { ${e.join(", ")} };
      @group(0) @binding(${this.variableIndex}) var<uniform> uniforms: Uniforms;`}get additionalImplementations(){return this.uniformDeclaration()+this.variables.map(e=>e.impl()).join(`
`)+this.internalVariables.map(e=>e.impl()).join(`
`)}get variablesInfo(){if(this.uniforms.length===0)return;let e=t=>[12,10,1,6][["u32","f16","f32","i32"].indexOf(t)];return this.uniforms.map(t=>[e(t.type),t.length??1])}},Oe=(e,t)=>new Q(e,t)}),Ye,Vt,er,tr,si,Wi,Fe,_t,Hi,we=k(()=>{"use strict";ue(),ne(),b(),j(),Ye=(e,t)=>{if(!e||e.length!==1)throw new Error("Transpose requires 1 input.");if(t.length!==0&&t.length!==e[0].dims.length)throw new Error(`perm size ${t.length} does not match input rank ${e[0].dims.length}`)},Vt=(e,t)=>t.length!==0?t:[...new Array(e).keys()].reverse(),er=(e,t)=>M.sortBasedOnPerm(e,Vt(e.length,t)),tr=(e,t,r,i)=>{let a=`fn perm(i: ${i.type.indices}) -> ${r.type.indices} {
    var a: ${r.type.indices};`;for(let n=0;n<t;++n)a+=`a[${e[n]}]=i[${n}];`;return a+="return a;}"},si=(e,t)=>{let r=[],i=[];for(let a=0;a<e.length;++a)e[a]!==1&&r.push(e[a]),e[t[a]]!==1&&i.push(t[a]);return{newShape:r,newPerm:i}},Wi=(e,t)=>{let r=0;for(let i=0;i<e.length;++i)if(t[e[i]]!==1){if(e[i]<r)return!1;r=e[i]}return!0},Fe=(e,t)=>{let r=e.dataType,i=e.dims.length,a=Vt(i,t),n=er(e.dims,a),s=e.dims,o=n,u=i<2||Wi(a,e.dims),l;if(u)return l=g=>{let w=C("input",r,s,4),$=F("output",r,o,4);return`
  ${g.registerUniform("output_size","u32").declareVariables(w,$)}
  ${g.mainStart()}
    ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    output[global_idx] = input[global_idx];
  }`},{name:"TransposeCopy",shaderCache:{inputDependencies:["type"]},getRunData:()=>{let g=M.size(n);return{outputs:[{dims:n,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(g/64/4)},programUniforms:[{type:12,data:Math.ceil(g/4)}]}},getShaderSource:l};let{newShape:p,newPerm:d}=si(e.dims,a),h=M.areEqual(d,[2,3,1]),f=M.areEqual(d,[3,1,2]);if(p.length===2||h||f){s=h?[p[0],p[1]*p[2]]:f?[p[0]*p[1],p[2]]:p,o=[s[1],s[0]];let g=16;return l=w=>{let $=C("a",r,s.length),_=F("output",r,o.length);return`
  ${w.registerUniform("output_size","u32").declareVariables($,_)}
  var<workgroup> tile : array<array<${_.type.value}, 17>, ${g}>;
  ${w.mainStart([g,g,1])}
    let stride = (uniforms.output_shape[1] - 1) / ${g} + 1;
    let workgroup_id_x = workgroup_index % stride;
    let workgroup_id_y = workgroup_index / stride;
    let input_col = workgroup_id_y * ${g}u + local_id.x;
    let input_row = workgroup_id_x * ${g}u + local_id.y;
    if (input_row < uniforms.a_shape[0] && input_col < uniforms.a_shape[1]) {
      tile[local_id.y][local_id.x] = ${$.getByIndices(`${$.type.indices}(input_row, input_col)`)};
    }
    workgroupBarrier();

    let output_col = workgroup_id_x * ${g}u + local_id.x;
    let output_row = workgroup_id_y * ${g}u + local_id.y;
    if (output_row < uniforms.output_shape[0] && output_col < uniforms.output_shape[1]) {
      ${_.setByIndices(`${_.type.indices}(output_row, output_col)`,"tile[local_id.x][local_id.y]")}
    }
  }`},{name:"TransposeShared",shaderCache:{inputDependencies:["type"]},getRunData:()=>{let w=M.size(n);return{outputs:[{dims:n,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(o[1]/g),y:Math.ceil(o[0]/g)},programUniforms:[{type:12,data:w},...E(s,o)]}},getShaderSource:l}}return l=g=>{let w=C("a",r,s.length),$=F("output",r,o.length);return`
  ${g.registerUniform("output_size","u32").declareVariables(w,$)}

  ${tr(a,i,w,$)}

  ${g.mainStart()}
    ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${$.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${$.setByOffset("global_idx",w.getByIndices("aIndices"))}
  }`},{name:"Transpose",shaderCache:{hint:`${t}`,inputDependencies:["rank"]},getRunData:()=>{let g=M.size(n);return{outputs:[{dims:n,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(g/64)},programUniforms:[{type:12,data:g},...E(s,o)]}},getShaderSource:l}},_t=(e,t)=>{Ye(e.inputs,t.perm),e.compute(Fe(e.inputs[0],t.perm))},Hi=e=>m({perm:e.perm})}),wt,da,zt,Br,Ze,ut,oi,Mr,ji,pa,Je,Ct,rr,qe,rt,bt,ca,ha,Wn,Hn,jn,Bp=k(()=>{"use strict";ue(),ne(),j(),Va(),we(),wt={max:"select(bestValue, candidate, candidate > bestValue)",min:"select(bestValue, candidate, candidate < bestValue)",mean:"bestValue + candidate",sum:"bestValue + candidate",prod:"bestValue * candidate",sumSquare:"bestValue + candidate * candidate",logSumExp:"bestValue + exp(candidate)",l1:"bestValue + abs(candidate)",l2:"bestValue + candidate * candidate",logSum:"bestValue + candidate"},da={max:"select(bestValue, candidate, candidate > bestValue)",min:"select(bestValue, candidate, candidate < bestValue)",mean:"bestValue + candidate",sum:"bestValue + candidate",prod:"bestValue * candidate",sumSquare:"bestValue + candidate",logSumExp:"bestValue + candidate",l1:"bestValue + candidate",l2:"bestValue + candidate",logSum:"bestValue + candidate"},zt={max:"_A[offset]",min:"_A[offset]",mean:"0",sum:"0",prod:"1",sumSquare:"0",logSumExp:"0",l1:"0",l2:"0",logSum:"0"},Br={max:"bestValue",min:"bestValue",sum:"bestValue",prod:"bestValue",sumSquare:"bestValue",logSumExp:"log(bestValue)",l1:"bestValue",l2:"sqrt(bestValue)",logSum:"log(bestValue)"},Ze=(e,t)=>{let r=[];for(let i=t-e;i<t;++i)r.push(i);return r},ut=(e,t)=>{let r=[],i=e.length;for(let a=0;a<i;a++)t.indexOf(a)===-1&&r.push(e[a]);return[r,t.map(a=>e[a])]},oi=(e,t)=>{let r=e.length+t.length,i=[],a=0;for(let n=0;n<r;n++)t.indexOf(n)===-1?i.push(e[a++]):i.push(1);return i},Mr=(e,t)=>{for(let r=0;r<e.length;++r)if(e[e.length-r-1]!==t-1-r)return!1;return!0},ji=(e,t)=>{let r=[];if(!Mr(e,t)){for(let i=0;i<t;++i)e.indexOf(i)===-1&&r.push(i);e.forEach(i=>r.push(i))}return r},pa=(e,t,r,i,a,n,s)=>{let o=r[0].dims,u=M.size(n),l=M.size(s),p=C("_A",r[0].dataType,o),d=F("output",a,n),h=64;u===1&&(h=256);let f=`
          var<workgroup> aBestValues : array<f32, ${h}>;
       `,g=w=>`
        ${w.registerUniform("reduceSize","u32").declareVariables(p,d)}
        ${f}
        fn DIV_CEIL(a : u32, b : u32) -> u32 {
          return ((a - 1u) / b + 1u);
         }
         ${w.mainStart(h)}

          let outputIndex = global_idx / ${h};
          let offset = outputIndex * uniforms.reduceSize;

          var bestValue = f32(${zt[i]});
          let Length = uniforms.reduceSize;
          for (var k = local_idx; k < Length; k = k + ${h}) {
           let candidate = f32(${p.getByOffset("offset + k")});
           bestValue = ${wt[i]};
          }
          aBestValues[local_idx] = bestValue;
          workgroupBarrier();

         var reduceSize = min(Length, ${h}u);
         for (var currentSize = reduceSize / 2u; reduceSize > 1u;
             currentSize = reduceSize / 2u) {
           let interval = DIV_CEIL(reduceSize, 2u);
           if (local_idx < currentSize) {
            let candidate = aBestValues[local_idx + interval];
            bestValue = ${da[i]};
            aBestValues[local_idx] = bestValue;
           }
           reduceSize = interval;
           workgroupBarrier();
         }

         if (local_idx == 0u) {
          ${d.setByOffset("outputIndex",`${i==="mean"?`${d.type.storage}(bestValue / f32(uniforms.reduceSize))`:`${d.type.storage}(${Br[i]})`}`)};
         }
        }`;return{name:e,shaderCache:{hint:`${t};${h}`,inputDependencies:["type"]},getShaderSource:g,getRunData:()=>({outputs:[{dims:n,dataType:a}],dispatchGroup:{x:u},programUniforms:[{type:12,data:l}]})}},Je=(e,t,r,i)=>{let a=e.inputs.length===1?r:La(e.inputs,r),n=a.axes;n.length===0&&!a.noopWithEmptyAxes&&(n=e.inputs[0].dims.map((f,g)=>g));let s=M.normalizeAxes(n,e.inputs[0].dims.length),o=s,u=e.inputs[0],l=ji(o,e.inputs[0].dims.length);l.length>0&&(u=e.compute(Fe(e.inputs[0],l),{inputs:[0],outputs:[-1]})[0],o=Ze(o.length,u.dims.length));let[p,d]=ut(u.dims,o),h=p;a.keepDims&&(h=oi(p,s)),e.compute(pa(t,a.cacheKey,[u],i,e.inputs[0].dataType,h,d),{inputs:[u]})},Ct=(e,t)=>{Je(e,"ReduceMeanShared",t,"mean")},rr=(e,t)=>{Je(e,"ReduceL1Shared",t,"l1")},qe=(e,t)=>{Je(e,"ReduceL2Shared",t,"l2")},rt=(e,t)=>{Je(e,"ReduceLogSumExpShared",t,"logSumExp")},bt=(e,t)=>{Je(e,"ReduceMaxShared",t,"max")},ca=(e,t)=>{Je(e,"ReduceMinShared",t,"min")},ha=(e,t)=>{Je(e,"ReduceProdShared",t,"prod")},Wn=(e,t)=>{Je(e,"ReduceSumShared",t,"sum")},Hn=(e,t)=>{Je(e,"ReduceSumSquareShared",t,"sumSquare")},jn=(e,t)=>{Je(e,"ReduceLogSumShared",t,"logSum")}}),At,Kn,fa,La,Ot,Zn,Qn,Xn,Yn,Jn,es,ts,rs,is,as,Rt,ns,ss,os,us,ls,ds,ps,cs,hs,fs,Va=k(()=>{"use strict";ue(),ne(),b(),j(),Bp(),At=e=>{if(!e||e.length===0||e.length>2)throw new Error("Reduce op requires 1 or 2 inputs.");if(e.length===2&&e[1].dims.length!==1)throw new Error("Invalid axes input dims.")},Kn=e=>["","",`var value = ${e.getByIndices("input_indices")};`,""],fa=(e,t,r,i,a,n,s=!1,o=!1)=>{let u=[],l=r[0].dims,p=l.length,d=M.normalizeAxes(a,p),h=!o&&d.length===0;l.forEach((w,$)=>{h||d.indexOf($)>=0?s&&u.push(1):u.push(w)});let f=u.length,g=M.size(u);return{name:e,shaderCache:t,getShaderSource:w=>{let $=[],_=C("_A",r[0].dataType,p),y=F("output",n,f),v=i(_,y,d),x=v[2];for(let I=0,B=0;I<p;I++)h||d.indexOf(I)>=0?(s&&B++,x=`for(var j${I}: u32 = 0; j${I} < ${l[I]}; j${I}++) {
                  ${v[2].includes("last_index")?`let last_index = j${I};`:""}
                  ${_.indicesSet("input_indices",I,`j${I}`)}
                  ${x}
                }`):($.push(`${_.indicesSet("input_indices",I,y.indicesGet("output_indices",B))};`),B++);return`

        ${w.registerUniform("output_size","u32").declareVariables(_,y)}

        ${w.mainStart()}
          ${w.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          var input_indices: ${_.type.indices};
          let output_indices = ${y.offsetToIndices("global_idx")};

          ${$.join(`
`)}
          ${v[0]}       // init ops for reduce max/min
          ${v[1]}
          ${x}
          ${v[3]}
          ${v.length===4?y.setByOffset("global_idx","value"):v.slice(4).join(`
`)}
        }`},getRunData:()=>({outputs:[{dims:u,dataType:n}],dispatchGroup:{x:Math.ceil(g/64)},programUniforms:[{type:12,data:g},...E(l,u)]})}},La=(e,t)=>{let r=[];return e[1].dims[0]>0&&e[1].getBigInt64Array().forEach(i=>r.push(Number(i))),m({axes:r,keepDims:t.keepDims,noopWithEmptyAxes:t.noopWithEmptyAxes})},Ot=(e,t,r,i)=>{let a=e.inputs,n=a.length===1?r:La(a,r);e.compute(fa(t,{hint:n.cacheKey,inputDependencies:["rank"]},[a[0]],n.noopWithEmptyAxes&&n.axes.length===0?Kn:i,n.axes,a[0].dataType,n.keepDims,n.noopWithEmptyAxes),{inputs:[0]})},Zn=(e,t)=>{At(e.inputs),Ot(e,"ReduceLogSum",t,(r,i)=>[`var value = ${i.type.storage}(0);`,"",`value += ${r.getByIndices("input_indices")};`,"value = log(value);"])},Qn=(e,t)=>{At(e.inputs),Ot(e,"ReduceL1",t,(r,i)=>[`var value = ${i.type.storage}(0);`,"",`value += abs(${r.getByIndices("input_indices")});`,""])},Xn=(e,t)=>{At(e.inputs),Ot(e,"ReduceL2",t,(r,i)=>[`var t = ${i.type.value}(0); var value = ${i.type.value}(0);`,"",`t = ${r.getByIndices("input_indices")}; value += (t * t);`,"value = sqrt(value);"])},Yn=(e,t)=>{At(e.inputs),Ot(e,"ReduceLogSumExp",t,(r,i)=>[`var value = ${i.type.storage}(0);`,"",`value += exp(${r.getByIndices("input_indices")});`,"value = log(value);"])},Jn=(e,t)=>{At(e.inputs),Ot(e,"ReduceMax",t,(r,i,a)=>{let n=[];for(let s=0;s<r.rank;s++)(a.indexOf(s)>=0||a.length===0)&&n.push(r.indicesSet("input_indices",s,0));return[`${n.join(`
`)}`,`var value = ${r.getByIndices("input_indices")};`,`value = max(value, ${r.getByIndices("input_indices")});`,""]})},es=(e,t)=>{At(e.inputs),Ot(e,"ReduceMean",t,(r,i,a)=>{let n=1;for(let s=0;s<r.rank;s++)(a.indexOf(s)>=0||a.length===0)&&(n*=e.inputs[0].dims[s]);return["var sum = f32(0);","",`sum += f32(${r.getByIndices("input_indices")});`,`let value = ${i.type.value}(sum / ${n});`]})},ts=(e,t)=>{At(e.inputs),Ot(e,"ReduceMin",t,(r,i,a)=>{let n=[];for(let s=0;s<r.rank;s++)(a.indexOf(s)>=0||a.length===0)&&n.push(`input_indices[${s}] = 0;`);return[`${n.join(`
`)}`,`var value = ${r.getByIndices("input_indices")};`,`value = min(value, ${r.getByIndices("input_indices")});`,""]})},rs=(e,t)=>{At(e.inputs),Ot(e,"ReduceProd",t,(r,i)=>[`var value = ${i.type.storage}(1);`,"",`value *= ${r.getByIndices("input_indices")};`,""])},is=(e,t)=>{At(e.inputs),Ot(e,"ReduceSum",t,(r,i)=>[`var value = ${i.type.storage}(0);`,"",`value += ${r.getByIndices("input_indices")};`,""])},as=(e,t)=>{At(e.inputs),Ot(e,"ReduceSumSquare",t,(r,i)=>[`var t = ${i.type.value}(0); var value = ${i.type.value}(0);`,"",`t = ${r.getByIndices("input_indices")}; value += t * t;`,""])},Rt=(e,t,r)=>{if(t.length===0)return r;let i=1,a=1;for(let n=0;n<t.length;n++)t.indexOf(n)===-1?i*=e[n]:a*=e[n];return a<32&&i>1024},ns=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?es(e,t):Ct(e,t)},ss=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Qn(e,t):rr(e,t)},os=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Xn(e,t):qe(e,t)},us=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Yn(e,t):rt(e,t)},ls=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Jn(e,t):bt(e,t)},ds=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?ts(e,t):ca(e,t)},ps=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?rs(e,t):ha(e,t)},cs=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?is(e,t):Wn(e,t)},hs=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?as(e,t):Hn(e,t)},fs=(e,t)=>{Rt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Zn(e,t):jn(e,t)}}),qa,ms,gs,Fa,Mp=k(()=>{"use strict";ue(),b(),Va(),qa=e=>{if(!e||e.length===0||e.length>2)throw new Error("ArgMinMaxOp op requires 1 or 2 inputs.");if(e[0].dataType!==1)throw new Error("Invalid input type.")},ms=(e,t)=>{qa(e.inputs);let r=(i,a,n)=>{let s=[];for(let o=0;o<i.rank;o++)(n.indexOf(o)>=0||n.length===0)&&s.push(`input_indices[${o}] = 0;`);return[`${s.join(`
`)}`,`var value = ${i.getByIndices("input_indices")};
var best_index : i32 = 0;`,`if (${i.getByIndices("input_indices")} ${t.selectLastIndex>0?"<=":"<"} value) {
         value = ${i.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`,"",a.setByOffset("global_idx","best_index")]};e.compute(fa("ArgMin",{hint:t.cacheKey,inputDependencies:["rank"]},[e.inputs[0]],r,[t.axis],7,t.keepDims),{inputs:[0]})},gs=(e,t)=>{qa(e.inputs);let r=(i,a,n)=>{let s=[];for(let o=0;o<i.rank;o++)(n.indexOf(o)>=0||n.length===0)&&s.push(`input_indices[${o}] = 0;`);return[`${s.join(`
`)}`,`var value = ${i.getByIndices("input_indices")};
var best_index : i32 = 0;`,`if (${i.getByIndices("input_indices")} ${t.selectLastIndex>0?">=":">"} value) {
         value = ${i.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`,"",a.setByOffset("global_idx","best_index")]};e.compute(fa("argMax",{hint:t.cacheKey,inputDependencies:["rank"]},[e.inputs[0]],r,[t.axis],7,t.keepDims),{inputs:[0]})},Fa=e=>m(e)}),ys,ma,ws,_s,bs,Ki,$s,vs,Ga=k(()=>{"use strict";ue(),ne(),ei(),j(),ys=(e,t)=>{let r=e[0],i=e[1],a=e[2],n=e[3],s=e[4],o=e[5];if(s&&o)throw new Error("Attention cannot have both past and attention_bias");if(r.dims.length!==3)throw new Error('Input "input" must have 3 dimensions');let u=r.dims[0],l=r.dims[1],p=r.dims[2];if(a.dims.length!==1)throw new Error('Input "bias" is expected to have 1 dimensions');if(i.dims.length!==2)throw new Error('Input "weights" is expected to have 2 dimensions');if(i.dims[0]!==p)throw new Error("Input 1 dimension 0 should have same length as dimension 2 of input 0");if(a.dims[0]!==i.dims[1])throw new Error('Input "bias" dimension 0 should have same length as dimension 1 of input "weights"');let d=a.dims[0]/3,h=d,f=h;if(t.qkvHiddenSizes.length>0){if(t.qkvHiddenSizes.length!==3)throw new Error("qkv_hidden_sizes attribute should have 3 elements");for(let v of t.qkvHiddenSizes)if(v%t.numHeads!==0)throw new Error("qkv_hidden_sizes should be divisible by num_heads");d=t.qkvHiddenSizes[0],h=t.qkvHiddenSizes[1],f=t.qkvHiddenSizes[2]}let g=l;if(d!==h)throw new Error("qkv_hidden_sizes first element should be same as the second");if(a.dims[0]!==d+h+f)throw new Error('Input "bias" dimension 0 should have same length as sum of Q/K/V hidden sizes');let w=0;if(s){if(h!==f)throw new Error('Input "past" expect k_hidden_size == v_hidden_size');if(s.dims.length!==5)throw new Error('Input "past" must have 5 dimensions');if(s.dims[0]!==2)throw new Error('Input "past" first dimension must be 2');if(s.dims[1]!==u)throw new Error('Input "past" second dimension must be batch_size');if(s.dims[2]!==t.numHeads)throw new Error('Input "past" third dimension must be num_heads');if(s.dims[4]!==h/t.numHeads)throw new Error('Input "past" fifth dimension must be k_hidden_size / num_heads');t.pastPresentShareBuffer||(w=s.dims[3])}let $=g+w,_=-1,y=0;if(n)throw new Error("Mask not supported");if(s)throw new Error("past is not supported");if(o){if(o.dims.length!==4)throw new Error('Input "attention_bias" must have 4 dimensions');if(o.dims[0]!==u||o.dims[1]!==t.numHeads||o.dims[2]!==l||o.dims[3]!==$)throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)')}return{batchSize:u,sequenceLength:l,pastSequenceLength:w,kvSequenceLength:g,totalSequenceLength:$,maxSequenceLength:_,inputHiddenSize:p,hiddenSize:d,vHiddenSize:f,headSize:Math.floor(d/t.numHeads),vHeadSize:Math.floor(f/t.numHeads),numHeads:t.numHeads,isUnidirectional:!1,pastPresentShareBuffer:!1,maskFilterValue:t.maskFilterValue,maskType:y,scale:t.scale,broadcastResPosBias:!1,passPastInKv:!1,qkvFormat:1}},ma=(e,t,r)=>t&&e?`
      let total_sequence_length_input = u32(${t.getByOffset("0")});
      let present_sequence_length = max(total_sequence_length_input, uniforms.past_sequence_length);
      let is_subsequent_prompt: bool = sequence_length > 1 && sequence_length != total_sequence_length_input;
      let is_first_prompt: bool = is_subsequent_prompt == false && sequence_length == total_sequence_length_input;
      total_sequence_length = u32(${e?.getByOffset("batchIdx")}) + 1;
      var past_sequence_length: u32 = 0;
      if (is_first_prompt == false) {
        past_sequence_length = total_sequence_length - sequence_length;
      }
       `:`
    ${r?"let past_sequence_length = uniforms.past_sequence_length":""};
    let present_sequence_length = total_sequence_length;
    `,ws=(e,t,r,i,a,n,s,o)=>{let u=A(s?1:n),l=64,p=n/u;p<l&&(l=32);let d=Math.ceil(n/u/l),h=[{type:12,data:t},{type:12,data:r},{type:12,data:i},{type:12,data:a},{type:12,data:p},{type:12,data:d}],f=O(e.dataType,u),g=z(1,u),w=["type"];s&&w.push("type"),o&&w.push("type");let $=_=>{let y=F("x",e.dataType,e.dims,u),v=[y],x=s?C("seq_lens",s.dataType,s.dims):void 0;x&&v.push(x);let I=o?C("total_sequence_length_input",o.dataType,o.dims):void 0;I&&v.push(I);let B=z(e.dataType);return`
  var<workgroup> thread_max: array<f32, ${l}>;
  var<workgroup> thread_sum: array<f32, ${l}>;
  ${_.registerUniforms([{name:"batch_size",type:"u32"},{name:"num_heads",type:"u32"},{name:"past_sequence_length",type:"u32"},{name:"sequence_length",type:"u32"},{name:"total_sequence_length",type:"u32"},{name:"elements_per_thread",type:"u32"}]).declareVariables(...v)}
  ${_.mainStart([l,1,1])}
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let sequence_length = uniforms.sequence_length;
    var total_sequence_length = uniforms.total_sequence_length;
    ${ma(x,I,!1)}
    let local_offset = local_idx * uniforms.elements_per_thread;
    let offset = (global_idx / ${l}) * uniforms.total_sequence_length + local_offset;
    let seq_causal_length = ${s?"u32(past_sequence_length + workgroup_id.y + 1)":"total_sequence_length"};
    var thread_max_vector = ${g}(-3.4028234663852886e+38f);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      thread_max_vector = max(${g}(x[offset + i]), thread_max_vector);
    }
    thread_max[local_idx] = ${(()=>{switch(u){case 1:return"thread_max_vector";case 2:return"max(thread_max_vector.x, thread_max_vector.y)";case 4:return"max(max(thread_max_vector.x, thread_max_vector.y), max(thread_max_vector.z, thread_max_vector.w))";default:throw new Error(`Unsupported components: ${u}`)}})()};
    workgroupBarrier();

    var max_value =  f32(-3.4028234663852886e+38f);
    for (var i = 0u; i < ${l}; i++) {
      max_value = max(thread_max[i], max_value);
    }

    var sum_vector = ${g}(0);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      sum_vector += exp(${g}(x[offset + i]) - max_value);
    }
    thread_sum[local_idx] = ${(()=>{switch(u){case 1:return"sum_vector";case 2:return"sum_vector.x + sum_vector.y";case 4:return"sum_vector.x + sum_vector.y + sum_vector.z + sum_vector.w";default:throw new Error(`Unsupported components: ${u}`)}})()};
    workgroupBarrier();

    var sum: f32 = 0;
    for (var i = 0u; i < ${l}; i++) {
      sum += thread_sum[i];
    }

    if (sum == 0) {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        x[offset + i] = ${y.type.value}(${B}(1.0) / ${B}(seq_causal_length));
      }
    } else {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        var f32input = ${g}(x[offset + i]);
        x[offset + i] = ${y.type.value}(exp(f32input - max_value) / sum);
      }
    }
      ${s?`
        for (var total_seq_id: u32 = seq_causal_length; total_seq_id + local_offset < uniforms.total_sequence_length; total_seq_id++) {
          x[offset + total_seq_id] = ${y.type.value}(${B}(0));
        }`:""};
  }`};return{name:"AttentionProbsSoftmax",shaderCache:{hint:`${l};${f};${u}`,inputDependencies:w},getShaderSource:$,getRunData:()=>({outputs:[],dispatchGroup:{x:1,y:a,z:t*r},programUniforms:h})}},_s=(e,t,r,i,a,n,s,o,u)=>{let l=s+n.kvSequenceLength,p=[n.batchSize,n.numHeads,n.sequenceLength,l],d=e>1&&i,h=n.kvNumHeads?n.kvNumHeads:n.numHeads,f=d?[n.batchSize,h,l,n.headSize]:void 0,g=n.nReps?n.nReps:1,w=n.scale===0?1/Math.sqrt(n.headSize):n.scale,$=A(n.headSize),_=n.headSize/$,y=12,v={x:Math.ceil(l/y),y:Math.ceil(n.sequenceLength/y),z:n.batchSize*n.numHeads},x=[{type:12,data:n.sequenceLength},{type:12,data:_},{type:12,data:l},{type:12,data:n.numHeads},{type:12,data:n.headSize},{type:1,data:w},{type:12,data:s},{type:12,data:n.kvSequenceLength},{type:12,data:g}],I=d&&i&&M.size(i.dims)>0,B=["type","type"];I&&B.push("type"),a&&B.push("type"),o&&B.push("type"),u&&B.push("type");let R=[{dims:p,dataType:t.dataType,gpuDataType:0}];d&&R.push({dims:f,dataType:t.dataType,gpuDataType:0});let N=G=>{let H=C("q",t.dataType,t.dims,$),ve=[H,C("key",r.dataType,r.dims,$)];if(I){let Se=C("past_key",i.dataType,i.dims,$);ve.push(Se)}a&&ve.push(C("attention_bias",a.dataType,a.dims));let se=o?C("seq_lens",o.dataType,o.dims):void 0;se&&ve.push(se);let ce=u?C("total_sequence_length_input",u.dataType,u.dims):void 0;ce&&ve.push(ce);let Me=F("output",t.dataType,p),W=[Me];d&&W.push(F("present_key",t.dataType,f,$));let J=z(1,$);return`
  const TILE_SIZE = ${y}u;

  var<workgroup> tileQ: array<${H.type.storage}, ${y*y}>;
  var<workgroup> tileK: array<${H.type.storage}, ${y*y}>;
  ${G.registerUniforms([{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"alpha",type:"f32"},{name:"past_sequence_length",type:"u32"},{name:"kv_sequence_length",type:"u32"},{name:"n_reps",type:"u32"}]).declareVariables(...ve,...W)}
  ${G.mainStart([y,y,1])}
    // x holds the N and y holds the M
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let kvHeadIdx = ${g===1?"headIdx":"headIdx / uniforms.n_reps"};
    let kv_num_heads = ${g===1?"uniforms.num_heads":"uniforms.num_heads / uniforms.n_reps"};
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let m = workgroup_id.y * TILE_SIZE;
    let n = workgroup_id.x * TILE_SIZE;
    let sequence_length = uniforms.M;
    var total_sequence_length = uniforms.N;
    ${ma(se,ce,!0)}
    let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx;
    let qOffset = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
    ${I&&d?"let pastKeyOffset = absKvHeadIdx * uniforms.past_sequence_length * uniforms.K;":""};
    let kOffset = absKvHeadIdx * uniforms.kv_sequence_length * uniforms.K;
    ${d?"let presentKeyOffset = absKvHeadIdx * uniforms.N * uniforms.K;":""}
    var value = ${J}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (global_id.y < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = q[qOffset + local_id.y * uniforms.K + w + local_id.x];
      }
      if (n + local_id.y < uniforms.N && w + local_id.x < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
      ${I&&d?`
              if (n + local_id.y < past_sequence_length) {
                tileK[idx] = past_key[pastKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
              } else if (n + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
                tileK[idx] = key[kOffset + (n + local_id.y - past_sequence_length) * uniforms.K + w + local_id.x];
              }`:`
          if (n + local_id.y < uniforms.kv_sequence_length) {
            tileK[idx] = key[kOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
          }`}
      ${d?`if (n + local_id.y < present_sequence_length) {
        present_key[presentKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x] = tileK[idx];
      }`:""}
      }
      workgroupBarrier();

      for (var k: u32 = 0u; k < TILE_SIZE && w+k < uniforms.K; k++) {
          value += ${J}(tileQ[TILE_SIZE * local_id.y + k] * tileK[TILE_SIZE * local_id.x + k]);
      }

      workgroupBarrier();
    }

    if (global_id.y < uniforms.M && global_id.x < total_sequence_length) {
      let headOffset = workgroup_id.z * uniforms.M * uniforms.N;
      let outputIdx = headOffset + global_id.y * uniforms.N + global_id.x;
      var sum: f32 = ${(()=>{switch($){case 1:return"value";case 2:return"value.x + value.y";case 4:return"value.x + value.y + value.z + value.w";default:throw new Error(`Unsupported components: ${$}`)}})()};
        output[outputIdx] = ${Me.type.value} (sum * uniforms.alpha) + ${a?"attention_bias[outputIdx]":"0.0"};
    }
  }`};return{name:"AttentionProbs",shaderCache:{hint:`${$};${a!==void 0};${i!==void 0};${e}`,inputDependencies:B},getRunData:()=>({outputs:R,dispatchGroup:v,programUniforms:x}),getShaderSource:N}},bs=(e,t,r,i,a,n,s=void 0,o=void 0)=>{let u=n+a.kvSequenceLength,l=a.nReps?a.nReps:1,p=a.vHiddenSize*l,d=e>1&&i,h=a.kvNumHeads?a.kvNumHeads:a.numHeads,f=d?[a.batchSize,h,u,a.headSize]:void 0,g=[a.batchSize,a.sequenceLength,p],w=12,$={x:Math.ceil(a.vHeadSize/w),y:Math.ceil(a.sequenceLength/w),z:a.batchSize*a.numHeads},_=[{type:12,data:a.sequenceLength},{type:12,data:u},{type:12,data:a.vHeadSize},{type:12,data:a.numHeads},{type:12,data:a.headSize},{type:12,data:p},{type:12,data:n},{type:12,data:a.kvSequenceLength},{type:12,data:l}],y=d&&i&&M.size(i.dims)>0,v=["type","type"];y&&v.push("type"),s&&v.push("type"),o&&v.push("type");let x=[{dims:g,dataType:t.dataType,gpuDataType:0}];d&&x.push({dims:f,dataType:t.dataType,gpuDataType:0});let I=B=>{let R=C("probs",t.dataType,t.dims),N=[R,C("v",r.dataType,r.dims)];y&&N.push(C("past_value",i.dataType,i.dims));let G=s?C("seq_lens",s.dataType,s.dims):void 0;s&&N.push(G);let H=o?C("total_sequence_length_input",o.dataType,o.dims):void 0;o&&N.push(H);let ve=[F("output",t.dataType,g)];return d&&ve.push(F("present_value",t.dataType,f)),`
  const TILE_SIZE = ${w}u;
  var<workgroup> tileQ: array<${R.type.value}, ${w*w}>;
  var<workgroup> tileV: array<${R.type.value}, ${w*w}>;
  ${B.registerUniforms([{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"v_hidden_size",type:"u32"},{name:"past_sequence_length",type:"u32"},{name:"kv_sequence_length",type:"u32"},{name:"n_reps",type:"u32"}]).declareVariables(...N,...ve)}
  ${B.mainStart([w,w,1])}
   let headIdx = workgroup_id.z % uniforms.num_heads;
   let batchIdx = workgroup_id.z / uniforms.num_heads;
   let kvHeadIdx = ${l===1?"headIdx":"headIdx / uniforms.n_reps"};
   let kv_num_heads = ${l===1?"uniforms.num_heads":"uniforms.num_heads / uniforms.n_reps"};
   let m = global_id.y;
   let n = global_id.x;
   let sequence_length = uniforms.M;
   var total_sequence_length = uniforms.K;
   ${ma(G,H,!0)}
   let offsetA = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
   let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx; // kvHeadIdx is relative to the batch
   ${y&&d?"let pastValueOffset = absKvHeadIdx * uniforms.N * uniforms.past_sequence_length + n;":""};
   let vOffset = absKvHeadIdx * uniforms.N * uniforms.kv_sequence_length + n;
   ${d?"let presentValueOffset = absKvHeadIdx * uniforms.N * uniforms.K + n;":""}
   var value = ${R.type.storage}(0);
   for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = probs[offsetA + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
        ${y&&d?`
        if (w + local_id.y < past_sequence_length) {
          tileV[idx] = past_value[pastValueOffset + (w + local_id.y) * uniforms.N];
        } else if (w + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
          tileV[idx] = v[vOffset + (w + local_id.y - past_sequence_length) * uniforms.N];
        }
      `:`
            if (w + local_id.y < uniforms.kv_sequence_length) {
              tileV[idx] = v[vOffset + (w + local_id.y) * uniforms.N];
            }`}
        ${d?`
            if (w + local_id.y < present_sequence_length) {
          present_value[presentValueOffset + (w + local_id.y) * uniforms.N] = tileV[idx];
        }`:""}
      }
     workgroupBarrier();
     for (var k: u32 = 0u; k < TILE_SIZE && w+k < total_sequence_length; k++) {
       value += tileQ[TILE_SIZE * local_id.y + k] * tileV[TILE_SIZE * k + local_id.x];
     }
     workgroupBarrier();
   }

   // we need to transpose output from BNSH_v to BSND_v
   if (m < uniforms.M && n < uniforms.N) {
     let outputIdx = batchIdx * uniforms.M * uniforms.v_hidden_size + m * uniforms.v_hidden_size
       + headIdx * uniforms.N + n;
     output[outputIdx] = value;
   }
  }`};return{name:"AttentionScore",shaderCache:{hint:`${i!==void 0};${e}`,inputDependencies:v},getRunData:()=>({outputs:x,dispatchGroup:$,programUniforms:_}),getShaderSource:I}},Ki=(e,t,r,i,a,n,s,o,u,l,p=void 0,d=void 0)=>{let h=Math.min(e.outputCount,1+(s?1:0)+(o?1:0)),f=h>1?l.pastSequenceLength:0,g=f+l.kvSequenceLength,w=u&&M.size(u.dims)>0?u:void 0,$=[t,r];h>1&&s&&M.size(s.dims)>0&&$.push(s),w&&$.push(w),p&&$.push(p),d&&$.push(d);let _=e.compute(_s(h,t,r,s,w,l,f,p,d),{inputs:$,outputs:h>1?[-1,1]:[-1]})[0];e.compute(ws(_,l.batchSize,l.numHeads,f,l.sequenceLength,g,p,d),{inputs:p&&d?[_,p,d]:[_],outputs:[]});let y=[_,i];h>1&&o&&M.size(o.dims)>0&&y.push(o),p&&y.push(p),d&&y.push(d),e.compute(bs(h,_,i,o,l,f,p,d),{inputs:y,outputs:h>1?[0,2]:[0]})},$s=(e,t)=>{let r=[t.batchSize,t.numHeads,t.sequenceLength,t.headSize],i=t.sequenceLength,a=t.inputHiddenSize,n=t.headSize,s=12,o={x:Math.ceil(t.headSize/s),y:Math.ceil(t.sequenceLength/s),z:t.batchSize*t.numHeads},u=[e.inputs[0],e.inputs[1],e.inputs[2]],l=[{type:12,data:i},{type:12,data:a},{type:12,data:n},{type:12,data:t.numHeads},{type:12,data:t.headSize},{type:12,data:t.hiddenSize},{type:12,data:t.hiddenSize+t.hiddenSize+t.vHiddenSize}],p=d=>{let h=F("output_q",u[0].dataType,r),f=F("output_k",u[0].dataType,r),g=F("output_v",u[0].dataType,r),w=C("input",u[0].dataType,u[0].dims),$=C("weight",u[1].dataType,u[1].dims),_=C("bias",u[2].dataType,u[2].dims),y=w.type.storage;return`
  const TILE_SIZE = ${s}u;
  var<workgroup> tileInput: array<${y}, ${s*s}>;
  var<workgroup> tileWeightQ: array<${y}, ${s*s}>;
  var<workgroup> tileWeightK: array<${y}, ${s*s}>;
  var<workgroup> tileWeightV: array<${y}, ${s*s}>;
  ${d.registerUniforms([{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"hidden_size",type:"u32"},{name:"ldb",type:"u32"}]).declareVariables(w,$,_,h,f,g)}
  ${d.mainStart([s,s,1])}
    let batchIndex = workgroup_id.z / uniforms.num_heads;
    let headNumber = workgroup_id.z % uniforms.num_heads;
    let m = global_id.y;
    let n = global_id.x;

    let inputOffset = batchIndex * (uniforms.M * uniforms.K) + m * uniforms.K;
    let biasOffsetQ = headNumber * uniforms.head_size;
    let biasOffsetK = uniforms.hidden_size + biasOffsetQ;
    let biasOffsetV = uniforms.hidden_size + biasOffsetK;

    var valueQ = ${y}(0);
    var valueK = ${y}(0);
    var valueV = ${y}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileInput[TILE_SIZE * local_id.y + local_id.x] = input[inputOffset + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        let offset = n + (w + local_id.y) * uniforms.ldb;
        tileWeightQ[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetQ + offset];
        tileWeightK[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetK + offset];
        tileWeightV[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetV + offset];
      }
      workgroupBarrier();
      for (var k: u32 = 0u; k<TILE_SIZE && w+k < uniforms.K; k++) {
        let inputTileOffset = TILE_SIZE * local_id.y + k;
        let weightTileOffset = TILE_SIZE * k + local_id.x;
        valueQ += tileInput[inputTileOffset] * tileWeightQ[weightTileOffset];
        valueK += tileInput[inputTileOffset] * tileWeightK[weightTileOffset];
        valueV += tileInput[inputTileOffset] * tileWeightV[weightTileOffset];
      }

      workgroupBarrier();
    }

    let headOffset = (m * uniforms.N + n) % uniforms.head_size;
    valueQ += bias[headOffset + biasOffsetQ];
    valueK += bias[headOffset + biasOffsetK];
    valueV += bias[headOffset + biasOffsetV];

    let offset = workgroup_id.z * uniforms.M * uniforms.N;
    if (m < uniforms.M && n < uniforms.N) {
      let outputIdx = offset + m * uniforms.N + n;
      output_q[outputIdx] = valueQ;
      output_k[outputIdx] = valueK;
      output_v[outputIdx] = valueV;
    }
  }`};return e.compute({name:"AttentionPrepare",shaderCache:{inputDependencies:["type","type","type"]},getRunData:()=>({outputs:[{dims:r,dataType:e.inputs[0].dataType,gpuDataType:0},{dims:r,dataType:e.inputs[0].dataType,gpuDataType:0},{dims:r,dataType:e.inputs[0].dataType,gpuDataType:0}],dispatchGroup:o,programUniforms:l}),getShaderSource:p},{inputs:u,outputs:[-1,-1,-1]})},vs=(e,t)=>{let r=ys(e.inputs,t),[i,a,n]=$s(e,r);return Ki(e,i,a,n,e.inputs[4],void 0,void 0,void 0,e.inputs[5],r)}}),xs,Ss,Ts,Es,Dp=k(()=>{"use strict";Xe(),ue(),ne(),b(),j(),xs=(e,t)=>{if(!e||e.length!==5)throw new Error("BatchNormalization requires 5 inputs");let r=(i,a,n)=>{let s=a.length;if(s!==i.length)throw new Error(`${n}: num dimensions != ${s}`);a.forEach((o,u)=>{if(o!==i[u])throw new Error(`${n}: dim[${u}] do not match`)})};if(e[0].dims.length>1){let i=t.format==="NHWC"?t.spatial?e[0].dims.slice(-1):e[0].dims.slice(-1).concat(e[0].dims.slice(1,e[0].dims.length-1)):e[0].dims.slice(1,t.spatial?2:void 0);r(e[1].dims,i,"Invalid input scale"),r(e[2].dims,i,"Invalid input B"),r(e[3].dims,i,"Invalid input mean"),r(e[4].dims,i,"Invalid input var")}else r(e[1].dims,[1],"Invalid input scale"),r(e[2].dims,[1],"Invalid input B"),r(e[3].dims,[1],"Invalid input mean"),r(e[4].dims,[1],"Invalid input var")},Ss=(e,t)=>{let{epsilon:r,spatial:i,format:a}=t,n=e[0].dims,s=i?A(n[n.length-1]):1,o=a==="NHWC"&&n.length>1?s:1,u=M.size(n)/s,l=i,p=l?n.length:n,d=C("x",e[0].dataType,e[0].dims,s),h=C("scale",e[1].dataType,e[1].dims,o),f=C("bias",e[2].dataType,e[2].dims,o),g=C("inputMean",e[3].dataType,e[3].dims,o),w=C("inputVar",e[4].dataType,e[4].dims,o),$=F("y",e[0].dataType,p,s),_=()=>{let v="";if(i)v=`let cOffset = ${n.length===1?"0u":a==="NHWC"?`outputIndices[${n.length-1}] / ${s}`:"outputIndices[1]"};`;else if(a==="NCHW")v=`
            ${$.indicesSet("outputIndices","0","0")}
            let cOffset = ${$.indicesToOffset("outputIndices")};`;else{v=`var cIndices = ${h.type.indices}(0);
                       cIndices[0] = outputIndices[${n.length-1}];`;for(let x=1;x<h.rank;x++)v+=`cIndices[${x}] = outputIndices[${x}];`;v+=`let cOffset = ${h.indicesToOffset("cIndices")};`}return v},y=v=>`
  const epsilon = ${r};
  ${v.registerUniform("outputSize","u32").declareVariables(d,h,f,g,w,$)}
  ${v.mainStart()}
  ${v.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
    var outputIndices = ${$.offsetToIndices(`global_idx * ${s}`)};
    ${_()}
    let scale = ${h.getByOffset("cOffset")};
    let bias = ${f.getByOffset("cOffset")};
    let inputMean = ${g.getByOffset("cOffset")};
    let inputVar = ${w.getByOffset("cOffset")};
    let x = ${d.getByOffset("global_idx")};
    let value = (x - inputMean) * inverseSqrt(inputVar + epsilon) * scale + bias;
    ${$.setByOffset("global_idx","value")}
  }`;return{name:"BatchNormalization",shaderCache:{hint:`${t.epsilon}_${t.format}_${i}_${s}`,inputDependencies:l?["rank","type","type","type","type"]:void 0},getShaderSource:y,getRunData:()=>({outputs:[{dims:e[0].dims,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:l?[{type:12,data:u},...E(n)]:[{type:12,data:u}]})}},Ts=e=>m(e),Es=(e,t)=>{let{inputs:r,outputCount:i}=e,a=Ts({...t,outputCount:i});if(te.webgpu.validateInputContent&&xs(r,a),t.trainingMode)throw new Error("BatchNormalization trainingMode is not supported yet.");e.compute(Ss(r,a))}}),Is,ks,zs,Pp=k(()=>{"use strict";ne(),j(),Is=e=>{if(e[0].dims.length!==3)throw new Error("input should have 3 dimensions");if(![320,640,1280].includes(e[0].dims[2]))throw new Error("number of channels should be 320, 640 or 1280");if(e[1].dims.length!==1)throw new Error("bias is expected to have 1 dimensions");if(e[0].dims[2]!==e[1].dims[0])throw new Error("last dimension of input and bias are not the same")},ks=e=>{let t=e[0].dims,r=e[0].dims[2],i=M.size(t)/4,a=e[0].dataType,n=C("input",a,t,4),s=C("bias",a,[r],4),o=C("residual",a,t,4),u=F("output",a,t,4);return{name:"BiasAdd",getRunData:()=>({outputs:[{dims:t,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(i/64)}}),getShaderSource:l=>`
  const channels = ${r}u / 4;
  ${l.declareVariables(n,s,o,u)}

  ${l.mainStart()}
    ${l.guardAgainstOutOfBoundsWorkgroupSizes(i)}
    let value = ${n.getByOffset("global_idx")}
      + ${s.getByOffset("global_idx % channels")} + ${o.getByOffset("global_idx")};
    ${u.setByOffset("global_idx","value")}
  }`}},zs=e=>{Is(e.inputs),e.compute(ks(e.inputs))}}),Cs,Re,As,Os,Rs,Bs,Ms,Ds,Ps,Us,Ns,Ls,Vs,qs,Fs,Gs,Zi,Ws,ga,Hs,js,Ks,Zs,Qs,Xs,Ys,Js,eo,to,ro,io,ao,no,so,oo,Wa,uo,Ha,ja,lo,po,co,ho,fo,mo,Ka=k(()=>{"use strict";ue(),ne(),b(),j(),Cs=(e,t,r,i,a,n,s)=>{let o=Math.ceil(t/4),u="";typeof a=="string"?u=`${a}(a)`:u=a("a");let l=C("inputData",r,[o],4),p=F("outputData",i,[o],4),d=[{name:"vec_size",type:"u32"}];return s&&d.push(...s),`
      ${e.registerUniforms(d).declareVariables(l,p)}

  ${n??""}

  ${e.mainStart()}
    ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}

    let a = ${l.getByOffset("global_idx")};
    ${p.setByOffset("global_idx",u)}
  }`},Re=(e,t,r,i,a,n=e.dataType,s,o)=>{let u=[{type:12,data:Math.ceil(M.size(e.dims)/4)}];return s&&u.push(...s),{name:t,shaderCache:{hint:a,inputDependencies:["type"]},getShaderSource:l=>Cs(l,M.size(e.dims),e.dataType,n,r,i,o),getRunData:l=>({outputs:[{dims:e.dims,dataType:n}],dispatchGroup:{x:Math.ceil(M.size(l[0].dims)/64/4)},programUniforms:u})}},As=e=>{e.compute(Re(e.inputs[0],"Abs","abs"))},Os=e=>{e.compute(Re(e.inputs[0],"Acos","acos"))},Rs=e=>{e.compute(Re(e.inputs[0],"Acosh","acosh"))},Bs=e=>{e.compute(Re(e.inputs[0],"Asin","asin"))},Ms=e=>{e.compute(Re(e.inputs[0],"Asinh","asinh"))},Ds=e=>{e.compute(Re(e.inputs[0],"Atan","atan"))},Ps=e=>{e.compute(Re(e.inputs[0],"Atanh","atanh"))},Us=e=>m(e),Ns=(e,t)=>{let r;switch(t.to){case 10:r="vec4<f16>";break;case 1:r="vec4<f32>";break;case 12:r="vec4<u32>";break;case 6:r="vec4<i32>";break;case 9:r="vec4<bool>";break;default:throw new RangeError(`not supported type (specified in attribute 'to' from 'Cast' operator): ${t.to}`)}e.compute(Re(e.inputs[0],"Cast",r,void 0,t.cacheKey,t.to))},Ls=e=>{let t,r,i=e.length>=2&&e[1].data!==0,a=e.length>=3&&e[2].data!==0;switch(e[0].dataType){case 1:t=i?e[1].getFloat32Array()[0]:-34028234663852886e22,r=a?e[2].getFloat32Array()[0]:34028234663852886e22;break;case 10:t=i?e[1].getUint16Array()[0]:64511,r=a?e[2].getUint16Array()[0]:31743;break;default:throw new Error("Unsupport data type")}return m({min:t,max:r})},Vs=(e,t)=>{let r=t||Ls(e.inputs),i=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"Clip",a=>`clamp(${a}, vec4<${i}>(uniforms.min), vec4<${i}>(uniforms.max))`,void 0,r.cacheKey,void 0,[{type:e.inputs[0].dataType,data:r.min},{type:e.inputs[0].dataType,data:r.max}],[{name:"min",type:i},{name:"max",type:i}]),{inputs:[0]})},qs=e=>{e.compute(Re(e.inputs[0],"Ceil","ceil"))},Fs=e=>{e.compute(Re(e.inputs[0],"Cos","cos"))},Gs=e=>{e.compute(Re(e.inputs[0],"Cosh","cosh"))},Zi=e=>m(e),Ws=(e,t)=>{let r=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"Elu",i=>`elu_vf32(${i})`,`
  const elu_alpha_ = ${r}(${t.alpha});

  fn elu_f32(a: ${r}) -> ${r} {
  return select((exp(a) - 1.0) * elu_alpha_, a, a >= 0.0);
  }

  fn elu_vf32(v: vec4<${r}>) -> vec4<${r}> {
  return vec4(elu_f32(v.x), elu_f32(v.y), elu_f32(v.z), elu_f32(v.w));
  }`,t.cacheKey))},ga=(e="f32")=>`
const r0: ${e} = 0.3275911;
const r1: ${e} = 0.254829592;
const r2: ${e} = -0.284496736;
const r3: ${e} = 1.421413741;
const r4: ${e} = -1.453152027;
const r5: ${e} = 1.061405429;

fn erf_vf32(v: vec4<${e}>) -> vec4<${e}> {
  let absv = abs(v);
  let x = 1.0 / (1.0 + r0 * absv);
  return sign(v) * (1.0 - ((((r5 * x + r4) * x + r3) * x + r2) * x + r1) * x * exp(-absv * absv));
}`,Hs=e=>{let t=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"Erf",r=>`erf_vf32(${r})`,ga(t)))},js=e=>{e.compute(Re(e.inputs[0],"Exp","exp"))},Ks=e=>{e.compute(Re(e.inputs[0],"Floor","floor"))},Zs=e=>{let t=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"Gelu",r=>`0.5 * ${r} * (1.0 + erf_vf32(${r} * 0.7071067811865475))`,ga(t)))},Qs=(e,t)=>{let r=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"LeakyRelu",i=>`select(leaky_relu_alpha_ * ${i}, ${i}, ${i} >= vec4<${r}>(0.0))`,`const leaky_relu_alpha_ = ${r}(${t.alpha});`,t.cacheKey))},Xs=e=>{e.compute(Re(e.inputs[0],"Not",t=>`!${t}`))},Ys=e=>{e.compute(Re(e.inputs[0],"Neg",t=>`-${t}`))},Js=e=>{e.compute(Re(e.inputs[0],"Reciprocal",t=>`1.0/${t}`))},eo=e=>{let t=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"Relu",r=>`select(vec4<${t}>(0.0), ${r}, ${r} > vec4<${t}>(0.0))`))},to=e=>{e.compute(Re(e.inputs[0],"Sigmoid",t=>`(1.0 / (1.0 + exp(-${t})))`))},ro=e=>m(e),io=(e,t)=>{let r=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"HardSigmoid",i=>`max(vec4<${r}>(0.0), min(vec4<${r}>(1.0), ${t.alpha} * ${i} + vec4<${r}>(${t.beta})))`,void 0,t.cacheKey))},ao=e=>{e.compute(Re(e.inputs[0],"Sin","sin"))},no=e=>{e.compute(Re(e.inputs[0],"Sinh","sinh"))},so=e=>{e.compute(Re(e.inputs[0],"Sqrt","sqrt"))},oo=e=>{e.compute(Re(e.inputs[0],"Tan","tan"))},Wa=e=>`sign(${e}) * (1 - exp(-2 * abs(${e}))) / (1 + exp(-2 * abs(${e})))`,uo=e=>{e.compute(Re(e.inputs[0],"Tanh",Wa))},Ha=(e="f32")=>`
const fast_gelu_a: ${e} = 0.5;
const fast_gelu_b: ${e} = 0.7978845608028654;
const fast_gelu_c: ${e} = 0.035677408136300125;

fn tanh_v(v: vec4<${e}>) -> vec4<${e}> {
  return ${Wa("v")};
}
`,ja=e=>`(fast_gelu_a + fast_gelu_a * tanh_v(${e} * (fast_gelu_c * ${e} * ${e} + fast_gelu_b))) * ${e}`,lo=e=>{let t=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"FastGelu",ja,Ha(t),void 0,e.inputs[0].dataType))},po=(e,t)=>{let r=z(e.inputs[0].dataType);return e.compute(Re(e.inputs[0],"ThresholdedRelu",i=>`select(vec4<${r}>(0.0), ${i}, ${i} > thresholded_relu_alpha_)`,`const thresholded_relu_alpha_ = vec4<${r}>(${t.alpha});`,t.cacheKey)),0},co=e=>{e.compute(Re(e.inputs[0],"Log","log"))},ho=(e,t)=>`
const alpha = vec4<${e}>(${t});
const one = ${e}(1.0);
const zero = ${e}(0.0);

fn quick_gelu_impl(x: vec4<${e}>) -> vec4<${e}> {
  let v = x *alpha;
  var x1 : vec4<${e}>;
  for (var i = 0; i < 4; i = i + 1) {
    if (v[i] >= zero) {
      x1[i] = one / (one + exp(-v[i]));
    } else {
      x1[i] = one - one / (one + exp(v[i]));
    }
  }
  return x * x1;
}
`,fo=e=>`quick_gelu_impl(${e})`,mo=(e,t)=>{let r=z(e.inputs[0].dataType);e.compute(Re(e.inputs[0],"QuickGelu",fo,ho(r,t.alpha),t.cacheKey,e.inputs[0].dataType))}}),go,yo,wo,Up=k(()=>{"use strict";ne(),j(),Ka(),go=e=>{if(e[0].dims.length!==3)throw new Error("input should have 3 dimensions");if(![2560,5120,10240].includes(e[0].dims[2]))throw new Error("hidden state should be 2560, 5120 or 10240");if(e[1].dims.length!==1)throw new Error("bias is expected to have 1 dimensions");if(e[0].dims[2]!==e[1].dims[0])throw new Error("last dimension of input and bias are not the same")},yo=e=>{let t=e[0].dims.slice();t[2]=t[2]/2;let r=C("input",e[0].dataType,e[0].dims,4),i=C("bias",e[0].dataType,[e[0].dims[2]],4),a=F("output",e[0].dataType,t,4),n=M.size(t)/4,s=O(e[0].dataType);return{name:"BiasSplitGelu",getRunData:()=>({outputs:[{dims:t,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(n/64)}}),getShaderSource:o=>`
  const M_SQRT2 = sqrt(2.0);
  const halfChannels = ${e[0].dims[2]/4/2}u;

  ${o.declareVariables(r,i,a)}

  ${ga(s)}

  ${o.mainStart()}
    ${o.guardAgainstOutOfBoundsWorkgroupSizes(n)}
    let biasIdx = global_idx % halfChannels;
    let batchIndex = global_idx / halfChannels;
    let inputOffset = biasIdx + batchIndex * halfChannels * 2;
    let valueLeft = input[inputOffset] + bias[biasIdx];
    let valueRight = input[inputOffset + halfChannels] + bias[biasIdx + halfChannels];
    let geluRight = valueRight * 0.5 * (erf_vf32(valueRight / M_SQRT2) + 1);

    ${a.setByOffset("global_idx","valueLeft * geluRight")}
  }`}},wo=e=>{go(e.inputs),e.compute(yo(e.inputs))}}),_o,bo,Bt,$o,vo,xo,So,To,Eo,Io,ko,zo,Co,Np=k(()=>{"use strict";ue(),ne(),j(),_o=(e,t,r,i,a,n,s,o,u,l,p,d)=>{let h,f;typeof o=="string"?h=f=(y,v)=>`${o}((${y}),(${v}))`:typeof o=="function"?h=f=o:(h=o.scalar,f=o.vector);let g=F("outputData",p,i.length,4),w=C("aData",u,t.length,4),$=C("bData",l,r.length,4),_;if(a)if(n){let y=M.size(t)===1,v=M.size(r)===1,x=t.length>0&&t[t.length-1]%4===0,I=r.length>0&&r[r.length-1]%4===0;y||v?_=g.setByOffset("global_idx",f(y?`${w.type.value}(${w.getByOffset("0")}.x)`:w.getByOffset("global_idx"),v?`${$.type.value}(${$.getByOffset("0")}.x)`:$.getByOffset("global_idx"))):_=`
            let outputIndices = ${g.offsetToIndices("global_idx * 4u")};
            let offsetA = ${w.broadcastedIndicesToOffset("outputIndices",g)};
            let offsetB = ${$.broadcastedIndicesToOffset("outputIndices",g)};
            ${g.setByOffset("global_idx",f(s||x?w.getByOffset("offsetA / 4u"):`${w.type.value}(${w.getByOffset("offsetA / 4u")}[offsetA % 4u])`,s||I?$.getByOffset("offsetB / 4u"):`${$.type.value}(${$.getByOffset("offsetB / 4u")}[offsetB % 4u])`))}
          `}else _=g.setByOffset("global_idx",f(w.getByOffset("global_idx"),$.getByOffset("global_idx")));else{if(!n)throw new Error("no necessary to use scalar implementation for element-wise binary op implementation.");let y=(v,x,I="")=>{let B=`aData[indexA${x}][componentA${x}]`,R=`bData[indexB${x}][componentB${x}]`;return`
            let outputIndices${x} = ${g.offsetToIndices(`global_idx * 4u + ${x}u`)};
            let offsetA${x} = ${w.broadcastedIndicesToOffset(`outputIndices${x}`,g)};
            let offsetB${x} = ${$.broadcastedIndicesToOffset(`outputIndices${x}`,g)};
            let indexA${x} = offsetA${x} / 4u;
            let indexB${x} = offsetB${x} / 4u;
            let componentA${x} = offsetA${x} % 4u;
            let componentB${x} = offsetB${x} % 4u;
            ${v}[${x}] = ${I}(${h(B,R)});
          `};p===9?_=`
            var data = vec4<u32>(0);
            ${y("data",0,"u32")}
            ${y("data",1,"u32")}
            ${y("data",2,"u32")}
            ${y("data",3,"u32")}
            outputData[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));`:_=`
            ${y("outputData[global_idx]",0)}
            ${y("outputData[global_idx]",1)}
            ${y("outputData[global_idx]",2)}
            ${y("outputData[global_idx]",3)}
          `}return`
        ${e.registerUniform("vec_size","u32").declareVariables(w,$,g)}

        ${d??""}

        ${e.mainStart()}
        ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${_}
      }`},bo=(e,t,r,i,a,n,s=r.dataType)=>{let o=r.dims.map(Number),u=i.dims.map(Number),l=!M.areEqual(o,u),p=o,d=M.size(o),h=!1,f=!1,g=[l];if(l){let w=Ut.calcShape(o,u,!1);if(!w)throw new Error("Can't perform binary op on the given tensors");p=w.slice(),d=M.size(p);let $=M.size(o)===1,_=M.size(u)===1,y=o.length>0&&o[o.length-1]%4===0,v=u.length>0&&u[u.length-1]%4===0;g.push($),g.push(_),g.push(y),g.push(v);let x=1;for(let I=1;I<p.length;I++){let B=o[o.length-I];if(B===u[u.length-I])x*=B;else break}x%4===0?(f=!0,h=!0):($||_||y||v)&&(h=!0)}else h=!0;return g.push(h),{name:e,shaderCache:{hint:t+g.map(w=>w.toString()).join("_"),inputDependencies:["rank","rank"]},getShaderSource:w=>_o(w,o,u,p,h,l,f,a,r.dataType,i.dataType,s,n),getRunData:()=>({outputs:[{dims:p,dataType:s}],dispatchGroup:{x:Math.ceil(d/64/4)},programUniforms:[{type:12,data:Math.ceil(M.size(p)/4)},...E(o,u,p)]})}},Bt=(e,t,r,i,a,n)=>{e.compute(bo(t,a??"",e.inputs[0],e.inputs[1],r,i,n))},$o=e=>{Bt(e,"Add",(t,r)=>`${t}+${r}`)},vo=e=>{Bt(e,"Div",(t,r)=>`${t}/${r}`)},xo=e=>{Bt(e,"Equal",{scalar:(t,r)=>`u32(${t}==${r})`,vector:(t,r)=>`vec4<u32>(${t}==${r})`},void 0,void 0,9)},So=e=>{Bt(e,"Mul",(t,r)=>`${t}*${r}`)},To=e=>{let t=C("input",e.inputs[0].dataType,e.inputs[0].dims).type.value;Bt(e,"Pow",{scalar:(r,i)=>`pow_custom(${r},${i})`,vector:(r,i)=>`pow_vector_custom(${r},${i})`},`
    fn pow_custom(a : ${t}, b : ${t}) -> ${t} {
      if (b == ${t}(0.0)) {
        return ${t}(1.0);
      } else if (a < ${t}(0.0) && f32(b) != floor(f32(b))) {
        return ${t}(pow(f32(a), f32(b))); // NaN
      }
      return select(sign(a), ${t}(1.0), round(f32(abs(b) % ${t}(2.0))) != 1.0) * ${t}(${t==="i32"?"round":""}(pow(f32(abs(a)), f32(b))));
    }
    fn pow_vector_custom(a : vec4<${t}>, b : vec4<${t}>) -> vec4<${t}> {
      // TODO: implement vectorized pow
      return vec4<${t}>(pow_custom(a.x, b.x), pow_custom(a.y, b.y), pow_custom(a.z, b.z), pow_custom(a.w, b.w));
    }
      `)},Eo=e=>{Bt(e,"Sub",(t,r)=>`${t}-${r}`)},Io=e=>{Bt(e,"Greater",{scalar:(t,r)=>`u32(${t}>${r})`,vector:(t,r)=>`vec4<u32>(${t}>${r})`},void 0,void 0,9)},ko=e=>{Bt(e,"Less",{scalar:(t,r)=>`u32(${t}<${r})`,vector:(t,r)=>`vec4<u32>(${t}<${r})`},void 0,void 0,9)},zo=e=>{Bt(e,"GreaterOrEqual",{scalar:(t,r)=>`u32(${t}>=${r})`,vector:(t,r)=>`vec4<u32>(${t}>=${r})`},void 0,void 0,9)},Co=e=>{Bt(e,"LessOrEqual",{scalar:(t,r)=>`u32(${t}<=${r})`,vector:(t,r)=>`vec4<u32>(${t}<=${r})`},void 0,void 0,9)}}),Ao,Oo,Ro,Bo,Mo,Do,Lp=k(()=>{"use strict";ue(),ne(),b(),j(),Ao=(e,t)=>{if(!e||e.length<1)throw new Error("too few inputs");let r=0,i=e[r],a=i.dataType,n=i.dims.length;e.forEach((s,o)=>{if(o!==r){if(s.dataType!==a)throw new Error("input tensors should be one type");if(s.dims.length!==n)throw new Error("input tensors should have the same shape");s.dims.forEach((u,l)=>{if(l!==t&&u!==i.dims[l])throw new Error("non concat dimensions must match")})}})},Oo=(e,t)=>`
  fn calculateInputIndex(index: u32) -> u32 {
    let sizeInConcatAxis = array<u32, ${e}u>(${t});
    for (var i: u32 = 0u; i < ${e}; i += 1u ) {
      if (index < sizeInConcatAxis[i]) {
        return i;
      }
    }
    return ${e}u;
  }`,Ro=(e,t)=>{let r=e.length,i=[];for(let a=0;a<r;++a){let n=t.setByOffset("global_idx",e[a].getByIndices("indices"));r===1?i.push(n):a===0?i.push(`if (inputIndex == ${a}u) { ${n} }`):a===r-1?i.push(`else { ${n} }`):i.push(`else if (inputIndex == ${a}) { ${n} }`)}return i.join(`
`)},Bo=(e,t,r,i)=>{let a=M.size(r),n=new Array(e.length),s=new Array(e.length),o=0,u=[],l=[],p=[{type:12,data:a}];for(let w=0;w<e.length;++w)o+=e[w].dims[t],n[w]=o,l.push(e[w].dims.length),s[w]=C(`input${w}`,i,l[w]),u.push("rank"),p.push({type:12,data:n[w]});for(let w=0;w<e.length;++w)p.push(...E(e[w].dims));p.push(...E(r));let d=F("output",i,r.length),h=d.indicesGet("indices",t),f=Array.from(Array(n.length).keys()).map(w=>`uniforms.sizeInConcatAxis${w}`).join(","),g=w=>`

  ${(()=>{w.registerUniform("outputSize","u32");for(let $=0;$<e.length;$++)w.registerUniform(`sizeInConcatAxis${$}`,"u32");return w.declareVariables(...s,d)})()}

  ${Oo(n.length,f)}

  ${w.mainStart()}
    ${w.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

    var indices = ${d.offsetToIndices("global_idx")};

    let inputIndex = calculateInputIndex(${h});
    if (inputIndex != 0u) {
      let sizeInConcatAxis = array<u32, ${n.length}u>(${f});
      ${h} -= sizeInConcatAxis[inputIndex - 1u];
    }

    ${Ro(s,d)}
  }`;return{name:"Concat",shaderCache:{hint:`${t}`,inputDependencies:u},getRunData:()=>({outputs:[{dims:r,dataType:i}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:p}),getShaderSource:g}},Mo=(e,t)=>{let r=e.inputs,i=r[0].dims,a=M.normalizeAxis(t.axis,i.length);Ao(r,a);let n=i.slice();n[a]=r.reduce((o,u)=>o+(u.dims.length>a?u.dims[a]:0),0);let s=r.filter(o=>M.size(o.dims)>0);e.compute(Bo(s,a,n,r[0].dataType),{inputs:s})},Do=e=>m({axis:e.axis})}),Dr,Pr,Ur,Za,Nr=k(()=>{"use strict";ue(),ne(),Dr=(e,t,r="f32")=>{switch(e.activation){case"Relu":return`value = max(value, ${t}(0.0));`;case"Sigmoid":return`value = (${t}(1.0) / (${t}(1.0) + exp(-value)));`;case"Clip":return`value = clamp(value, ${t}(${r}(uniforms.clip_min)), ${t}(${r}(uniforms.clip_max)));`;case"HardSigmoid":return`value = max(${t}(0.0), min(${t}(1.0), ${r}(uniforms.alpha) * value + ${r}(uniforms.beta)));`;case"LeakyRelu":return`value = select(${r}(uniforms.alpha) * value, value, value >= ${t}(0.0));`;case"Tanh":return`let e2x = exp(-2.0 * abs(value));
              value = sign(value) * (1.0 - e2x) / (1.0 + e2x);
        `;case"":return"";default:throw new Error(`Unsupported activation ${e.activation}`)}},Pr=(e,t)=>{e.activation==="Clip"?t.push({type:1,data:e.clipMax},{type:1,data:e.clipMin}):e.activation==="HardSigmoid"?t.push({type:1,data:e.alpha},{type:1,data:e.beta}):e.activation==="LeakyRelu"&&t.push({type:1,data:e.alpha})},Ur=(e,t)=>{e.activation==="Clip"?t.push({name:"clip_max",type:"f32"},{name:"clip_min",type:"f32"}):e.activation==="HardSigmoid"?t.push({name:"alpha",type:"f32"},{name:"beta",type:"f32"}):e.activation==="LeakyRelu"&&t.push({name:"alpha",type:"f32"})},Za=e=>{let t=e?.activation||"";if(t==="HardSigmoid"){let[r,i]=e?.activation_params||[.2,.5];return{activation:t,alpha:r,beta:i}}else if(t==="Clip"){let[r,i]=e?.activation_params||[Pi,It];return{activation:t,clipMax:i,clipMin:r}}else if(t==="LeakyRelu"){let[r]=e?.activation_params||[.01];return{activation:t,alpha:r}}return{activation:t}}}),it,Po,Qa=k(()=>{"use strict";it=(e,t)=>{switch(e){case 1:return t;case 2:return`vec2<${t}>`;case 3:return`vec3<${t}>`;case 4:return`vec4<${t}>`;default:throw new Error(`${e}-component is not supported.`)}},Po=e=>`
      ${e?"value = value + getBiasByOutputCoords(coords);":""}
      `}),Uo,Vp=k(()=>{"use strict";Uo=e=>`
fn getIndexFromCoords4D(coords : vec4<i32>, shape : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
      shape.y * shape.z * shape.w, shape.z * shape.w, shape.w, 1));
}
fn getOutputIndexFromCoords(coords : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
    i32(${e}.x), i32(${e}.y), i32(${e}.z), 1));
}
`}),Qi,Xa,Ya=k(()=>{"use strict";ue(),ne(),j(),Nr(),Qi=(e,t,r,i,a)=>{let n=i-r;return`
      ${Array.from({length:r}).map((s,o)=>`
      if (${D(t.shape,o,t.rank)} != 1) {
        ${t.indicesSet(e,o,D(a,o+n,i))}
      } else {
        ${t.indicesSet(e,o,0)}
      }`).join("")}
`},Xa=(e,t,r,i,a=!1,n)=>{let s=e[0].dims,o=e[1].dims,u=s[s.length-2],l=o[o.length-1],p=s[s.length-1],d=A(l),h=A(p),f=A(u),g=M.size(r)/d/f,w=e.length>2,$=i?i.slice(0,-2):r.slice(0,-2),_=[M.size($),u,l],y=[{type:12,data:g},{type:12,data:u},{type:12,data:l},{type:12,data:p}];Pr(t,y),y.push(...E($,s,o)),w&&y.push(...E(e[2].dims)),y.push(...E(_));let v=x=>{let I=re("batch_dims",e[0].dataType,$.length),B=C("a",e[0].dataType,s.length,h),R=C("b",e[1].dataType,o.length,d),N=F("output",e[0].dataType,_.length,d),G=O(N.type.tensor),H=Dr(t,N.type.value,G),ve=[B,R],se="";if(w){let W=a?d:1;ve.push(C("bias",e[2].dataType,e[2].dims.length,W)),se=`${a?`value += bias[col / ${W}];`:`value += ${N.type.value}(bias[row + i]);`}`}let ce=[{name:"output_size",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"}];Ur(t,ce);let Me=()=>{let W=`var a_data: ${B.type.value};`;for(let J=0;J<h;J++)W+=`
              let b_data${J} = b[(b_offset + (k + ${J}) * uniforms.N + col) / ${d}];`;for(let J=0;J<f;J++){W+=`a_data = a[(a_offset + (row + ${J}) * uniforms.K + k) / ${h}];`;for(let Se=0;Se<h;Se++)W+=`
            values[${J}] = fma(${R.type.value}(a_data${h===1?"":`[${Se}]`}), b_data${Se}, values[${J}]);
`}return W};return`
  ${x.registerUniforms(ce).registerInternalVariables(I).declareVariables(...ve,N)}
  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let col = (global_idx % (uniforms.N / ${d})) * ${d};
    var index1 = global_idx / (uniforms.N / ${d});
    let stride1 = uniforms.M / ${f};
    let row = (index1 % stride1) * ${f};
    let batch = index1 / stride1;

    ${r.length===2?"":`let batch_indices = ${I.offsetToIndices("batch")};`}

    var a_indices: ${B.type.indices};
    ${Qi("a_indices",B,B.rank-2,I.rank,"batch_indices")}
    ${B.indicesSet("a_indices",B.rank-2,0)}
    ${B.indicesSet("a_indices",B.rank-1,0)}
    let a_offset = ${B.indicesToOffset("a_indices")};

    var b_indices: ${R.type.indices};
    ${Qi("b_indices",R,R.rank-2,I.rank,"batch_indices")}
    ${R.indicesSet("b_indices",R.rank-2,0)}
    ${R.indicesSet("b_indices",R.rank-1,0)}
    let b_offset = ${R.indicesToOffset("b_indices")};
    var values: array<${N.type.value}, ${f}>;
    for (var k: u32 = 0u; k < uniforms.K; k = k + ${h}) {
      ${Me()}
    }
    for (var i = 0u; i < ${f}u; i++) {
      var value = values[i];
      ${se}
      ${H}
      let cur_indices = ${N.type.indices}(batch, row + i, col);
      let offset = ${N.indicesToOffset("cur_indices")};
      ${N.setByOffset(`offset / ${d}`,"value")};
    }
  }
  `};return{name:"MatMulNaive",shaderCache:{hint:`${t.activation};${d};${h};${f};${a}`,inputDependencies:w?["rank","rank","rank"]:["rank","rank"]},getRunData:()=>({outputs:[{dims:n?n(r):r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(g/64)},programUniforms:y}),getShaderSource:v}}}),No,Lo,Ja,en,Vo,tn,qo,ya,rn=k(()=>{"use strict";ue(),ne(),j(),Nr(),Ya(),Qa(),No=(e,t)=>e?`
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          kStart + inputRow,
          globalRowStart / innerElementSize + inputCol${t?", batchIndices":""});
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          globalRow + innerRow,
          kStart / innerElementSize + inputCol${t?", batchIndices":""});
        `,Lo=(e,t)=>e?`
        let ACached0 = mm_Asub[k * innerElementSize][localRow];
        let ACached1 = mm_Asub[k * innerElementSize + 1][localRow];
        let ACached2 = mm_Asub[k * innerElementSize + 2][localRow];
        ${t===3?"":"let ACached3 = mm_Asub[k * innerElementSize + 3][localRow];"}
        for (var i = 0; i < rowPerThread; i = i + 1) {
          acc[i] = BCached0 * ACached0[i] + acc[i];
          acc[i] = BCached1 * ACached1[i] + acc[i];
          acc[i] = BCached2 * ACached2[i] + acc[i];
          ${t===3?"":"acc[i] = BCached3 * ACached3[i] + acc[i];"}
        }`:`
        for (var i = 0; i < rowPerThread; i = i + 1) {
          let ACached = mm_Asub[tileRow + i][k];
          acc[i] = BCached0 * ACached.x + acc[i];
          acc[i] = BCached1 * ACached.y + acc[i];
          acc[i] = BCached2 * ACached.z + acc[i];
          ${t===3?"":"acc[i] = BCached3 * ACached.w + acc[i];"}
        }`,Ja=(e,t,r="f32",i,a=!1,n=32,s=!1,o=32)=>{let u=t[1]*e[1],l=t[0]*e[0],p=a?u:n,d=a?n:u,h=p/t[0],f=n/t[1];if(!((a&&h===4&&e[1]===4||!a&&(h===3||h===4))&&p%t[0]===0&&n%t[1]===0&&e[0]===4))throw new Error(`If transposeA ${a} is true, innerElementSize ${h} and workPerThread[1] ${e[1]} must be 4.
      Otherwise, innerElementSize ${h} must be 3 or 4.
  tileAWidth ${p} must be divisible by workgroupSize[0]${t[0]}. tileInner ${n} must be divisible by workgroupSize[1] ${t[1]}. colPerThread ${e[0]} must be 4.`);return`
var<workgroup> mm_Asub: array<array<vec${h}<${r}>, ${p/h}>, ${d}>;
var<workgroup> mm_Bsub: array<array<vec4<${r}>, ${l/e[0]}>, ${n}>;

const rowPerThread = ${e[1]};
const colPerThread = ${e[0]};
const innerElementSize = ${h};
const tileInner = ${n};

@compute @workgroup_size(${t[0]}, ${t[1]}, ${t[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
  let localRow = i32(localId.y);
  let tileRow = localRow * rowPerThread;
  let tileCol = i32(localId.x);

  let globalRow =i32(globalId.y) * rowPerThread;
  let globalCol = i32(globalId.x);
  let batch = ${s?"0":"i32(globalId.z)"};
  ${i?`let batchIndices = ${i.offsetToIndices("u32(batch)")};`:""}
  let globalRowStart = i32(workgroupId.y) * ${u};

  let num_tiles = ${s?`${Math.ceil(o/n)}`:"(uniforms.dim_inner - 1) / tileInner + 1"};
  var kStart = ${s?`i32(globalId.z) * ${o}`:"0"};

  var acc: array<vec4<${r}>, rowPerThread>;

  // Loop over shared dimension.
  let tileRowB = localRow * ${f};
  for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let inputRow = tileRow + innerRow;
          let inputCol = tileCol;
          ${No(a,i)}
      }

      // Load one tile of B into local memory.
      for (var innerRow = 0; innerRow < ${f}; innerRow = innerRow + 1) {
          let inputRow = tileRowB + innerRow;
          let inputCol = tileCol;
          mm_Bsub[inputRow][inputCol] = mm_readB(batch, kStart + inputRow, globalCol${i?", batchIndices":""});
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      for (var k = 0; k < tileInner / innerElementSize; k = k + 1) {
          let BCached0 = mm_Bsub[k * innerElementSize][tileCol];
          let BCached1 = mm_Bsub[k * innerElementSize + 1][tileCol];
          let BCached2 = mm_Bsub[k * innerElementSize + 2][tileCol];
          ${h===3?"":"let BCached3 = mm_Bsub[k * innerElementSize + 3][tileCol];"}

          ${Lo(a,h)}
      }

      workgroupBarrier();
  }

  for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      mm_write(batch, globalRow + innerRow, globalCol, acc[innerRow]);
  }
}`},en=(e,t)=>e?`
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              kStart + inputRow,
              globalRowStart + inputCol${t?", batchIndices":""});
            `:`
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              globalRowStart + inputRow,
              kStart + inputCol${t?", batchIndices":""});
            `,Vo=e=>e?"let ACached = mm_Asub[k][tileRow + innerRow];":"let ACached = mm_Asub[tileRow + innerRow][k];",tn=(e,t,r="f32",i,a=!1,n=32,s=!1,o=32,u=!1)=>{let l=e[1]*t[1],p=e[0]*t[0],d=a?l:n,h=a?n:l;if(!(h%t[1]===0&&d%t[0]===0&&n%t[1]===0))throw new Error(`tileAHight ${h} must be divisible by workgroupSize[1]${t[1]}, tileAWidth ${d} must be divisible by workgroupSize[0]${t[0]}, tileInner ${n} must be divisible by workgroupSize[1]${t[1]}`);let f=h/t[1],g=d/t[0],w=n/t[1],$=u?`
    let localRow = i32(localId.y);
    let localCol = i32(localId.x);
    let globalRowStart = i32(workgroupId.y) * ${l};
    let globalColStart = i32(workgroupId.x) * ${p};

    // Loop over shared dimension.
    for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var inputRow = localRow; inputRow < ${h}; inputRow = inputRow + ${t[1]}) {
        for (var inputCol = localCol; inputCol < ${d}; inputCol = inputCol + ${t[0]}) {
          ${en(a,i)}
        }
      }
      // Load one tile of B into local memory.
      for (var inputRow = localRow; inputRow < ${n}; inputRow = inputRow + ${t[1]}) {
            for (var inputCol = localCol; inputCol < ${p}; inputCol = inputCol + ${t[0]}) {
          mm_Bsub[inputRow][inputCol] = mm_readB(batch,
            kStart + inputRow,
            globalColStart + inputCol${i?", batchIndices":""});
        }
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      var BCached : array<${r}, colPerThread>;
      for (var k = 0; k < tileInner; k = k + 1) {
        for (var inner = 0; inner < colPerThread; inner = inner + 1) {
          BCached[inner] = mm_Bsub[k][localCol + inner * ${t[0]}];
        }
        for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let ACached = ${a?`mm_Asub[k][localRow + innerRow * ${t[1]}];`:`mm_Asub[localRow + innerRow * ${t[1]}][k];`}
          for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
            acc[innerRow][innerCol] = acc[innerRow][innerCol] +
                ACached * BCached[innerCol];
          }
        }
      }
      workgroupBarrier();
    }
    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      let gRow = globalRowStart + localRow + innerRow * ${t[1]};
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        let gCol = globalColStart + localCol + innerCol * ${t[0]};
        mm_write(batch, gRow, gCol, acc[innerRow][innerCol]);
      }
    }
    `:`
let tileRow = i32(localId.y) * rowPerThread;
let tileCol = i32(localId.x) * colPerThread;

let globalRow = i32(globalId.y) * rowPerThread;
let globalCol = i32(globalId.x) * colPerThread;
let globalRowStart = i32(workgroupId.y) * ${l};

let tileRowA = i32(localId.y) * ${f};
let tileColA = i32(localId.x) * ${g};
let tileRowB = i32(localId.y) * ${w};
// Loop over shared dimension.
for (var t = 0; t < num_tiles; t = t + 1) {
  // Load one tile of A into local memory.
  for (var innerRow = 0; innerRow < ${f}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < ${g}; innerCol = innerCol + 1) {
      let inputRow = tileRowA + innerRow;
      let inputCol = tileColA + innerCol;
      ${en(a,i)}
    }
  }

  // Load one tile of B into local memory.
  for (var innerRow = 0; innerRow < ${w}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
      let inputRow = tileRowB + innerRow;
      let inputCol = tileCol + innerCol;
      mm_Bsub[inputRow][inputCol] = mm_readB(batch,
        kStart + inputRow,
        globalCol + innerCol${i?", batchIndices":""});
    }
  }
  kStart = kStart + tileInner;
  workgroupBarrier();

  // Compute acc values for a single thread.
  var BCached : array<${r}, colPerThread>;
  for (var k = 0; k < tileInner; k = k + 1) {
    for (var inner = 0; inner < colPerThread; inner = inner + 1) {
      BCached[inner] = mm_Bsub[k][tileCol + inner];
    }

    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      ${Vo(a)}
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        acc[innerRow][innerCol] = acc[innerRow][innerCol] + ACached * BCached[innerCol];
      }
    }
  }

  workgroupBarrier();
}

for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
  for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
    mm_write(batch, globalRow + innerRow, globalCol + innerCol,
        acc[innerRow][innerCol]);
  }
}
`;return`
  var<workgroup> mm_Asub : array<array<${r}, ${d}>, ${h}>;
  var<workgroup> mm_Bsub : array<array<${r}, ${p}>, ${n}>;
  const rowPerThread = ${e[1]};
  const colPerThread = ${e[0]};
  const tileInner = ${n};

@compute @workgroup_size(${t[0]}, ${t[1]}, ${t[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
    let batch = ${s?"0":"i32(globalId.z)"};
    ${i?`let batchIndices = ${i.offsetToIndices("u32(batch)")};`:""}
    let num_tiles = ${s?`${Math.ceil(o/n)}`:"(uniforms.dim_inner - 1) / tileInner + 1"};
    var kStart = ${s?`i32(globalId.z) * ${o}`:"0"};

    var acc : array<array<${r}, colPerThread>, rowPerThread>;
    ${$}
  }
`},qo=(e,t,r,i,a=!1)=>{let[n,s,o,u]=i,l=O(i[0].type.tensor);return`
    fn mm_readA(batch: i32, row: i32, colIn: i32, batchIndices: ${n.type.indices}) -> ${it(e,l)} {
      var value = ${it(e,l)}(0.0);
      let col = colIn * ${e};
      if(row < uniforms.dim_a_outer && col < uniforms.dim_inner)
      {
        var aIndices: ${s.type.indices};
        ${Qi("aIndices",s,s.rank-2,n.rank,"batchIndices")}
        ${s.indicesSet("aIndices",s.rank-2,"u32(row)")}
        ${s.indicesSet("aIndices",s.rank-1,"u32(colIn)")}
        value = ${s.getByIndices("aIndices")};
      }
      return value;
    }

    fn mm_readB(batch: i32, row: i32, colIn: i32, batchIndices: ${n.type.indices}) -> ${it(e,l)} {
      var value = ${it(e,l)}(0.0);
      let col = colIn * ${e};
      if(row < uniforms.dim_inner && col < uniforms.dim_b_outer)
      {
        var bIndices: ${o.type.indices};
        ${Qi("bIndices",o,o.rank-2,n.rank,"batchIndices")}
        ${o.indicesSet("bIndices",o.rank-2,"u32(row)")}
        ${o.indicesSet("bIndices",o.rank-1,"u32(colIn)")}
        value = ${o.getByIndices("bIndices")};
      }
      return value;
    }

    fn mm_write(batch: i32, row: i32, colIn: i32, valueIn: ${it(e,l)}) {
      let col = colIn * ${e};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer) {
        var value = valueIn;
        let coords = vec3<i32>(batch, row, colIn);
        ${t?`value = value + ${a?"bias[colIn]":`${it(e,l)}(bias[row])`};`:""}
        ${r}
        ${u.setByIndices("vec3<u32>(coords)","value")}
      }
    }
    `},ya=(e,t,r,i,a=!1,n)=>{let s=e[0].dims,o=e[1].dims,u=s.slice(0,-2),l=o.slice(0,-2),p=i?i.slice(0,-2):r.slice(0,-2),d=M.size(p),h=s[s.length-2],f=s[s.length-1],g=o[o.length-1],w=f%4===0&&g%4===0,$=h<=8?[4,1,1]:[4,4,1],_=[8,8,1],y=[Math.ceil(g/_[0]/$[0]),Math.ceil(h/_[1]/$[1]),Math.ceil(d/_[2]/$[2])],v=w?4:1,x=[...u,h,f/v],I=x.length,B=[...l,f,g/v],R=B.length,N=[d,h,g/v],G=[{type:6,data:h},{type:6,data:g},{type:6,data:f}];Pr(t,G),G.push(...E(p,x,B));let H=["rank","rank"],ve=e.length>2;ve&&(G.push(...E(e[2].dims)),H.push("rank")),G.push(...E(N));let se=ce=>{let Me=p.length,W=re("batchDims",e[0].dataType,Me,1),J=O(e[0].dataType),Se=C("a",e[0].dataType,I,v),_e=C("b",e[1].dataType,R,v),fe=F("result",e[0].dataType,N.length,v),V=[Se,_e];if(ve){let aa=a?v:1;V.push(C("bias",e[2].dataType,e[2].dims.length,aa))}let Z=[{name:"dim_a_outer",type:"i32"},{name:"dim_b_outer",type:"i32"},{name:"dim_inner",type:"i32"}];Ur(t,Z);let me=O(fe.type.tensor),De=Dr(t,fe.type.value,me),Be=qo(v,ve,De,[W,Se,_e,fe],a);return`
  ${ce.registerUniforms(Z).registerInternalVariables(W).declareVariables(...V,fe)}
  ${Be}
  ${w?Ja($,_,J,W):tn($,_,J,W)}
                   `};return{name:"MatMul",shaderCache:{hint:`${$};${t.activation};${w};${a}`,inputDependencies:H},getRunData:()=>({outputs:[{dims:n?n(r):r,dataType:e[0].dataType}],dispatchGroup:{x:y[0],y:y[1],z:y[2]},programUniforms:G}),getShaderSource:se}}}),Fo,Go,qp=k(()=>{"use strict";ue(),yt(),j(),Nr(),Qa(),Vp(),rn(),Fo=(e,t,r,i,a=!1,n,s=4,o=4,u=4,l="f32")=>{let p=G=>{switch(G){case 1:return"resData = x[xIndex];";case 3:return`resData = vec3<${l}>(x[xIndex], x[xIndex + 1], x[xIndex + 2]);`;case 4:return"resData = x[xIndex / 4];";default:throw new Error(`innerElementSize ${G} is not supported.`)}},d=G=>{switch(G){case 1:return"return w[row * i32(uniforms.w_shape[3]) + colIn];";case 4:return"return w[row * i32(uniforms.w_shape[3]) / 4 + colIn];";default:throw new Error(`innerElementSize ${G} is not supported.`)}},h=e?`
    let coord = vec4<i32>(batch, xRow, xCol, xCh);
    `:`
    let coord = vec4<i32>(batch, xCh, xRow, xCol);
    `,f=e?`
    let coords = vec4<i32>(
      batch,
      row / outWidth,
      row % outWidth,
      col);
    `:`
    let coords = vec4<i32>(
      batch,
      row,
      col / outWidth,
      col % outWidth);
    `,g=e?"i32(uniforms.x_shape[1])":"i32(uniforms.x_shape[2])",w=e?"i32(uniforms.x_shape[2])":"i32(uniforms.x_shape[3])",$=e?"row":"col",_=e?"col":"row",y=`
    let inChannels = i32(uniforms.w_shape[2]);
    let outWidth = ${e?"i32(uniforms.result_shape[2])":"i32(uniforms.result_shape[3])"};
    let outRow = ${$} / outWidth;
    let outCol = ${$} % outWidth;

    let WRow = ${_} / (i32(uniforms.w_shape[1]) * inChannels);
    let WCol = ${_} / inChannels % i32(uniforms.w_shape[1]);
    let xRow = outRow * uniforms.stride[0] + uniforms.dilation[0] * WRow - uniforms.pad[0];
    let xCol = outCol * uniforms.stride[1] + uniforms.dilation[1] * WCol - uniforms.pad[1];
    let xCh = ${_} % inChannels;
    var resData = ${it(s,l)}(0.0);
    // The bounds checking is always needed since we use it to pad zero for
    // the 'same' padding type.
    if (xRow >= 0 && xRow < ${g} && xCol >= 0 && xCol < ${w}) {
      ${h}
      let xIndex = getIndexFromCoords4D(coord, vec4<i32>(uniforms.x_shape));
      ${p(s)}
    }
    return resData;`,v=e?t&&i?`
    let col = colIn * ${s};
    ${y}`:`
    let col = colIn * ${s};
    if (row < uniforms.dim_a_outer && col < uniforms.dim_inner) {
      ${y}
    }
    return ${it(s,l)}(0.0);`:i&&r?`
    let col = colIn * ${s};
    ${y}`:`
    let col = colIn * ${s};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${y}
    }
    return ${it(s,l)}(0.0);`,x=e?i&&r?d(o):`
    let col = colIn * ${o};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${d(o)}
    }
    return ${it(o,l)}(0.0);`:`
    let col = colIn * ${o};
    if (row < uniforms.dim_inner && col < uniforms.dim_a_outer) {
      ${d(o)}
    }
    return ${it(o,l)}(0.0);`,I=it(u,l),B=it(e?s:o,l),R=it(e?o:s,l),N=Dr(n,I,l);return`
    fn mm_readA(batch: i32, row : i32, colIn : i32) -> ${B} {
      ${e?v:x}
    }

    fn mm_readB(batch: i32, row : i32, colIn : i32) -> ${R} {
      ${e?x:v}
    }

    fn mm_write(batch: i32, row : i32, colIn : i32, valueIn : ${I}) {
      let col = colIn * ${u};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer)
      {
      var value = valueIn;
      let outWidth = ${e?"i32(uniforms.result_shape[2])":"i32(uniforms.result_shape[3])"};
      ${f}
      ${Po(a)}
      ${N}
      setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
      }
    }`},Go=(e,t,r,i,a,n,s,o,u)=>{let l=t.format==="NHWC",p=l?e[0].dims[3]:e[0].dims[1],d=r[0],h=l?r[2]:r[3],f=l?r[1]:r[2],g=l?r[3]:r[1],w=l&&(p%4===0||p%3===0)&&g%4===0,$=l?g:h*f,_=l?h*f:g,y=[8,8,1],v=i<=8?[4,1,1]:[4,4,1],x=[Math.ceil($/y[0]/v[0]),Math.ceil(_/y[1]/v[1]),Math.ceil(d/y[2]/v[2])];ze("verbose",()=>`[conv2d_mm_webgpu] dispatch = ${x}`);let I=w?l&&p%4!==0?3:4:1,B=y[1]*v[1],R=y[0]*v[0],N=Math.max(y[0]*I,y[1]),G=i%B===0,H=a%R===0,ve=n%N===0,se=w?[I,4,4]:[1,1,1],ce=[{type:6,data:i},{type:6,data:a},{type:6,data:n},{type:6,data:[t.pads[0],t.pads[1]]},{type:6,data:t.strides},{type:6,data:t.dilations}];Pr(t,ce),ce.push(...E(e[0].dims,e[1].dims));let Me=["rank","rank"];s&&(ce.push(...E(e[2].dims)),Me.push("rank")),ce.push(...E(r));let W=J=>{let Se=[{name:"dim_a_outer",type:"i32"},{name:"dim_b_outer",type:"i32"},{name:"dim_inner",type:"i32"},{name:"pad",type:"i32",length:2},{name:"stride",type:"i32",length:2},{name:"dilation",type:"i32",length:2}];Ur(t,Se);let _e=w?4:1,fe=O(e[0].dataType),V=`
      fn setOutputAtIndex(flatIndex : i32, value : ${w?`vec4<${fe}>`:fe}) {
        result[flatIndex] = ${w?`vec4<${fe}>`:fe}(value);
      }
      fn setOutputAtCoords(d0 : i32, d1 : i32, d2 : i32, d3 : i32, value : ${w?`vec4<${fe}>`:fe}) {
        let flatIndex = getOutputIndexFromCoords(vec4<i32>(d0, d1, d2, d3));
        setOutputAtIndex(flatIndex ${w?"/ 4":""}, value);
      }`,Z=[C("x",e[0].dataType,e[0].dims.length,I===3?1:I),C("w",e[1].dataType,e[1].dims.length,_e)],me=F("result",e[0].dataType,r.length,_e);if(s){let De=C("bias",e[2].dataType,e[2].dims.length,_e);Z.push(De),V+=`
        fn getBiasByOutputCoords(coords : vec4<i32>) -> ${w?`vec4<${fe}>`:fe} {
          return bias[coords.${l?"w":"y"}${w?"/ 4":""}];
        }`}return`
        ${Uo("uniforms.result_strides")}
        //struct Uniforms { xShape : vec4<i32>, wShape : vec4<i32>, outShape : vec4<i32>,
        //  outShapeStrides: vec3<i32>, filterDims : vec2<i32>, pad : vec2<i32>, stride : vec2<i32>,
        //  dilation : vec2<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32 };
        ${J.registerUniforms(Se).declareVariables(...Z,me)}
        ${V}
        ${Fo(l,G,H,ve,s,t,se[0],se[1],se[2],fe)}
        ${w?Ja(v,y,fe,void 0,!l,N):tn(v,y,fe,void 0,!l,N,!1,void 0,o)}`};return{name:"Conv2DMatMul",shaderCache:{hint:`${t.cacheKey};${I};${w};${G};${H};${ve};${B};${R};${N}`,inputDependencies:Me},getRunData:()=>({outputs:[{dims:u?u(r):r,dataType:e[0].dataType}],dispatchGroup:{x:x[0],y:x[1],z:x[2]},programUniforms:ce}),getShaderSource:W}}}),Wo,an,Xi,Ho,nn,jo,Ko,Zo,Fp=k(()=>{"use strict";ue(),yt(),ne(),j(),Nr(),Qa(),Wo=e=>{let t=1;for(let r=0;r<e.length;r++)t*=e[r];return t},an=e=>typeof e=="number"?[e,e,e]:e,Xi=(e,t)=>t<=1?e:e+(e-1)*(t-1),Ho=(e,t,r,i=1)=>{let a=Xi(t,i);return Math.floor((e[0]*(r-1)-r+a)/2)},nn=(e,t,r,i,a)=>{a??=Ho(e,t[0],i[0]);let n=[0,0,0,r];for(let s=0;s<3;s++)e[s]+2*a>=t[s]&&(n[s]=Math.trunc((e[s]-t[s]+2*a)/i[s]+1));return n},jo=(e,t,r,i,a,n,s,o,u,l)=>{let p,d,h,f;if(e==="VALID"&&(e=0),typeof e=="number"){p={top:e,bottom:e,left:e,right:e,front:e,back:e};let g=nn([t,r,i,1],[o,u,l],1,[a,n,s],e);d=g[0],h=g[1],f=g[2]}else if(Array.isArray(e)){if(!e.every((w,$,_)=>w===_[0]))throw Error(`Unsupported padding parameter: ${e}`);p={top:e[0],bottom:e[1],left:e[2],right:e[3],front:e[4],back:e[5]};let g=nn([t,r,i,1],[o,u,l],1,[a,n,s],e[0]);d=g[0],h=g[1],f=g[2]}else if(e==="SAME_UPPER"){d=Math.ceil(t/a),h=Math.ceil(r/n),f=Math.ceil(i/s);let g=(d-1)*a+o-t,w=(h-1)*n+u-r,$=(f-1)*s+l-i,_=Math.floor(g/2),y=g-_,v=Math.floor(w/2),x=w-v,I=Math.floor($/2);p={top:v,bottom:x,left:I,right:$-I,front:_,back:y}}else throw Error(`Unknown padding parameter: ${e}`);return{padInfo:p,outDepth:d,outHeight:h,outWidth:f}},Ko=(e,t,r,i,a,n=!1,s="channelsLast")=>{let o,u,l,p,d;if(s==="channelsLast")[o,u,l,p,d]=e;else if(s==="channelsFirst")[o,d,u,l,p]=e;else throw new Error(`Unknown dataFormat ${s}`);let[h,,f,g,w]=t,[$,_,y]=an(r),[v,x,I]=an(i),B=Xi(f,v),R=Xi(g,x),N=Xi(w,I),{padInfo:G,outDepth:H,outHeight:ve,outWidth:se}=jo(a,u,l,p,$,_,y,B,R,N),ce=n?h*d:h,Me=[0,0,0,0,0];return s==="channelsFirst"?Me=[o,ce,H,ve,se]:s==="channelsLast"&&(Me=[o,H,ve,se,ce]),{batchSize:o,dataFormat:s,inDepth:u,inHeight:l,inWidth:p,inChannels:d,outDepth:H,outHeight:ve,outWidth:se,outChannels:ce,padInfo:G,strideDepth:$,strideHeight:_,strideWidth:y,filterDepth:f,filterHeight:g,filterWidth:w,effectiveFilterDepth:B,effectiveFilterHeight:R,effectiveFilterWidth:N,dilationDepth:v,dilationHeight:x,dilationWidth:I,inShape:e,outShape:Me,filterShape:t}},Zo=(e,t,r,i,a,n)=>{let s=n==="channelsLast";s?e[0].dims[3]:e[0].dims[1];let o=[64,1,1],u={x:r.map((w,$)=>$)},l=[Math.ceil(Wo(u.x.map(w=>r[w]))/o[0]),1,1];ze("verbose",()=>`[conv3d_naive_webgpu] dispatch = ${l}`);let p=1,d=[{type:12,data:M.size(r)},{type:12,data:i},{type:12,data:a},{type:12,data:t.strides},{type:12,data:t.dilations}];Pr(t,d),d.push(...E(e[0].dims,e[1].dims));let h=["rank","rank"],f=e.length===3;f&&(d.push(...E(e[2].dims)),h.push("rank")),d.push(...E(r));let g=w=>{let $=[{name:"output_size",type:"u32"},{name:"filter_dims",type:"u32",length:i.length},{name:"pads",type:"u32",length:a.length},{name:"strides",type:"u32",length:t.strides.length},{name:"dilations",type:"u32",length:t.dilations.length}];Ur(t,$);let _=1,y=O(e[0].dataType),v=C("x",e[0].dataType,e[0].dims.length,p),x=C("W",e[1].dataType,e[1].dims.length,_),I=[v,x],B=F("result",e[0].dataType,r.length,_),R="";if(f){let H=C("bias",e[2].dataType,e[2].dims.length,_);I.push(H),R+=`
        fn getBiasByOutputCoords(coords : array<u32, 5>) -> ${y} {
          return bias[${s?D("coords",4,5):D("coords",1,5)}];
        }`}let N=it(p,y),G=Dr(t,N,y);return`
            ${R}
            fn getX(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> f32 {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${v.getByIndices("aIndices")};
            }
            fn getW(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> f32 {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${x.getByIndices("aIndices")};
            }
          ${w.registerUniforms($).declareVariables(...I,B)}
          ${w.mainStart()}
          ${w.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
              let coords = ${B.offsetToIndices("global_idx")};
              let batch = ${D("coords",0,v.rank)};
              let d2 = ${s?D("coords",v.rank-1,v.rank):D("coords",1,v.rank)};
              let xFRCCorner = vec3<u32>(${s?D("coords",1,v.rank):D("coords",2,v.rank)},
              ${s?D("coords",2,v.rank):D("coords",3,v.rank)},
              ${s?D("coords",3,v.rank):D("coords",4,v.rank)}) * uniforms.strides - uniforms.pads;
              let xFCorner = xFRCCorner.x;
              let xRCorner = xFRCCorner.y;
              let xCCorner = xFRCCorner.z;
              let xShapeY = ${s?D("uniforms.x_shape",1,v.rank):D("uniforms.x_shape",2,v.rank)};
              let xShapeZ = ${s?D("uniforms.x_shape",2,v.rank):D("uniforms.x_shape",3,v.rank)};
              let xShapeW = ${s?D("uniforms.x_shape",3,v.rank):D("uniforms.x_shape",4,v.rank)};
              let xShapeU = ${s?D("uniforms.x_shape",4,v.rank):D("uniforms.x_shape",1,v.rank)};
              let inputDepthNearestVec4 = (xShapeU / 4) * 4;
              let inputDepthVec4Remainder = xShapeU % 4;

              var value = 0.0;
              for (var wF = 0u; wF < uniforms.filter_dims[0]; wF++) {
                let xF = xFCorner + wF * uniforms.dilations[0];
                if (xF < 0 || xF >= xShapeY) {
                  continue;
                }

                for (var wR = 0u; wR < uniforms.filter_dims[1]; wR++) {
                  let xR = xRCorner + wR * uniforms.dilations[1];
                  if (xR < 0 || xR >= xShapeZ) {
                    continue;
                  }

                  for (var wC = 0u; wC < uniforms.filter_dims[2]; wC++) {
                    let xC = xCCorner + wC * uniforms.dilations[2];
                    if (xC < 0 || xC >= xShapeW) {
                      continue;
                    }

                    for (var d1 = 0u; d1 < inputDepthNearestVec4; d1 += 4) {
                      ${s?`let xValues = vec4<f32>(
                               getX(batch, xF, xR, xC, d1),
                               getX(batch, xF, xR, xC, d1 + 1),
                               getX(batch, xF, xR, xC, d1 + 2),
                               getX(batch, xF, xR, xC, d1 + 3));
                            `:`let xValues = vec4<f32>(
                               getX(batch, d1, xF, xR, xC),
                               getX(batch, d1 + 1, xF, xR, xC),
                               getX(batch, d1 + 2, xF, xR, xC),
                               getX(batch, d1 + 3, xF, xR, xC));
                            `}
                            let wValues = vec4<f32>(
                              getW(d2, d1, wF, wR, wC),
                              getW(d2, d1 + 1, wF, wR, wC),
                              getW(d2, d1 + 2, wF, wR, wC),
                              getW(d2, d1 + 3, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                    if (inputDepthVec4Remainder == 1) {
                        ${s?`value += getX(batch, xF, xR, xC, inputDepthNearestVec4)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`:`value += getX(batch, inputDepthNearestVec4, xF, xR, xC)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`}
                    } else if (inputDepthVec4Remainder == 2) {
                      ${s?`let xValues = vec2<f32>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1));
                      `:`let xValues = vec2<f32>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC));
                    `}
                    let wValues = vec2<f32>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC));
                      value += dot(xValues, wValues);
                    } else if (inputDepthVec4Remainder == 3) {
                      ${s?`let xValues = vec3<f32>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 2));
                      `:`let xValues = vec3<f32>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 2, xF, xR, xC));
                    `}
                    let wValues = vec3<f32>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 2, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                  }
                }
              }
              ${f?"value = value + getBiasByOutputCoords(coords)":""};
              ${G}
              result[global_idx] = f32(value);
          }`};return{name:"Conv3DNaive",shaderCache:{hint:`${t.cacheKey};${s};${p};${f}`,inputDependencies:h},getRunData:()=>({outputs:[{dims:r,dataType:e[0].dataType}],dispatchGroup:{x:l[0],y:l[1],z:l[2]},programUniforms:d}),getShaderSource:g}}}),Qo,Xo,Gp=k(()=>{"use strict";ue(),ne(),j(),Nr(),Qo=(e,t,r,i)=>{let a=e.length>2,n=a?"value += b[output_channel];":"",s=e[0].dims,o=e[1].dims,u=t.format==="NHWC",l=u?r[3]:r[1],p=l/t.group,d=u&&p>=4?A(l):1,h=M.size(r)/d,f=[{type:12,data:h},{type:12,data:t.dilations},{type:12,data:[t.strides[0],t.strides[1]]},{type:12,data:[t.pads[0],t.pads[1]]},{type:12,data:p}];Pr(t,f),f.push(...E(s,[o[0],o[1],o[2],o[3]/d]));let g=a?["rank","rank","rank"]:["rank","rank"];f.push(...E([r[0],r[1],r[2],r[3]/d]));let w=$=>{let _=F("output",e[0].dataType,r.length,d),y=O(_.type.tensor),v=Dr(t,_.type.value,y),x=C("x",e[0].dataType,s.length),I=C("w",e[1].dataType,o.length,d),B=[x,I];a&&B.push(C("b",e[2].dataType,e[2].dims,d));let R=[{name:"output_size",type:"u32"},{name:"dilations",type:"u32",length:t.dilations.length},{name:"strides",type:"u32",length:2},{name:"pads",type:"u32",length:2},{name:"output_channels_per_group",type:"u32"}];Ur(t,R);let N=u?`
      for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[0]; wHeight++) {
        let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

        if (xHeight < 0u || xHeight >= uniforms.x_shape[1]) {
          continue;
        }

        for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[1]; wWidth++) {
          let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
          if (xWidth < 0u || xWidth >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[2]; wInChannel++) {
            let input_channel = in_channel_offset + wInChannel;
            let xVal = ${x.get("batch","xHeight","xWidth","input_channel")};
            let wVal = ${I.get("wHeight","wWidth","wInChannel","output_channel")};
            value += xVal * wVal;
          }
        }
      }
      `:`
      for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[1]; wInChannel++) {
        let input_channel = in_channel_offset + wInChannel;
        for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[2]; wHeight++) {
          let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

          if (xHeight < 0u || xHeight >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[3]; wWidth++) {
            let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
            if (xWidth < 0u || xWidth >= uniforms.x_shape[3]) {
              continue;
            }

            let xVal = ${x.get("batch","input_channel","xHeight","xWidth")};
            let wVal = ${I.get("output_channel","wInChannel","wHeight","wWidth")};
            value += xVal * wVal;
          }
        }
      }
      `;return`
  ${$.registerUniforms(R).declareVariables(...B,_)}

  ${$.mainStart()}
    ${$.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let outputIndices = ${_.offsetToIndices("global_idx")};
    let batch: u32 = outputIndices[0];
    let output_channel: u32 = outputIndices[${u?3:1}];
    let xRCCorner: vec2<u32> = vec2<u32>(outputIndices[${u?1:2}], outputIndices[${u?2:3}]) * uniforms.strides - uniforms.pads;
    let group_id: u32 = output_channel * ${d} / uniforms.output_channels_per_group;
    var in_channel_offset = group_id * uniforms.w_shape[${u?2:1}];

    var value: ${_.type.value} = ${_.type.value}(0);
    ${N}
    ${n}
    ${v}
    ${_.setByOffset("global_idx","value")}
  }`};return{name:"GroupedConv",shaderCache:{hint:`${t.cacheKey}_${d}`,inputDependencies:g},getRunData:()=>({outputs:[{dims:i?i(r):r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(h/64)},programUniforms:f}),getShaderSource:w}},Xo=(e,t,r,i)=>{let a=e.length>2,n=A(r[3]),s=A(r[2]),o=M.size(r)/n/s,u=[e[0].dims[0],e[0].dims[1],e[0].dims[2],e[0].dims[3]/n],l=[e[1].dims[0],e[1].dims[1],e[1].dims[2],e[1].dims[3]/n],p=[r[0],r[1],r[2],r[3]/n],d=[{type:12,data:o},{type:6,data:[t.strides[0],t.strides[1]]},{type:6,data:[t.pads[0],t.pads[1]]}];Pr(t,d),d.push(...E(u,l,p));let h=(s-1)*t.strides[1]+l[1],f=g=>{let w=F("output",e[0].dataType,p.length,n),$=O(w.type.tensor),_=Dr(t,w.type.value,$),y=C("x",e[0].dataType,u.length,n),v=C("w",e[1].dataType,l.length,n),x=[y,v];a&&x.push(C("b",e[2].dataType,e[2].dims,n));let I=a?"value += b[output_channel];":"",B=[{name:"output_size",type:"u32"},{name:"strides",type:"i32",length:2},{name:"pads",type:"i32",length:2}];return Ur(t,B),`
  ${g.registerUniforms(B).declareVariables(...x,w)}
  ${g.mainStart()}
    ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let width0 = uniforms.output_shape[3];
    let output_channel = global_idx % width0;
    var index1 = global_idx / width0;
    let width1 = uniforms.output_shape[2] / ${s}u;
    let col = (index1 % width1) * ${s}u;
    index1 = index1 / width1;
    let row = index1 % uniforms.output_shape[1];
    let batch = index1 / uniforms.output_shape[1];

    let x_corner = vec2<i32>(i32(row), i32(col)) * uniforms.strides - uniforms.pads;

    var x_vals: array<${y.type.value}, ${h}>;
    var values: array<${w.type.value}, ${s}>;
    let input_channel = output_channel;
    // Use constant instead of uniform can give better performance for w's height/width.
    for (var w_height: u32 = 0u; w_height < ${l[0]}; w_height++) {
      let x_height = x_corner.x + i32(w_height);
      if (x_height >= 0 && u32(x_height) < uniforms.x_shape[1]) {
        for (var i = 0; i < ${h}; i++) {
          let x_width = x_corner.y + i;
          if (x_width >= 0 && u32(x_width) < uniforms.x_shape[2]) {
            x_vals[i] = ${y.get("batch","u32(x_height)","u32(x_width)","input_channel")};
          } else {
            x_vals[i] = ${y.type.value}(0);
          }
        }
        for (var w_width: u32 = 0u; w_width < ${l[1]}; w_width++) {
          let w_val = ${v.get("w_height","w_width","0","output_channel")};
          for (var i = 0u; i < ${s}u; i++) {
            values[i] = fma(x_vals[i * u32(uniforms.strides[1]) + w_width], w_val, values[i]);
          }
        }
      }
    }

    for (var i = 0u; i < ${s}u; i++) {
      var value = values[i];
      ${I}
      ${_}
      ${w.set("batch","row","col + i","output_channel","value")};
    }
  }`};return{name:"GroupedConv-Vectorize",shaderCache:{hint:`${t.cacheKey};${n};${s};${h};${l[0]};${l[1]}`,inputDependencies:a?["rank","rank","type"]:["rank","rank"]},getRunData:()=>({outputs:[{dims:i?i(r):r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(o/64)},programUniforms:d}),getShaderSource:f}}}),Yo,wa,Jo,_a,sn,on,eu,tu,un,Wp=k(()=>{"use strict";ne(),qp(),Fp(),rn(),Gp(),Nr(),Ya(),we(),Yo=(e,t,r,i,a,n)=>{let s=e[0],o=e.slice(n?1:2,n?3:4),u=o.length,l=t[0],p=t.slice(2).map((h,f)=>h+(h-1)*(r[f]-1)),d=o.map((h,f)=>h+i[f]+i[f+u]).map((h,f)=>Math.floor((h-p[f]+a[f])/a[f]));return d.splice(0,0,s),d.splice(n?3:1,0,l),d},wa=[2,3,1,0],Jo=(e,t)=>{if(!e||e.length!==2&&e.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(e[0].dims.length>5)throw new Error("greater than 5D is not supported");if(e[0].dims.length!==e[1].dims.length)throw new Error("filter does not have same dimension as input");if(e[0].dims[t.format==="NHWC"?e[0].dims.length-1:1]!==e[1].dims[1]*t.group)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");if(e.length===3&&(e[2].dims.length!==1||e[1].dims[0]!==e[2].dims[0]))throw new Error("invalid bias");let r=e[0].dims.length-2;if(t.dilations.length!==r)throw new Error(`dilations should be ${r}D`);if(t.strides.length!==r)throw new Error(`strides should be ${r}D`);if(t.pads.length!==r*2)throw new Error(`pads should be ${r*2}D`);if(t.kernelShape.length!==0&&t.kernelShape.length!==e[1].dims.length-2)throw new Error("invalid kernel shape")},_a=(e,t)=>{let r=e.kernelShape.slice();r.length<t[1].dims.length-2&&r.push(...Array(t[1].dims.length-2-r.length).fill(0));for(let n=2;n<t[1].dims.length;++n)r[n-2]===0&&(r[n-2]=t[1].dims[n]);let i=e.pads.slice();Qt.adjustPadsBasedOnAutoPad(t[0].dims,e.strides,e.dilations,r,i,e.format==="NHWC",e.autoPad);let a=Object.assign({},e);return Object.assign(a,{kernelShape:r,pads:i}),a},sn=e=>{let t=Za(e),r=e.format;return{autoPad:["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][e.auto_pad],format:r,dilations:e.dilations,group:e.group,kernelShape:e.kernel_shape,pads:e.pads,strides:e.strides,wIsConst:e.w_is_const(),...t,cacheKey:`${e.format};${t.activation};`}},on=(e,t,r,i)=>{let a=r.format==="NHWC",n=Yo(t[0].dims,t[1].dims,r.dilations,r.pads,r.strides,a);if(r.group!==1){let B=[t[0]];if(a){let R=e.kernelCustomData.wT??e.compute(Fe(t[1],wa),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=R),B.push(R)}else B.push(t[1]);t.length===3&&B.push(t[2]),!e.adapterInfo.isArchitecture("ampere")&&a&&t[1].dims[0]===r.group&&t[1].dims[1]===1&&r.dilations[0]===1&&r.dilations[1]===1?e.compute(Xo(B,r,n,i),{inputs:B}):e.compute(Qo(B,r,n,i),{inputs:B});return}let s=t.length===3,o=t[0].dims[a?1:2],u=t[0].dims[a?2:3],l=t[0].dims[a?3:1],p=t[1].dims[2],d=t[1].dims[3],h=n[a?1:2],f=n[a?2:3],g=n[a?3:1],w=a&&p===o&&d===u&&r.pads[0]===0&&r.pads[1]===0;if(w||p===1&&d===1&&r.dilations[0]===1&&r.dilations[1]===1&&r.strides[0]===1&&r.strides[1]===1&&r.pads[0]===0&&r.pads[1]===0){let B=n[0],R,N,G,H=[];if(a){let ce=e.kernelCustomData.wT??e.compute(Fe(t[1],wa),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];if(r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=ce),w){let Me=o*u*l;R=t[0].reshape([1,B,Me]),N=ce.reshape([1,Me,g]),G=[1,B,g]}else R=t[0].reshape([B,o*u,l]),N=ce.reshape([1,l,g]),G=[B,h*f,g];H.push(R),H.push(N)}else R=t[0].reshape([B,l,o*u]),N=t[1].reshape([1,g,l]),G=[B,g,h*f],H.push(N),H.push(R);s&&H.push(t[2]);let ve=G[2],se=H[0].dims[H[0].dims.length-1];ve<8&&se<8?e.compute(Xa(H,r,n,G,a,i),{inputs:H}):e.compute(ya(H,r,n,G,a,i),{inputs:H});return}let $=!0,_=e.kernelCustomData.wT??e.compute(Fe(t[1],wa),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=_);let y=[t[0],_];s&&y.push(t[2]);let v=a?h*f:g,x=a?g:h*f,I=p*d*l;e.compute(Go(y,r,n,v,x,I,s,$,i),{inputs:y})},eu=(e,t)=>{let r=t.format==="NHWC",i=[e.inputs[0].reshape(r?[e.inputs[0].dims[0],1,e.inputs[0].dims[1],e.inputs[0].dims[2]]:[e.inputs[0].dims[0],e.inputs[0].dims[1],1,e.inputs[0].dims[2]]),e.inputs[1].reshape([e.inputs[1].dims[0],e.inputs[1].dims[1],1,e.inputs[1].dims[2]])];e.inputs.length===3&&i.push(e.inputs[2]);let a=[0,t.pads[0],0,t.pads[1]],n=[1].concat(t.strides),s=[1].concat(t.dilations),o=[1].concat(t.kernelShape),u=_a({...t,pads:a,strides:n,dilations:s,kernelShape:o},i);on(e,i,u,l=>r?[l[0],l[2],l[3]]:[l[0],l[1],l[3]])},tu=(e,t,r)=>{let i=r.format==="NHWC"?"channelsLast":"channelsFirst",a=_a(r,t),n=r.autoPad==="NOTSET"?r.pads:r.autoPad,s=Ko(t[0].dims,t[1].dims,r.strides,r.dilations,n,!1,i);e.compute(Zo(t,a,s.outShape,[s.filterDepth,s.filterHeight,s.filterWidth],[s.padInfo.front,s.padInfo.top,s.padInfo.left],i))},un=(e,t)=>{if(Jo(e.inputs,t),e.inputs[0].dims.length===3)eu(e,t);else if(e.inputs[0].dims.length===5)tu(e,e.inputs,t);else{let r=_a(t,e.inputs);on(e,e.inputs,r)}}}),ru,Hp=k(()=>{"use strict";ue(),yt(),ne(),j(),ru=(e,t,r)=>{let i=e.length>2,a=t.outputShape,n=t.format==="NHWC",s=t.group,o=e[1].dims,u=o[2]/s,l=o[3],p=n?A(u):1,d=n&&l===1&&u>=4,h=d?Math.floor(u/4)*4:Math.floor(u/p)*p,f=u-h,g=n?A(l):1,w=n?l===1?p:g:1,$=M.size(a)/g,_=[Math.ceil($/64),1,1];ze("verbose",()=>`[conv2d_backprop_webgpu] dispatch = ${_}`);let y=["rank","rank"],v=[t.strides[0],t.strides[1]],x=[t.kernelShape[n?1:2],t.kernelShape[n?2:3]],I=[t.dilations[0],t.dilations[1]],B=[x[0]+(t.dilations[0]<=1?0:(t.kernelShape[n?1:2]-1)*(t.dilations[0]-1)),x[1]+(t.dilations[1]<=1?0:(t.kernelShape[n?2:3]-1)*(t.dilations[1]-1))],R=[B[0]-1-Math.floor((t.pads[0]+t.pads[2])/2),B[1]-1-Math.floor((t.pads[1]+t.pads[3])/2)],N=[{type:12,data:$},{type:12,data:v},{type:12,data:x},{type:12,data:I},{type:12,data:B},{type:6,data:R},{type:12,data:h},{type:12,data:u},{type:12,data:l},...E(e[0].dims,e[1].dims)];i&&(N.push(...E(e[2].dims)),y.push("rank")),N.push(...E(a));let G=H=>{let ve=[{name:"output_size",type:"u32"},{name:"strides",type:"u32",length:v.length},{name:"filter_dims",type:"u32",length:x.length},{name:"dilations",type:"u32",length:x.length},{name:"effective_filter_dims",type:"u32",length:B.length},{name:"pads",type:"i32",length:R.length},{name:"input_channels_per_group_int",type:"u32"},{name:"input_channels_per_group",type:"u32"},{name:"output_channels_per_group",type:"u32"}],se=O(e[0].dataType),ce=n?1:2,Me=n?2:3,W=n?3:1,J=C("W",e[1].dataType,e[1].dims.length,w),Se=C("Dy",e[0].dataType,e[0].dims.length,p),_e=[Se,J];i&&_e.push(C("bias",e[2].dataType,[a[W]].length,g));let fe=F("result",e[0].dataType,a.length,g),V=()=>{let De="";if(d)p===4?De+=`
        let xValue = ${Se.getByOffset("x_offset")};
        let wValue = ${J.getByOffset("w_offset")};
        dotProd = dotProd + dot(xValue, wValue);
        x_offset += 1u;
        w_offset += 1u;`:p===2?De+=`
          dotProd = dotProd + dot(vec4<${se}>(${Se.getByOffset("x_offset")}, ${Se.getByOffset("x_offset + 1u")}), vec4<${se}>(${J.getByOffset("w_offset")}, ${J.getByOffset("w_offset + 1u")}));
          x_offset += 2u;
          w_offset += 2u;`:p===1&&(De+=`
          dotProd = dotProd + dot(vec4<${se}>(${Se.getByOffset("x_offset")}, ${Se.getByOffset("x_offset + 1u")}, ${Se.getByOffset("x_offset + 2u")}, ${Se.getByOffset("x_offset + 3u")}), vec4<${se}>(${J.getByOffset("w_offset")}, ${J.getByOffset("w_offset + 1u")}, ${J.getByOffset("w_offset + 2u")}, ${J.getByOffset("w_offset + 3u")}));
          x_offset += 4u;
          w_offset += 4u;`);else if(De+=`
                  let xValue = ${n?Se.getByOffset(`${Se.indicesToOffset(`${Se.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${p}`):Se.get("batch","inputChannel","idyR","idyC")};
        `,p===1)De+=`
          let w_offset = ${J.indicesToOffset(`${J.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel, wOutChannel)`)};
          let wValue = ${J.getByOffset(`w_offset / ${w}`)};
          dotProd = dotProd + xValue * wValue;`;else for(let Be=0;Be<p;Be++)De+=`
            let wValue${Be} = ${J.getByOffset(`${J.indicesToOffset(`${J.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel + ${Be}, wOutChannel)`)} / ${w}`)};
            dotProd = dotProd + xValue[${Be}] * wValue${Be};`;return De},Z=()=>{if(f===0)return"";if(!d)throw new Error(`packInputAs4 ${d} is not true.`);let De="";if(p===1){De+="dotProd = dotProd";for(let Be=0;Be<f;Be++)De+=`
            + ${Se.getByOffset(`x_offset + ${Be}`)} * ${J.getByOffset(`w_offset + ${Be}`)}`;De+=";"}else if(p===2){if(f!==2)throw new Error(`Invalid inputChannelsRemainder ${f}.`);De+=`
          let xValue = ${Se.getByOffset("x_offset")};
          let wValue = ${J.getByOffset("w_offset")};
          dotProd = dotProd + dot(xValue, wValue);`}return De},me=`
            let outputIndices = ${fe.offsetToIndices(`global_idx * ${g}`)};
            let batch = ${fe.indicesGet("outputIndices",0)};
            let d1 = ${fe.indicesGet("outputIndices",W)};
            let r = ${fe.indicesGet("outputIndices",ce)};
            let c = ${fe.indicesGet("outputIndices",Me)};
            let dyCorner = vec2<i32>(i32(r), i32(c)) - uniforms.pads;
            let dyRCorner = dyCorner.x;
            let dyCCorner = dyCorner.y;
            let groupId = d1 / uniforms.output_channels_per_group;
            let wOutChannel = d1 - groupId * uniforms.output_channels_per_group;
            // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
            // ? = to be determined. : = across all values in that axis.
            var dotProd = ${fe.type.value}(0.0);
            var wR: u32 = 0;
            if (uniforms.dilations.x == 1) {
              // Minimum wR >= 0 that satisfies (dyRCorner + wR) % (uniforms.strides.x) == 0
              wR = u32(((dyRCorner + i32(uniforms.strides.x) - 1) / i32(uniforms.strides.x)) * i32(uniforms.strides.x) - dyRCorner);
            }
            for (; wR < uniforms.effective_filter_dims.x; wR = wR + 1) {
              if (wR % uniforms.dilations.x != 0) {
                continue;
              }
              let dyR = (${se}(dyRCorner) + ${se}(wR)) / ${se}(uniforms.strides[0]);
              let wRPerm = uniforms.filter_dims.x - 1 - wR / uniforms.dilations.x;
              if (dyR < 0.0 || dyR >= ${se}(uniforms.Dy_shape[${ce}]) || fract(dyR) > 0.0 ||
                  wRPerm < 0) {
                continue;
              }
              let idyR: u32 = u32(dyR);
              var wC: u32 = 0;
              if (uniforms.dilations.y == 1) {
                // Minimum wC >= 0 that satisfies (dyCCorner + wC) % (uniforms.strides.y) == 0
                wC = u32(((dyCCorner + i32(uniforms.strides.y) - 1) / i32(uniforms.strides.y)) * i32(uniforms.strides.y) - dyCCorner);
              }
              for (; wC < uniforms.effective_filter_dims.y; wC = wC + 1) {
                if (wC % uniforms.dilations.y != 0) {
                  continue;
                }
                let dyC = (${se}(dyCCorner) + ${se}(wC)) / ${se}(uniforms.strides.y);
                let wCPerm = uniforms.filter_dims.y - 1 - wC / uniforms.dilations.y;
                if (dyC < 0.0 || dyC >= ${se}(uniforms.Dy_shape[${Me}]) ||
                    fract(dyC) > 0.0 || wCPerm < 0) {
                  continue;
                }
                let idyC: u32 = u32(dyC);
                var inputChannel = groupId * uniforms.input_channels_per_group;
                ${d?`
                var x_offset = ${Se.indicesToOffset(`${Se.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${p};
                var w_offset = ${J.indicesToOffset(`${J.type.indices}(wRPerm, wCPerm, inputChannel, wOutChannel)`)} / ${w};
                  `:""}
                for (var d2: u32 = 0; d2 < uniforms.input_channels_per_group_int; d2 = d2 + ${d?4:p}) {
                  ${V()}
                  inputChannel = inputChannel + ${d?4:p};
                }
                ${Z()}
                wC = wC + uniforms.strides.y - 1;
              }
              wR = wR + uniforms.strides[0] - 1;
            }
            let value = dotProd${i?` + bias[d1 / ${g}]`:""};
            ${fe.setByOffset("global_idx","value")};
          `;return`
    ${H.registerUniforms(ve).declareVariables(..._e,fe)}
      ${H.mainStart()}
      ${H.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")};
    ${me}}`};return{name:"ConvTranspose2D",shaderCache:{hint:`${t.cacheKey};${p}${w}${g}${d}${f}`,inputDependencies:y},getRunData:()=>({dispatchGroup:{x:_[0],y:_[1],z:_[2]},outputs:[{dims:r?r(a):a,dataType:e[0].dataType}],programUniforms:N}),getShaderSource:G}}}),iu,au,nu,ln,su,ou,dn,uu,lu,jp=k(()=>{"use strict";Hp(),Nr(),we(),iu=(e,t,r,i,a,n)=>(e-1)*t+r+(i-1)*a+1-n,au=(e,t,r,i,a)=>{let n=Math.floor(e/2);t==="SAME_UPPER"?(r[i]=n,r[a]=e-n):t==="SAME_LOWER"&&(r[i]=e-n,r[a]=n)},nu=(e,t,r,i,a,n,s,o,u,l)=>{let p=e.length-2,d=l.length===0;u.length<p&&u.push(...Array(p-u.length).fill(0));let h=e[0],f=t[o?3:1]*a;for(let g=0,w=e.length-p-(o?1:0);g<p;++g,++w){let $=e[w],_=d?$*s[g]:l[g],y=iu($,s[g],n[g],t[w],r[g],_);au(y,i,n,g,g+p),d&&l.push(s[g]*($-1)+u[g]+(t[w]-1)*r[g]+1-n[g]-n[g+p])}l.splice(0,0,h),l.splice(o?3:1,0,f)},ln=(e,t)=>{let r=e.kernelShape.slice();if(e.kernelShape.length===0||e.kernelShape.reduce((d,h)=>d*h,1)===0){r.length=0;for(let d=2;d<t[1].dims.length;++d)r.push(t[1].dims[d])}let i=e.format==="NHWC";r.splice(0,0,t[1].dims[0]),r.splice(i?3:1,0,t[1].dims[1]);let a=e.pads.slice(),n=e.outputShape.slice(),s=e.outputPadding.slice(),o=t[0].dims,u=e.dilations.slice();if(u.reduce((d,h)=>d+h,0)===0){let d=t[0].dims.length-2;u=new Array(d).fill(1)}let l=e.strides.slice();if(l.reduce((d,h)=>d+h,0)===0){let d=t[0].dims.length-2;l=new Array(d).fill(1)}nu(o,r,u,e.autoPad,e.group,a,l,i,s,n);let p=Object.assign({},e);return Object.assign(p,{kernelShape:r,pads:a,outputPadding:s,outputShape:n,dilations:u,strides:l}),p},su=e=>{let t=Za(e),r=e.format,i=["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][typeof e.autoPad>"u"?0:e.autoPad],a=e.dilations,n=e.group,s=e.kernelShape,o=e.pads,u=e.strides,l=e.wIsConst();return{autoPad:i,format:r,dilations:a,group:n,kernelShape:s,outputPadding:e.outputPadding,outputShape:e.outputShape,pads:o,strides:u,wIsConst:l,...t,cacheKey:`${e.format};${t.activation};`}},ou=(e,t)=>{if(!e||e.length!==2&&e.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(e[0].dims.length!==4&&e[0].dims.length!==3)throw new Error("currently only support 2-dimensional conv");if(e[0].dims.length!==e[1].dims.length)throw new Error("filter does not have same dimension as input");if(e[0].dims[t.format==="NHWC"?e[0].dims.length-1:1]!==e[1].dims[0])throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");let r=e[1].dims[1]*t.group;if(e.length===3&&(e[2].dims.length!==1||e[2].dims[0]!==r))throw new Error("invalid bias");let i=e[0].dims.length-2;if(t.dilations.reduce((a,n)=>a+n,0)>0&&t.dilations.length!==i)throw new Error(`dilations should be ${i}D`);if(t.strides.reduce((a,n)=>a+n,0)>0&&t.strides.length!==i)throw new Error(`strides should be ${i}D`);if(t.pads.reduce((a,n)=>a+n,0)>0&&t.pads.length!==i*2)throw new Error(`pads should be ${i*2}D`);if(t.outputPadding.length!==i&&t.outputPadding.length!==0)throw new Error(`output_padding should be ${i}D`);if(t.kernelShape.reduce((a,n)=>a+n,0)>0&&t.kernelShape.length!==0&&t.kernelShape.length!==e[1].dims.length-2)throw new Error("invalid kernel shape");if(t.outputShape.length!==0&&t.outputShape.length!==e[0].dims.length-2)throw new Error("invalid output shape")},dn=(e,t,r,i)=>{let a=e.kernelCustomData.wT??e.compute(Fe(t[1],[2,3,0,1]),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=a);let n=[t[0],a];t.length===3&&n.push(t[2]),e.compute(ru(n,r,i),{inputs:n})},uu=(e,t)=>{let r=t.format==="NHWC",i=[e.inputs[0].reshape(r?[e.inputs[0].dims[0],1,e.inputs[0].dims[1],e.inputs[0].dims[2]]:[e.inputs[0].dims[0],e.inputs[0].dims[1],1,e.inputs[0].dims[2]]),e.inputs[1].reshape([e.inputs[1].dims[0],e.inputs[1].dims[1],1,e.inputs[1].dims[2]])];e.inputs.length===3&&i.push(e.inputs[2]);let a=t.kernelShape;(a.length===0||a[0]===0)&&(a=[e.inputs[1].dims[2]]);let n=t.dilations;(n.length===0||n[0]===0)&&(n=[1]);let s=t.strides;(s.length===0||s[0]===0)&&(s=[1]);let o=t.pads;o.length===0&&(o=[0,0]),o=[0,o[0],0,o[1]],s=[1].concat(s),n=[1].concat(n),a=[1].concat(a);let u=t.outputPadding;u=[0].concat(u);let l=ln({...t,pads:o,strides:s,dilations:n,kernelShape:a,outputPadding:u},i);dn(e,i,l,p=>r?[p[0],p[2],p[3]]:[p[0],p[1],p[3]])},lu=(e,t)=>{if(ou(e.inputs,t),e.inputs[0].dims.length===3)uu(e,t);else{let r=ln(t,e.inputs);dn(e,e.inputs,r)}}}),du,pu,cu,Kp=k(()=>{"use strict";ue(),ne(),b(),j(),du=(e,t,r,i)=>{let a=M.size(t),n=t.length,s=C("input",e,n),o=F("output",e,n),u=r.dataType===6?r.getInt32Array()[0]:Number(r.getBigInt64Array()[0]),l=M.normalizeAxis(u,n),p=d=>{let h=` i32(${s.indicesGet("inputIndices","uniforms.axis")}) `,f=D("uniforms.input_shape","uniforms.axis",n),g=i.reverse?h+(i.exclusive?" + 1":""):"0",w=i.reverse?f:h+(i.exclusive?"":" + 1");return`
                ${d.registerUniform("outputSize","u32").registerUniform("axis","u32").declareVariables(s,o)}
                ${d.mainStart()}
                  ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
                  var inputIndices = ${o.offsetToIndices("global_idx")};
                  var sum = ${o.type.value}(0);
                  let first : i32 = ${g};
                  let last : i32 = ${w};
                  for (var i : i32 = first; i < last; i++) {
                    ${s.indicesSet("inputIndices","uniforms.axis","u32(i)")};
                    sum = sum + ${s.getByIndices("inputIndices")};
                  }
                  ${o.setByOffset("global_idx","sum")};
                }`};return{name:"CumSum",shaderCache:{hint:i.cacheKey,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:t,dataType:e}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:[{type:12,data:a},{type:12,data:l},...E(t,t)]}),getShaderSource:p}},pu=(e,t)=>{let r=e.inputs[0].dims,i=e.inputs[0].dataType,a=e.inputs[1];e.compute(du(i,r,a,t),{inputs:[0]})},cu=e=>{let t=e.exclusive===1,r=e.reverse===1;return m({exclusive:t,reverse:r})}}),hu,fu,mu,gu,yu,Zp=k(()=>{"use strict";ue(),ne(),b(),j(),hu=e=>{if(!e||e.length!==1)throw new Error("DepthToSpace requires 1 input.");if(e[0].dims.length!==4)throw new Error("DepthToSpace requires 4D input.")},fu=(e,t,r,i)=>{let a=[];a.push(`fn perm(i: ${i.type.indices}) -> ${r.type.indices} {
    var a: ${r.type.indices};`);for(let n=0;n<t;++n)a.push(r.indicesSet("a",e[n],`i[${n}]`));return a.push("return a;}"),a.join(`
`)},mu=(e,t)=>{let r,i,a,n,s,o,u=t.format==="NHWC",l=t.blocksize,p=t.mode==="DCR";u?([r,i,a,n]=e.dims,s=p?[r,i,a,l,l,n/l**2]:[r,i,a,n/l**2,l,l],o=p?[0,1,3,2,4,5]:[0,1,4,2,5,3]):([r,i,a,n]=[e.dims[0],e.dims[2],e.dims[3],e.dims[1]],s=p?[r,l,l,n/l**2,i,a]:[r,n/l**2,l,l,i,a],o=p?[0,3,4,1,5,2]:[0,1,4,2,5,3]);let d=e.reshape(s),h=d.dims.length,f=e.dataType,g=C("a",f,h),w=F("output",f,h),$=_=>`
  ${_.registerUniform("output_size","u32").declareVariables(g,w)}

  ${fu(o,h,g,w)}

  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${w.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${w.setByOffset("global_idx",g.getByIndices("aIndices"))}
  }`;return{name:"DepthToSpace",shaderCache:{hint:`${e.dims};${t.blocksize};${t.mode}`,inputDependencies:["rank"]},getRunData:_=>{let y=u?[r,i*l,a*l,n/l**2]:[r,n/l**2,i*l,a*l],v=M.size(y),x=d.dims,I=M.sortBasedOnPerm(x,o);return{outputs:[{dims:y,dataType:_[0].dataType}],dispatchGroup:{x:Math.ceil(v/64)},programUniforms:[{type:12,data:v},...E(x,I)]}},getShaderSource:$}},gu=(e,t)=>{hu(e.inputs),e.compute(mu(e.inputs[0],t))},yu=e=>m({blocksize:e.blocksize,mode:e.mode,format:e.format})}),ba,Yi,pn,wu,_u,bu,$u,cn,vu,xu,Su,Qp=k(()=>{"use strict";ue(),ne(),b(),j(),ba="[a-zA-Z]|\\.\\.\\.",Yi="("+ba+")+",pn="^"+Yi+"$",wu="("+Yi+",)*"+Yi,_u="^"+wu+"$",bu=class{constructor(e=-1){this.symbolToIndices=new Map,this.inputIndex=e}addSymbol(e,t){let r=this.symbolToIndices.get(e);r===void 0?r=[t]:r.push(t),this.symbolToIndices.set(e,r)}},$u=class{constructor(e,t){this.equation=t,this.hasEllipsis=!1,this.symbolToInfo=new Map,this.lhs=new Array,this.outputDims=[];let[r,i]=t.includes("->")?t.split("->",2):[t,""];if(!r.match(RegExp(_u)))throw new Error("Invalid LHS term");if(r.split(",").forEach((a,n)=>{let s=e[n].dims.slice();if(!a.match(RegExp(pn)))throw new Error("Invalid LHS term");let o=this.processTerm(a,!0,s,n);this.lhs.push(o)}),i==="")i+=[...this.symbolToInfo.entries()].filter(([a,n])=>n.count===1||a==="...").map(([a])=>a).join("");else if(!i.match(RegExp(Yi)))throw new Error("Invalid RHS");i.match(RegExp(ba,"g"))?.forEach(a=>{if(a==="...")this.outputDims=this.outputDims.concat(this.ellipsisDims);else{let n=this.symbolToInfo.get(a);if(n===void 0)throw new Error("Invalid RHS symbol");this.outputDims.push(n.dimValue)}}),this.rhs=this.processTerm(i,!1,this.outputDims)}addSymbol(e,t,r){let i=this.symbolToInfo.get(e);if(i!==void 0){if(i.dimValue!==t&&i.count!==1)throw new Error("Dimension mismatch");i.count++,i.inputIndices.push(r)}else i={count:1,dimValue:t,inputIndices:[r]};this.symbolToInfo.set(e,i)}processTerm(e,t,r,i=-1){let a=r.length,n=!1,s=[],o=0;if(!e.match(RegExp(pn))&&!t&&e!=="")throw new Error("Invalid LHS term");let u=e.match(RegExp(ba,"g")),l=new bu(i);return u?.forEach((p,d)=>{if(p==="..."){if(n)throw new Error("Only one ellipsis is allowed per input term");n=!0;let h=a-u.length+1;if(h<0)throw new Error("Ellipsis out of bounds");if(s=r.slice(o,o+h),this.hasEllipsis){if(this.ellipsisDims.length!==s.length||this.ellipsisDims.toString()!==s.toString())throw new Error("Ellipsis dimensions mismatch")}else if(t)this.hasEllipsis=!0,this.ellipsisDims=s;else throw new Error("Ellipsis must be specified in the LHS");for(let f=0;f<s.length;f++){let g=String.fromCharCode(48+f);l.addSymbol(g,d+f),this.addSymbol(g,r[o++],i)}}else l.addSymbol(p,d+(this.hasEllipsis?this.ellipsisDims.length-1:0)),this.addSymbol(p,r[o++],i)}),l}},cn=e=>e+"_max",vu=(e,t,r,i)=>{let a=e.map(l=>l.length).map((l,p)=>C(`input${p}`,t,l)),n=M.size(i),s=F("output",t,i.length),o=[...r.symbolToInfo.keys()].filter(l=>!r.rhs.symbolToIndices.has(l)),u=l=>{let p=[],d="var prod = 1.0;",h="var sum = 0.0;",f="sum += prod;",g=[],w=[],$=[],_=[],y=r.symbolToInfo.size===r.rhs.symbolToIndices.size;r.symbolToInfo.forEach((x,I)=>{if(r.rhs.symbolToIndices.has(I)){let B=r.rhs.symbolToIndices.get(I)?.[0];B!==void 0&&r.lhs.forEach((R,N)=>{if(x.inputIndices.includes(N)){let G=R.symbolToIndices.get(I);if(G===void 0)throw new Error("Invalid symbol error");G.forEach(H=>{p.push(`${a[N].indicesSet(`input${N}Indices`,H,s.indicesGet("outputIndices",B))}`)})}})}else r.lhs.forEach((B,R)=>{if(x.inputIndices.includes(R)){let N=B.symbolToIndices.get(I);if(N===void 0)throw new Error("Invalid symbol error");N.forEach(G=>{g.push(`${a[R].indicesSet(`input${R}Indices`,G,`${I}`)}`)}),_.push(`prod *= ${a[R].getByIndices(`input${R}Indices`)};`)}}),w.push(`for(var ${I}: u32 = 0; ${I} < uniforms.${cn(I)}; ${I}++) {`),$.push("}")});let v=y?[...p,`let sum = ${a.map((x,I)=>x.getByIndices(`input${I}Indices`)).join(" * ")};`]:[...p,h,...w,...g,d,..._,f,...$];return`
            ${l.registerUniforms(o.map(x=>({name:`${cn(x)}`,type:"u32"}))).registerUniform("outputSize","u32").declareVariables(...a,s)}

            ${l.mainStart()}
            ${l.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
            var outputIndices = ${s.offsetToIndices("global_idx")};
            ${a.map((x,I)=>`var input${I}Indices: ${a[I].type.indices};`).join(`
`)}
            ${v.join(`
`)};
            ${s.setByOffset("global_idx","sum")};
          }`};return{name:"Einsum",shaderCache:{hint:r.equation,inputDependencies:e.map(()=>"rank")},getRunData:()=>{let l=o.filter(d=>r.symbolToInfo.has(d)).map(d=>({type:12,data:r.symbolToInfo.get(d)?.dimValue||0}));l.push({type:12,data:n});let p=e.map((d,h)=>[...E(d)]).reduce((d,h)=>d.concat(h),l);return p.push(...E(i)),{outputs:[{dims:i,dataType:t}],dispatchGroup:{x:Math.ceil(n/64)},programUniforms:p}},getShaderSource:u}},xu=(e,t)=>{let r=new $u(e.inputs,t.equation),i=r.outputDims,a=e.inputs.map((n,s)=>n.dims);e.compute(vu(a,e.inputs[0].dataType,r,i))},Su=e=>{let t=e.equation.replace(/\s+/g,"");return m({equation:t})}}),Tu,hn,Eu,Iu,ku,Xp=k(()=>{"use strict";ue(),ne(),j(),Tu=e=>{if(!e||e.length!==2)throw new Error("Expand requires 2 input.");let t=e[0].dims,r=Array.from(e[1].getBigInt64Array(),Number),i=r.length<t.length?0:r.length-t.length,a=t.length<r.length?0:t.length-r.length;for(;i<r.length&&a<t.length;++i,++a)if(r[i]!==t[a]&&r[i]!==1&&t[a]!==1)throw new Error("Expand requires shape to be broadcastable to input")},hn=(e,t)=>{let r=e.length-t.length,i=[];for(let a=0;a<r;++a)i.push(e[a]);for(let a=0;a<t.length;++a)i.push(t[a]===1?e[a+r]:t[a]);return i},Eu=(e,t)=>e.length>t.length?hn(e,t):hn(t,e),Iu=e=>{let t=e[0].dims,r=Array.from(e[1].getBigInt64Array(),Number),i=Eu(t,r),a=e[0].dataType,n=a===9||M.size(t)===1,s=a===9||t.length>0&&t[t.length-1]%4===0?4:1,o=n||i.length>0&&i[i.length-1]%4===0?4:1,u=Math.ceil(M.size(i)/o),l=d=>{let h=C("input",a,t.length,s),f=F("output",a,i.length,o),g;if(a===9){let w=($,_,y="")=>`
          let outputIndices${_} = ${f.offsetToIndices(`outputOffset + ${_}u`)};
          let offset${_} = ${h.broadcastedIndicesToOffset(`outputIndices${_}`,f)};
          let index${_} = offset${_} / 4u;
          let component${_} = offset${_} % 4u;
          ${$}[${_}] = ${y}(${h.getByOffset(`index${_}`)}[component${_}]);
        `;g=`
        let outputOffset = global_idx * ${o};
        var data = vec4<u32>(0);
        ${w("data",0,"u32")}
        ${w("data",1,"u32")}
        ${w("data",2,"u32")}
        ${w("data",3,"u32")}
        ${f.setByOffset("global_idx","data")}
      }`}else g=`
        let outputIndices = ${f.offsetToIndices(`global_idx * ${o}`)};
        let inputOffset = ${h.broadcastedIndicesToOffset("outputIndices",f)};
        let data = ${f.type.value}(${h.getByOffset(`inputOffset / ${s}`)});
        ${f.setByOffset("global_idx","data")}
      }`;return`
    ${d.registerUniform("vec_size","u32").declareVariables(h,f)}
    ${d.mainStart()}
    ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
    ${g}`},p=[{type:12,data:u},...E(t,i)];return{name:"Expand",shaderCache:{hint:`${i.length};${s}${o}`,inputDependencies:["rank"]},getShaderSource:l,getRunData:()=>({outputs:[{dims:i,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:p})}},ku=e=>{Tu(e.inputs),e.compute(Iu(e.inputs),{inputs:[0]})}}),zu,Cu,Yp=k(()=>{"use strict";ue(),ne(),j(),Ka(),zu=e=>{let t=e[0].dataType,r=M.size(e[0].dims),i=M.size(e[1].dims),a=i%4===0,n=s=>{let o=C("x",t,[1],4),u=C("bias",t,[1],4),l=F("y",t,[1],4),p=[{name:"output_vec_size",type:"u32"},{name:"bias_size",type:"u32"}],d=f=>`
      let bias${f}_offset: u32 = (global_idx * 4 + ${f}) % uniforms.bias_size;
      let bias${f} = ${u.getByOffset(`bias${f}_offset / 4`)}[bias${f}_offset % 4];`,h=a?`
      let bias = ${u.getByOffset("global_idx % (uniforms.bias_size / 4)")};`:`${d(0)}${d(1)}${d(2)}${d(3)}
      let bias = ${o.type.value}(bias0, bias1, bias2, bias3);`;return`${s.registerUniforms(p).declareVariables(o,u,l)}

    ${Ha(z(t))}

    ${s.mainStart(T)}
      ${s.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_vec_size")}

      let x = ${o.getByOffset("global_idx")};
      ${h}
      let x_in = x + bias;
      ${l.setByOffset("global_idx",ja("x_in"))}
    }`};return{name:"FastGeluWithBias",shaderCache:{hint:`${a}`,inputDependencies:["type","type"]},getShaderSource:n,getRunData:s=>({outputs:[{dims:s[0].dims,dataType:s[0].dataType}],programUniforms:[{type:12,data:Math.ceil(r/4)},{type:12,data:i}],dispatchGroup:{x:Math.ceil(r/T/4)}})}},Cu=e=>{e.inputs.length<2||M.size(e.inputs[1].dims)===0?lo(e):e.compute(zu(e.inputs))}}),Au,Ou,Ru,Bu,Jp=k(()=>{"use strict";ue(),ne(),b(),j(),Au=e=>{if(!e||e.length!==2)throw new Error("Gather requires 2 inputs.")},Ou=(e,t)=>{let r=e[0].dims,i=e[1].dims,a=r.length,n=M.normalizeAxis(t.axis,a),s=r.slice(0);s.splice(n,1,...i);let o=r[n],u=e[0].dataType===9?4:1,l=Math.ceil(M.size(s)/u),p=[{type:12,data:l},{type:6,data:o},{type:12,data:n},...E(e[0].dims,e[1].dims,s)],d=h=>{let f=C("data",e[0].dataType,e[0].dims.length,u),g=C("inputIndices",e[1].dataType,e[1].dims.length),w=F("output",e[0].dataType,s.length,u),$=y=>{let v=i.length,x=`var indicesIndices${y}  = ${g.type.indices}(0);`;for(let I=0;I<v;I++)x+=`${v>1?`indicesIndices${y}[${I}]`:`indicesIndices${y}`} = ${s.length>1?`outputIndices${y}[uniforms.axis + ${I}]`:`outputIndices${y}`};`;x+=`
          var idx${y} = ${g.getByIndices(`indicesIndices${y}`)};
          if (idx${y} < 0) {
            idx${y} = idx${y} + uniforms.axisDimLimit;
          }
          var dataIndices${y} : ${f.type.indices};
        `;for(let I=0,B=0;I<a;I++)I===n?(x+=`${a>1?`dataIndices${y}[${I}]`:`dataIndices${y}`} = u32(idx${y});`,B+=v):(x+=`${a>1?`dataIndices${y}[${I}]`:`dataIndices${y}`} = ${s.length>1?`outputIndices${y}[${B}]`:`outputIndices${y}`};`,B++);return x},_;if(e[0].dataType===9){let y=(v,x,I="")=>`
          let outputIndices${x} = ${w.offsetToIndices(`outputOffset + ${x}u`)};
          ${$(x)};
          let offset${x} = ${f.indicesToOffset(`dataIndices${x}`)};
          let index${x} = offset${x} / 4u;
          let component${x} = offset${x} % 4u;
          ${v}[${x}] = ${I}(${f.getByOffset(`index${x}`)}[component${x}]);
        `;_=`
        let outputOffset = global_idx * ${u};
        var value = vec4<u32>(0);
        ${y("value",0,"u32")}
        ${y("value",1,"u32")}
        ${y("value",2,"u32")}
        ${y("value",3,"u32")}
        ${w.setByOffset("global_idx","value")}
      `}else _=`
      let outputIndices = ${w.offsetToIndices("global_idx")};
      ${$("")};
      let value = ${f.getByIndices("dataIndices")};
      ${w.setByOffset("global_idx","value")};
      `;return`
      ${h.registerUniform("outputSize","u32").registerUniform("axisDimLimit","i32").registerUniform("axis","u32").declareVariables(f,g,w)}
      ${h.mainStart()}
        ${h.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        ${_}
      }`};return{name:"Gather",shaderCache:{hint:t.cacheKey,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:s,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:p}),getShaderSource:d}},Ru=e=>m({axis:e.axis}),Bu=(e,t)=>{let r=e.inputs;Au(r),e.compute(Ou(e.inputs,t))}}),Mu,Du,Pu,ec=k(()=>{"use strict";ue(),ne(),j(),Mu=(e,t,r,i,a,n,s,o,u)=>{let l=[{type:12,data:n},{type:12,data:i},{type:12,data:a},{type:12,data:r},{type:12,data:s},{type:12,data:o},{type:12,data:u}],p=[n];l.push(...E(t.dims,p));let d=h=>{let f=[C("indices_data",t.dataType,t.dims.length),F("input_slice_offsets_data",12,1,1)],g=[{name:"output_size",type:"u32"},{name:"batch_dims",type:"u32"},{name:"input_dims",type:"u32",length:a.length},{name:"sizes_from_slice_dims_data",type:"u32",length:r.length},{name:"num_slices_per_batch",type:"u32"},{name:"input_batch_stride",type:"u32"},{name:"num_slice_dims",type:"u32"}];return`
  ${h.registerUniforms(g).declareVariables(...f)}
  ${h.mainStart()}
    ${h.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let batch_idx = global_idx / uniforms.num_slices_per_batch;
    let base_offset = batch_idx * uniforms.input_batch_stride;

    let slice_indices_base_offset = global_idx * uniforms.num_slice_dims;
    var relative_slice_offset = 0;
    for (var dim_idx = 0u; dim_idx < uniforms.num_slice_dims; dim_idx ++) {
      var index = i32(indices_data[dim_idx + slice_indices_base_offset].x);
      let input_dim_idx = uniforms.batch_dims + dim_idx;
      if (index < 0) {
        ${a.length===1?"index += i32(uniforms.input_dims);":"index += i32(uniforms.input_dims[input_dim_idx]);"}
      }
      ${r.length===1?"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data);":"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data[dim_idx]);"}
    }

    input_slice_offsets_data[global_idx] =  base_offset + u32(relative_slice_offset);
  }`};return e.compute({name:"computeSliceOffsets",shaderCache:{hint:`${a.length}_${r.length}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:p,dataType:e.inputs[1].dataType}],dispatchGroup:{x:Math.ceil(n/64)},programUniforms:l}),getShaderSource:d},{inputs:[t],outputs:[-1]})[0]},Du=(e,t)=>{let r=e.inputs,i=r[0].dims,a=r[0].dataType,n=r[1].dims,s=n[n.length-1],o=M.sizeToDimension(n,n.length-1),u=M.sizeFromDimension(i,t.batchDims+s),l=M.sizeToDimension(i,t.batchDims),p=M.sizeFromDimension(i,t.batchDims),d=o/l,h=new Array(s),f=u;for(let x=0;x<s;++x)h[s-1-x]=f,f*=i[t.batchDims+s-1-x];let g=Mu(e,r[1],h,t.batchDims,i,o,d,p,s),w=t.batchDims+s;if(w>i.length)throw new Error("last dimension of indices must not be larger than rank of input tensor");let $=n.slice(0,-1).concat(i.slice(w)),_=M.size($),y=[{type:12,data:_},{type:12,data:u},...E(r[0].dims,g.dims,$)],v=x=>{let I=C("data",r[0].dataType,r[0].dims.length),B=C("slice_offsets",12,g.dims.length),R=F("output",r[0].dataType,$.length);return`
          ${x.registerUniform("output_size","u32").registerUniform("slice_size","u32").declareVariables(I,B,R)}
            ${x.mainStart()}
            ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let slice_offset = slice_offsets[global_idx / uniforms.slice_size];
          output[global_idx] = data[u32(slice_offset) + global_idx % uniforms.slice_size];
        }`};e.compute({name:"GatherND",shaderCache:{hint:t.cacheKey,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:$,dataType:a}],dispatchGroup:{x:Math.ceil(_/64)},programUniforms:y}),getShaderSource:v},{inputs:[r[0],g]})},Pu=e=>({batchDims:e.batch_dims,cacheKey:""})}),Uu,Nu,Lu,Vu,tc=k(()=>{"use strict";ue(),ne(),b(),j(),Uu=(e,t)=>{if(e.length<3||e.length>4)throw new Error("GatherBlockQuantized requires 3 or 4 inputs.");let r=M.normalizeAxis(t.quantizeAxis,e[0].dims.length),i=t.blockSize,a=e[0],n=e[2],s=e.length===4?e[3]:void 0;if(n.dims.length!==a.dims.length||!a.dims.map((o,u)=>u===r?Math.ceil(o/i)===n.dims[u]:o===n.dims[u]).reduce((o,u)=>o&&u,!0))throw new Error("Scales must have the same rank as the input tensor and the dims should match except on gatherAxis.");if(s){if(s.dataType!==a.dataType)throw new Error("Zero point must have the same data type as the input tensor.");if(s.dims.length!==n.dims.length||!s.dims.map((o,u)=>o===n.dims[u]).reduce((o,u)=>o&&u,!0))throw new Error("Zero point must have the same rank as the input tensor and the dims should match except on quantizeAxis.")}},Nu=(e,t)=>{let r=e[0].dims,i=e[1].dims,a=r.length,n=M.normalizeAxis(t.gatherAxis,a),s=M.normalizeAxis(t.quantizeAxis,a),o=r.slice(0);o.splice(n,1,...i);let u=M.size(o),l=e[2].dataType,p=e[0].dataType===22,d=[{type:12,data:u},{type:12,data:s},{type:12,data:n},{type:12,data:t.blockSize},...E(...e.map((f,g)=>f.dims),o)],h=f=>{let g=C("data",e[0].dataType,e[0].dims.length),w=C("inputIndices",e[1].dataType,e[1].dims.length),$=C("scales",e[2].dataType,e[2].dims.length),_=e.length>3?C("zeroPoint",e[3].dataType,e[3].dims.length):void 0,y=F("output",l,o.length),v=[g,w,$];return _&&v.push(_),`
        ${f.registerUniforms([{name:"output_size",type:"u32"},{name:"quantize_axis",type:"u32"},{name:"gather_axis",type:"u32"},{name:"block_size",type:"u32"}]).declareVariables(...v,y)}
        ${f.mainStart()}
        let output_indices = ${y.offsetToIndices("global_idx")};
        var indices_indices = ${w.type.indices}(0);
        ${i.length>1?`
          for (var i: u32 = 0; i < ${i.length}; i++) {
            let index = ${y.indicesGet("output_indices","uniforms.gather_axis + i")};
            ${w.indicesSet("indices_indices","i","index")};
          }`:`indices_indices = ${y.indicesGet("output_indices","uniforms.gather_axis")};`};
        var data_indices = ${g.type.indices}(0);
        for (var i: u32 = 0; i < uniforms.gather_axis; i++) {
          let index = ${y.indicesGet("output_indices","i")};
          ${g.indicesSet("data_indices","i","index")};
        }
        var index_from_indices = ${w.getByIndices("indices_indices")};
        if (index_from_indices < 0) {
          index_from_indices += ${r[n]};
        }
        ${g.indicesSet("data_indices","uniforms.gather_axis","u32(index_from_indices)")};
        for (var i = uniforms.gather_axis + 1; i < ${o.length}; i++) {
          let index = ${y.indicesGet("output_indices",`i + ${i.length} - 1`)};
          ${g.indicesSet("data_indices","i","index")};
        }
        let data_offset = ${g.indicesToOffset("data_indices")};
        let data_index = data_offset % 8;
        // Convert 4-bit packed data to 8-bit packed data.
        let packed_4bit_quantized_data = ${g.getByOffset("data_offset / 8")};
        let packed_8bit_quantized_data = (packed_4bit_quantized_data >> (4 * (data_index % 2))) & 0x0f0f0f0f;
        let quantized_data_vec = ${p?"unpack4xI8":"unpack4xU8"}(u32(packed_8bit_quantized_data));
        let quantized_data = quantized_data_vec[data_index / 2];
        var scale_indices = data_indices;
        let quantize_axis_index = ${$.indicesGet("data_indices","uniforms.quantize_axis")} / uniforms.block_size;
        ${$.indicesSet("scale_indices","uniforms.quantize_axis","quantize_axis_index")};
        var scale = ${$.getByIndices("scale_indices")};
        ${_?`
              let zero_point_indices = scale_indices;
              let zero_point_offset = ${_.indicesToOffset("zero_point_indices")};
              let zero_point_index = zero_point_offset % 8;
              let packed_4bit_zero_points = ${_.getByOffset("zero_point_offset / 8")};
              let packed_8bit_zero_points = (packed_4bit_zero_points >> (4 * (zero_point_index % 2))) & 0x0f0f0f0f;
              let zero_point_vec = ${p?"unpack4xI8":"unpack4xU8"}(u32(packed_8bit_zero_points));
              let zero_point = zero_point_vec[zero_point_index / 2];`:"var zero_point = 0"};
        let dequantized_data = ${z(l)}(quantized_data - zero_point) * scale;
        ${y.setByOffset("global_idx","dequantized_data")};
    }`};return{name:"GatherBlockQuantized",shaderCache:{hint:`${t.cacheKey};${e.filter((f,g)=>g!==1).map(f=>f.dims.join("_")).join(";")}`,inputDependencies:Array.from({length:e.length},(f,g)=>"rank")},getRunData:()=>({outputs:[{dims:o,dataType:l}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:d}),getShaderSource:h}},Lu=(e,t)=>{let r=e.inputs;Uu(r,t),e.compute(Nu(e.inputs,t))},Vu=e=>m({blockSize:e.blockSize,gatherAxis:e.gatherAxis,quantizeAxis:e.quantizeAxis})}),qu,Fu,Gu,Wu,rc=k(()=>{"use strict";ue(),ne(),b(),j(),qu=e=>{if(!e||e.length!==2)throw new Error("GatherElements requires 2 inputs.");if(e[0].dims.length<1)throw new Error("GatherElements requires that the data input be rank >= 1.");if(e[0].dims.length!==e[1].dims.length)throw new Error(`GatherElements requires that the data input and
                     indices input tensors be of same rank.`)},Fu=(e,t)=>{let r=e[0].dims,i=e[0].dataType,a=r.length,n=e[1].dims,s=e[1].dataType,o=M.normalizeAxis(t.axis,a),u=r[o],l=n.slice(0),p=M.size(l),d=C("input",i,a),h=C("indicesInput",s,n.length),f=F("output",i,l.length),g=[{type:12,data:p},{type:6,data:u},{type:12,data:o}];return g.push(...E(r,n,l)),{name:"GatherElements",shaderCache:{inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:l,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(p/64)},programUniforms:g}),getShaderSource:w=>`
      ${w.registerUniform("outputSize","u32").registerUniform("axisDimLimit","i32").registerUniform("axis","u32").declareVariables(d,h,f)}
      ${w.mainStart()}
      ${w.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

      let outputIndices = ${f.offsetToIndices("global_idx")};

      var idx = ${h.getByOffset("global_idx")};
      if (idx < 0) {
        idx = idx + uniforms.axisDimLimit;
      }
      var inputIndices = ${d.type.indices}(outputIndices);
      ${d.indicesSet("inputIndices","uniforms.axis","u32(idx)")};
      let value = ${d.getByIndices("inputIndices")};

      ${f.setByOffset("global_idx","value")};
  }`}},Gu=e=>m({axis:e.axis}),Wu=(e,t)=>{let r=e.inputs;qu(r),e.compute(Fu(e.inputs,t))}}),Hu,ju,Ku,Zu,ic=k(()=>{"use strict";ue(),ne(),j(),Hu=e=>{if(!e)throw new Error("Input is missing");if(e.length<2||e.length>3)throw new Error("Invaid input number.");if(e.length===3&&e[2].dims.length>2)throw new Error("Invalid input shape of C");if(e[0].dataType!==e[1].dataType||e.length===3&&e[0].dataType!==e[2].dataType)throw new Error("Input types are mismatched")},ju=(e,t)=>{let r=e[0].dims.slice(),i=e[1].dims.slice(),[a,n,s]=Qr.getShapeOfGemmResult(r,t.transA,i,t.transB,e.length===3?e[2].dims:void 0),o=[a,n];if(!o)throw new Error("Can't use gemm on the given tensors");let u=16,l=Math.ceil(n/u),p=Math.ceil(a/u);M.size(o);let d=[{type:12,data:l},{type:12,data:a},{type:12,data:n},{type:12,data:s},{type:1,data:t.alpha},{type:1,data:t.beta}],h=["type","type"];e.length===3&&(d.push(...E(e[2].dims)),h.push("rank")),d.push(...E(o));let f=g=>{let w=C("a",e[0].dataType,e[0].dims),$=C("b",e[1].dataType,e[1].dims),_=null,y=[w,$];e.length===3&&(_=C("c",e[2].dataType,e[2].dims.length),y.push(_));let v=F("output",e[0].dataType,o.length);y.push(v);let x=[{name:"num_tile_n",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"},{name:"alpha",type:"f32"},{name:"beta",type:"f32"}],I="",B="";t.transA&&t.transB?(B=`
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${w.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,I="value += tile_a[k][local_id.y] * tile_b[local_id.x][k];"):t.transA&&!t.transB?(B=`
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${w.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,I="value += tile_a[k][local_id.y] * tile_b[k][local_id.x];"):!t.transA&&t.transB?(B=`
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${w.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,I="value += tile_a[local_id.y][k] * tile_b[local_id.x][k];"):!t.transA&&!t.transB&&(B=`
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${w.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,I="value += tile_a[local_id.y][k] * tile_b[k][local_id.x];");let R=t.alpha===1?"":"value *= uniforms.alpha;";return`
  ${g.registerUniforms(x).declareVariables(...y)}
  var<workgroup> tile_a: array<array<${w.type.storage}, ${u}>, ${u}>;
  var<workgroup> tile_b: array<array<${$.type.storage}, ${u}>, ${u}>;
  ${g.mainStart([u,u,1])}
    let tile_col_start = (workgroup_index % uniforms.num_tile_n) * ${u};
    let tile_row_start = (workgroup_index / uniforms.num_tile_n) * ${u};
    let num_tiles = (uniforms.K - 1) / ${u} + 1;
    var k_start = 0u;
    var value = ${v.type.value}(0);
    for (var t: u32 = 0u; t < num_tiles; t++) {
      ${B}
      k_start = k_start + ${u};
      workgroupBarrier();

      for (var k: u32 = 0u; k < ${u}; k++) {
        ${I}
      }
      workgroupBarrier();
    }

    ${R}
    let m = tile_row_start + local_id.y;
    let n = tile_col_start + local_id.x;
    ${_!=null?`let cOffset = ${_.broadcastedIndicesToOffset("vec2(m, n)",v)}; value += ${v.type.value}(uniforms.beta) * ${_.getByOffset("cOffset")};`:""}
    if (m < uniforms.M && n < uniforms.N) {
      output[m * uniforms.N + n] = value;
    }
  }`};return{name:"GemmShared",shaderCache:{hint:`${t.cacheKey}`,inputDependencies:h},getRunData:()=>({outputs:[{dims:o,dataType:e[0].dataType}],dispatchGroup:{x:l*p},programUniforms:d}),getShaderSource:f}},Ku=e=>({transA:e.transA,transB:e.transB,alpha:e.alpha,beta:e.beta,cacheKey:`${e.transA};${e.transB};${e.alpha===1}`}),Zu=(e,t)=>{Hu(e.inputs),e.compute(ju(e.inputs,t))}}),qt,Kt,Lr,Vr,Qu,Xu,Yu,Ju,el,tl,rl,il,al,nl,ac=k(()=>{"use strict";ue(),ne(),b(),j(),[qt,Kt,Lr,Vr]=[0,1,2,3],Qu=e=>{if(e[0].dims.length!==4)throw new Error("only 4-D tensor is supported.");if(e[0].dims.length!==e[1].dims.length)throw new Error("input dimensions must be equal to grid dimensions");if(e[0].dims.length-2!==e[1].dims[e[1].dims.length-1])throw new Error(`last dimension of grid must be equal to ${e[0].dims.length-2}`);if(e[0].dims[0]!==e[1].dims[0])throw new Error("grid batch size must match input batch size")},Xu=`
  fn gs_get_cubic_coeffs(x: f32) -> vec4<f32> {
    let cubic_alpha = -0.75f;
    let x_abs = abs(x);
    var coeffs: vec4<f32>;
    coeffs[0] = (((cubic_alpha * (x_abs + 1) - 5 * cubic_alpha) * (x_abs + 1) + 8 * cubic_alpha) * (x_abs + 1) - 4 * cubic_alpha);
    coeffs[1] = (((cubic_alpha + 2) * x_abs - (cubic_alpha + 3)) * x_abs * x_abs + 1);
    coeffs[2] = (((cubic_alpha + 2) * (1 - x_abs) - (cubic_alpha + 3)) * (1 - x_abs) * (1 - x_abs) + 1);
    coeffs[3] = (((cubic_alpha * (2 - x_abs) - 5 * cubic_alpha) * (2 - x_abs) + 8 * cubic_alpha) * (2 - x_abs) - 4 * cubic_alpha);
    return coeffs;
  }
`,Yu=e=>`
  fn gs_bicubic_interpolate(p: mat4x4<${e}>, x: f32, y: f32) -> ${e} {
    var v: vec4<f32>;
    var coeffs = gs_get_cubic_coeffs(x);
    for (var i = 0; i < 4; i++) {
      v[i] = coeffs[0] * p[i][0] + coeffs[1] * p[i][1] + coeffs[2] * p[i][2] + coeffs[3] * p[i][3];
    }
    coeffs = gs_get_cubic_coeffs(y);
    let pixel = ${e}(coeffs[0] * v[0] + coeffs[1] * v[1] + coeffs[2] * v[2] + coeffs[3] * v[3]);
    return pixel;
  }
`,Ju=e=>`
  fn gs_denormalize(n: f32, length: i32) -> f32 {
    ${e.alignCorners===0?`
    // alignCorners: false => [-1, 1] to [-0.5, length - 0.5]
    return ((n + 1.0) * f32(length) - 1.0) / 2.0;
    `:`
    // alignCorners: true => [-1, 1] to [0, length - 1]
    return (n + 1.0) / 2.0 * (f32(length - 1));
    `}
  }
`,el=e=>`
  ${e.paddingMode==="reflection"?`
      fn gs_reflect(x: i32, x_min: f32, x_max: f32) -> u32 {
        var dx = 0.0;
        var fx = f32(x);
        let range = x_max - x_min;
        if (fx < x_min) {
          dx = x_min - fx;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_min + r;
          } else {
            fx = x_max - r;
          }
        } else if (fx > x_max) {
          dx = fx - x_max;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_max - r;
          } else {
            fx = x_min + r;
          }
        }
        return u32(fx);
      }`:""}
`,tl=(e,t,r)=>`
  fn pixel_at_grid(r: i32, c: i32, H: i32, W: i32, batch: u32, channel: u32, border: vec4<f32>) -> ${t} {
     var pixel = ${t}(0);
     var indices = vec4<u32>(0);
     indices[${qt}] = batch;
     indices[${Kt}] = channel;`+(()=>{switch(r.paddingMode){case"zeros":return`
          if (r >= 0 && r < H && c >=0 && c < W) {
            indices[${Lr}] = u32(r);
            indices[${Vr}] = u32(c);
          } else {
            return ${t}(0);
          }
        `;case"border":return`
          indices[${Lr}] = u32(clamp(r, 0, H - 1));
          indices[${Vr}] = u32(clamp(c, 0, W - 1));
        `;case"reflection":return`
          indices[${Lr}] = gs_reflect(r, border[1], border[3]);
          indices[${Vr}] = gs_reflect(c, border[0], border[2]);
        `;default:throw new Error(`padding mode ${r.paddingMode} is not supported`)}})()+`
    return ${e.getByIndices("indices")};
  }
`,rl=(e,t,r)=>(()=>{switch(r.mode){case"nearest":return`
          let result = pixel_at_grid(i32(round(y)), i32(round(x)), H_in, W_in, indices[${qt}], indices[${Kt}], border);
        `;case"bilinear":return`
          let x1 = i32(floor(x));
          let y1 = i32(floor(y));
          let x2 = x1 + 1;
          let y2 = y1 + 1;

          let p11 = pixel_at_grid(y1, x1, H_in, W_in, indices[${qt}], indices[${Kt}], border);
          let p12 = pixel_at_grid(y1, x2, H_in, W_in, indices[${qt}], indices[${Kt}], border);
          let p21 = pixel_at_grid(y2, x1, H_in, W_in, indices[${qt}], indices[${Kt}], border);
          let p22 = pixel_at_grid(y2, x2, H_in, W_in, indices[${qt}], indices[${Kt}], border);

          let dx2 = ${t}(f32(x2) - x);
          let dx1 = ${t}(x - f32(x1));
          let dy2 = ${t}(f32(y2) - y);
          let dy1 = ${t}(y - f32(y1));
          let result = dy2 * (dx2 * p11 + dx1 * p12) + dy1 * (dx2 * p21 + dx1 * p22);
        `;case"bicubic":return`
          let x0 = i32(floor(x)) - 1;
          let y0 = i32(floor(y)) - 1;
          var p: mat4x4<${t}>;
          for (var h = 0; h < 4; h++) {
            for (var w = 0; w < 4; w++) {
              p[h][w] = pixel_at_grid(h + y0, w + x0, H_in, W_in, indices[${qt}], indices[${Kt}], border);
            }
          }

          let dx = x - f32(x0 + 1);
          let dy = y - f32(y0 + 1);
          let result = gs_bicubic_interpolate(p, dx, dy);
        `;default:throw new Error(`mode ${r.mode} is not supported`)}})()+`${e.setByOffset("global_idx","result")}`,il=(e,t)=>{let r=C("x",e[0].dataType,e[0].dims.length),i=[e[1].dims[0],e[1].dims[1],e[1].dims[2]],a=C("grid",e[1].dataType,i.length,2),n=[e[0].dims[0],e[0].dims[1],e[1].dims[1],e[1].dims[2]];t.format==="NHWC"&&(n=[e[0].dims[0],e[1].dims[1],e[1].dims[2],e[0].dims[3]],[qt,Kt,Lr,Vr]=[0,3,1,2]);let s=F("output",e[0].dataType,n.length),o=r.type.value,u=[{type:12,data:M.size(n)},...E(e[0].dims,i,n)],l=p=>`
  ${p.registerUniform("output_size","u32").declareVariables(r,a,s)}
  ${Xu}
  ${Yu(o)}
  ${Ju(t)}
  ${el(t)}
  ${tl(r,o,t)}

  ${p.mainStart()}
    ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let H_in = i32(uniforms.x_shape[${Lr}]);
      let W_in = i32(uniforms.x_shape[${Vr}]);

      ${t.alignCorners===0?`
      let x_min = -0.5;
      let x_max = f32(W_in) - 0.5;
      let y_min = -0.5;
      let y_max = f32(H_in) - 0.5;
      `:`
      let x_min = 0.0;
      let x_max = f32(W_in) - 1.0;
      let y_min = 0.0;
      let y_max = f32(H_in) - 1.0;
      `};
      let border = vec4<f32>(x_min, y_min, x_max, y_max);

      let indices = ${s.offsetToIndices("global_idx")};
      var grid_indices = vec3<u32>(indices[${qt}], indices[${Lr}], indices[${Vr}]);
      let nxy = ${a.getByIndices("grid_indices")};
      var x = gs_denormalize(f32(nxy[0]), W_in);
      var y = gs_denormalize(f32(nxy[1]), H_in);

      ${rl(s,o,t)}
  }`;return{name:"GridSample",shaderCache:{hint:`${t.cacheKey}`,inputDependencies:["type","type"]},getRunData:p=>{let d=M.size(n);return{outputs:[{dims:n,dataType:p[0].dataType}],dispatchGroup:{x:Math.ceil(d/64)},programUniforms:u}},getShaderSource:l}},al=(e,t)=>{Qu(e.inputs),e.compute(il(e.inputs,t))},nl=e=>m({alignCorners:e.align_corners,mode:e.mode,paddingMode:e.padding_mode,format:e.format})}),pt,sl,ol,fn,ul,Ji,ll,dl=k(()=>{"use strict";ue(),ne(),b(),ei(),Ga(),j(),we(),pt=(e,t)=>e.length>t&&e[t].dims.length>0?e[t]:void 0,sl=(e,t)=>{let r=e[0],i=pt(e,1),a=pt(e,2),n=pt(e,3),s=pt(e,4),o=pt(e,5),u=pt(e,6),l=pt(e,7);if(r.dims.length!==3&&r.dims.length!==5)throw new Error("Input query is expected to have 3 or 5 dimensions");let p=r.dims[0],d=r.dims[1],h=r.dims.length===3?r.dims[2]:t.numHeads*r.dims[4],f=d,g=0,w=0,$=Math.floor(h/t.numHeads);if(u&&l&&M.size(u.dims)&&M.size(l.dims)){if(u.dims.length!==4)throw new Error('Input "past_key" is expected to have 4 dimensions');if(u.dims[0]!==p||u.dims[1]!==t.numHeads||u.dims[3]!==$)throw new Error('Input "past_key" shape (batch_size, num_heads, past_sequence_length, head_size)');if(l.dims[0]!==p||l.dims[1]!==t.numHeads||l.dims[3]!==$)throw new Error('Input "past_value" shape (batch_size, num_heads, past_sequence_length, head_size)');if(u.dims[2]!==l.dims[2])throw new Error('Input "past_key" and "past_value" shall have same dim 2 (past_sequence_length)');if(l.dims.length!==4)throw new Error('Input "past_value" is expected to have 4 dimensions');g=u.dims[2],w=u.dims[2]}else if(u&&M.size(u.dims)||l&&M.size(l.dims))throw new Error('Input "past_key" and "past_value" shall be both present or both absent');let _;if(i&&M.size(i.dims)>0){if(r.dims.length!==3)throw new Error('Input "query" is expected to have 3 dimensions when key is given');if(i.dims.length<3||i.dims.length>5)throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');if(r.dims[0]!==i.dims[0])throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');if(i.dims.length===3){if(i.dims[2]!==r.dims[2])throw new Error('Input "query" and "key" shall have same dim 2 (hidden_size)');_=2,f=i.dims[1]}else if(i.dims.length===5){if(i.dims[2]!==t.numHeads||i.dims[3]!==2||i.dims[4]!==$)throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');if(a)throw new Error('Expect "value" be none when "key" has packed kv format.');_=5,f=i.dims[1]}else{if(i.dims[1]!==t.numHeads||i.dims[3]!==$)throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');_=0,f=i.dims[2]}}else{if(r.dims.length!==5)throw new Error('Input "query" is expected to have 5 dimensions when key is empty');if(r.dims[2]!==t.numHeads||r.dims[3]!==3)throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');_=3}if(n&&M.size(n.dims)>0){if(n.dims.length!==1)throw new Error('Input "bias" is expected to have 1 dimension');if(i&&i.dims.length===5&&i.dims[3]===2)throw new Error("bias is not allowed for packed kv.")}let y=g+f,v=0;if(s&&M.size(s.dims)>0){v=8;let R=s.dims;throw R.length===1?R[0]===p?v=1:R[0]===3*p+2&&(v=3):R.length===2&&R[0]===p&&R[1]===y&&(v=5),v===8?new Error('Input "key_padding_mask" shape shall be (batch_size) or (batch_size, total_sequence_length)'):new Error("Mask not supported")}let x=!1,I=h;if(a&&M.size(a.dims)>0){if(a.dims.length!==3&&a.dims.length!==4)throw new Error('Input "value" is expected to have 3 or 4 dimensions');if(r.dims[0]!==a.dims[0])throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');if(a.dims.length===3){if(f!==a.dims[1])throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');I=a.dims[2]}else{if(f!==a.dims[2])throw new Error('Input "key" and "value" shall have the same dim 2 (kv_sequence_length)');I=a.dims[1]*a.dims[3],x=!0}}let B=!1;if(s&&M.size(s.dims)>0)throw new Error("Key padding mask is not supported");if(o&&M.size(o.dims)>0){if(o.dims.length!==4)throw new Error('Input "attention_bias" is expected to have 4 dimensions');if(o.dims[0]!==p||o.dims[1]!==t.numHeads||o.dims[2]!==d||o.dims[3]!==y)throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)')}return{batchSize:p,sequenceLength:d,pastSequenceLength:g,kvSequenceLength:f,totalSequenceLength:y,maxSequenceLength:w,inputHiddenSize:0,hiddenSize:h,vHiddenSize:I,headSize:$,vHeadSize:Math.floor(I/t.numHeads),numHeads:t.numHeads,isUnidirectional:!1,pastPresentShareBuffer:!1,maskFilterValue:t.maskFilterValue,maskType:v,scale:t.scale,broadcastResPosBias:B,passPastInKv:x,qkvFormat:_}},ol=e=>m({...e}),fn=m({perm:[0,2,1,3]}),ul=(e,t,r,i,a,n,s)=>{let o=[i,a,n],u=M.size(o),l=[{type:12,data:u},{type:12,data:s},{type:12,data:n}],p=d=>{let h=F("qkv_with_bias",t.dataType,o),f=C("qkv",t.dataType,o),g=C("bias",r.dataType,o);return`
  ${d.registerUniforms([{name:"output_size",type:"u32"},{name:"bias_offset",type:"u32"},{name:"hidden_size",type:"u32"}]).declareVariables(f,g,h)}
  ${d.mainStart()}
    ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let bias_offset_idx = (global_idx % uniforms.hidden_size) + uniforms.bias_offset;

    qkv_with_bias[global_idx] = qkv[global_idx] + bias[bias_offset_idx];
  }`};return e.compute({name:"MultiHeadAttentionAddBias",shaderCache:{inputDependencies:["type","type"]},getRunData:()=>({outputs:[{dims:o,dataType:t.dataType,gpuDataType:0}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:l}),getShaderSource:p},{inputs:[t,r],outputs:[-1]})[0]},Ji=(e,t,r,i,a,n,s,o)=>{let u=n;if(s&&M.size(s.dims)>0){if(i===1)throw new Error("AddBiasReshape is not implemented. Please export your model with packed QKV or KV");return u=ul(e,n,s,t,i,r*a,o),u=u.reshape([t,i,r,a]),r===1||i===1?u:e.compute(Fe(u,fn.perm),{inputs:[u],outputs:[-1]})[0]}else return n.dims.length===3&&(u=n.reshape([t,i,r,a])),r===1||i===1?u:e.compute(Fe(u,fn.perm),{inputs:[u],outputs:[-1]})[0]},ll=(e,t)=>{let r=sl(e.inputs,t),i=e.inputs[0],a=pt(e.inputs,1),n=pt(e.inputs,2),s=pt(e.inputs,3),o=pt(e.inputs,4),u=pt(e.inputs,5),l=pt(e.inputs,6),p=pt(e.inputs,7);if(i.dims.length===5)throw new Error("Packed QKV is not implemented");if(a?.dims.length===5)throw new Error("Packed KV is not implemented");let d=a&&n&&a.dims.length===4&&n.dims.length===4,h=Ji(e,r.batchSize,r.numHeads,r.sequenceLength,r.headSize,i,s,0);if(d)return Ki(e,h,a,n,o,void 0,l,p,u,r);if(!a||!n)throw new Error("key and value must be provided");let f=Ji(e,r.batchSize,r.numHeads,r.kvSequenceLength,r.headSize,a,s,r.hiddenSize),g=Ji(e,r.batchSize,r.numHeads,r.kvSequenceLength,r.vHeadSize,n,s,2*r.hiddenSize);Ki(e,h,f,g,o,void 0,l,p,u,r)}}),pl,cl,hl,fl,mn,ml,gl,yl=k(()=>{"use strict";ue(),ne(),b(),j(),pl=e=>{if(!e||e.length<1)throw new Error("too few inputs")},cl=(e,t)=>{let r=[],i=t.numOutputs;return e[1].dims[0]>0&&(e[1].getBigInt64Array().forEach(a=>r.push(Number(a))),i=r.length),m({numOutputs:i,axis:t.axis,splitSizes:r})},hl=e=>`
fn calculateOutputIndex(index: u32) -> u32 {
    for (var i: u32 = 0u; i < ${e}u; i += 1u ) {
    if (index < ${D("uniforms.size_in_split_axis","i",e)}) {
        return i;
    }
    }
    return ${e}u;
}`,fl=e=>{let t=e.length,r=[];for(let i=0;i<t;++i){let a=e[i].setByIndices("indices","input[global_idx]");t===1?r.push(a):i===0?r.push(`if (output_number == ${i}u) { ${a} }`):i===t-1?r.push(`else { ${a} }`):r.push(`else if (output_number == ${i}) { ${a} }`)}return`
      fn writeBufferData(output_number: u32, indices: ${e[0].type.indices}, global_idx: u32) {
        ${r.join(`
`)}
      }`},mn=(e,t)=>{let r=e[0].dims,i=M.size(r),a=e[0].dataType,n=M.normalizeAxis(t.axis,r.length),s=new Array(t.numOutputs),o=C("input",a,r.length),u=new Array(t.numOutputs),l=[],p=[],d=0,h=[{type:12,data:i}];for(let g=0;g<t.numOutputs;g++){d+=t.splitSizes[g],u[g]=d;let w=r.slice();w[n]=t.splitSizes[g],p.push(w),s[g]=F(`output${g}`,a,w.length),l.push({dims:p[g],dataType:e[0].dataType})}h.push({type:12,data:u},...E(r,...p));let f=g=>`
  ${g.registerUniform("input_size","u32").registerUniform("size_in_split_axis","u32",u.length).declareVariables(o,...s)}
  ${hl(u.length)}
  ${fl(s)}

  ${g.mainStart()}
    ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.input_size")}

    var indices = ${o.offsetToIndices("global_idx")};
    var index = ${o.indicesGet("indices",n)};
    let output_number = calculateOutputIndex(index);
    if (output_number != 0) {
      index -= ${D("uniforms.size_in_split_axis","output_number - 1u",u.length)};
      ${o.indicesSet("indices",n,"index")};
    }
    writeBufferData(output_number, indices, global_idx);
  }`;return{name:"Split",shaderCache:{hint:t.cacheKey,inputDependencies:["rank"]},getShaderSource:f,getRunData:()=>({outputs:l,dispatchGroup:{x:Math.ceil(i/64)},programUniforms:h})}},ml=(e,t)=>{pl(e.inputs);let r=e.inputs.length===1?t:cl(e.inputs,t);e.compute(mn(e.inputs,r),{inputs:[0]})},gl=e=>{let t=e.axis,r=e.splitSizes,i=e.numOutputs<0?r.length:e.numOutputs;if(i!==r.length)throw new Error("numOutputs and splitSizes length must be equal");return m({axis:t,numOutputs:i,splitSizes:r})}}),wl,$a,_l,bl=k(()=>{"use strict";ue(),ne(),b(),j(),wl=(e,t)=>{let[r,i,a,n]=e,{numHeads:s,rotaryEmbeddingDim:o}=t;if(r.dims.length!==3&&r.dims.length!==4)throw new Error(`Input 'x' is expected to have 3 or 4 dimensions, got ${r.dims.length}`);if(!M.areEqual(i.dims,[])&&!M.areEqual(i.dims,[1])&&i.dims.length!==2)throw new Error(`Input 'position_ids' is expected to have 0, 1, or 2 dimensions, got ${i.dims.length}`);if(a.dims.length!==2)throw new Error(`Input 'cos_cache' is expected to have 2 dimensions, got ${a.dims.length}`);if(n.dims.length!==2)throw new Error(`Input 'sin_cache' is expected to have 2 dimensions, got ${n.dims.length}`);if(!M.areEqual(a.dims,n.dims))throw new Error("Inputs 'cos_cache' and 'sin_cache' are expected to have the same shape");if(o>0&&s===0)throw new Error("num_heads must be provided if rotary_embedding_dim is specified");let u=r.dims[0],l=r.dims[r.dims.length-2],p=a.dims[0],d=M.sizeFromDimension(r.dims,1)/l,h=o===0?a.dims[1]*2:d/s;if(o>h)throw new Error("rotary_embedding_dim must be less than or equal to head_size");if(i.dims.length===2){if(u!==i.dims[0])throw new Error(`Input 'position_ids' dimension 0 should be of size batch_size, got ${i.dims[0]}`);if(l!==i.dims[1])throw new Error(`Input 'position_ids' dimension 1 should be of size sequence_length, got ${i.dims[1]}`)}if(h/2!==a.dims[1]&&o/2!==a.dims[1])throw new Error(`Input 'cos_cache' dimension 1 should be same as head_size / 2 or rotary_embedding_dim / 2, got ${a.dims[1]}`);if(l>p)throw new Error("Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported")},$a=(e,t)=>{let{interleaved:r,numHeads:i,rotaryEmbeddingDim:a,scale:n}=t,s=e[0].dims[0],o=M.sizeFromDimension(e[0].dims,1),u=e[0].dims[e[0].dims.length-2],l=o/u,p=e[2].dims[1],d=a===0?p*2:l/i,h=new Array(s,u,l/d,d-p),f=M.computeStrides(h),g=[{type:1,data:n},{type:12,data:h},{type:12,data:f},...e[0].dims.length===3?new Array({type:12,data:[o,l,d,1]}):[],...e[0].dims.length===4?new Array({type:12,data:[o,d,u*d,1]}):[],...E(e[0].dims,e[1].dims,e[2].dims,e[3].dims,e[0].dims)],w=$=>{let _=C("input",e[0].dataType,e[0].dims.length),y=C("position_ids",e[1].dataType,e[1].dims.length),v=C("cos_cache",e[2].dataType,e[2].dims.length),x=C("sin_cache",e[3].dataType,e[3].dims.length),I=F("output",e[0].dataType,e[0].dims.length);return $.registerUniforms([{name:"scale",type:"f32"},{name:"global_shape",type:"u32",length:h.length},{name:"global_strides",type:"u32",length:f.length},{name:"input_output_strides",type:"u32",length:f.length}]),`
        ${$.declareVariables(_,y,v,x,I)}

        ${$.mainStart(T)}
          let half_rotary_emb_dim = uniforms.${v.name}_shape[1];
          let bsnh = global_idx / uniforms.global_strides % uniforms.global_shape;
          let size = uniforms.global_shape[0] * uniforms.global_strides[0];
          ${$.guardAgainstOutOfBoundsWorkgroupSizes("size")}

          if (bsnh[3] < half_rotary_emb_dim) {
            let position_ids_idx =
                ${y.broadcastedIndicesToOffset("bsnh.xy",F("",y.type.tensor,2))};
            let position_id =
                u32(${y.getByOffset("position_ids_idx")}) + select(0, bsnh[1], position_ids_idx == 0);
            let i = dot(bsnh, uniforms.input_output_strides) + select(0, bsnh[3], ${r});
            let j = i + select(half_rotary_emb_dim, 1, ${r});
            let re = ${_.getByOffset("i")} * ${v.get("position_id","bsnh[3]")} -
                ${_.getByOffset("j")} * ${x.get("position_id","bsnh[3]")};
            ${I.setByOffset("i","re")}
            let im = ${_.getByOffset("i")} * ${x.get("position_id","bsnh[3]")} +
                ${_.getByOffset("j")} * ${v.get("position_id","bsnh[3]")};
            ${I.setByOffset("j","im")}
          } else {
            let k = dot(bsnh, uniforms.input_output_strides) + half_rotary_emb_dim;
            ${I.setByOffset("k",_.getByOffset("k"))}
          }
        }`};return{name:"RotaryEmbedding",shaderCache:{hint:m({interleaved:r}).cacheKey,inputDependencies:["rank","rank","rank","rank"]},getShaderSource:w,getRunData:()=>({outputs:[{dims:e[0].dims,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(M.size(h)/T)},programUniforms:g})}},_l=(e,t)=>{wl(e.inputs,t),e.compute($a(e.inputs,t))}}),$l,vl,gn,xl,Sl,nc=k(()=>{"use strict";b(),ue(),Ga(),dl(),yl(),we(),bl(),j(),$l=(e,t)=>{if(t.doRotary&&e.length<=7)throw new Error("cos_cache and sin_cache inputs are required if do_rotary is specified");let r=e[0],i=e[1],a=e[2],n=e[3],s=e[4];if(t.doRotary!==0&&e.length<=7)throw new Error("cos_cast and sin_cache are expected if do_rotary attribute is non-zero");if(t.localWindowSize!==-1)throw new Error("Local attention is not supported");if(t.softcap!==0)throw new Error("Softcap is not supported");if(t.rotaryInterleaved!==0)throw new Error("Rotary interleaved is not supported");if(t.smoothSoftmax)throw new Error("Smooth softmax is not supported");if(r.dims.length!==3&&r.dims.length!==5)throw new Error("Input query is expected to have 3 or 5 dimensions");let o=r.dims[0],u=r.dims[1],l=r.dims.length===3?r.dims[2]:t.numHeads*r.dims[4],p=u,d=0,h=!i||i.dims.length===0,f=Math.floor(h?l/(t.numHeads+2*t.kvNumHeads):l/t.numHeads);h&&(l=f*t.numHeads);let g=n&&n.dims.length!==0,w=s&&s.dims.length!==0;if(g&&n.dims.length===4&&n.dims[0]===o&&n.dims[1]!==t.kvNumHeads&&n.dims[2]===t.kvNumHeads&&n.dims[3]===f)throw new Error("BSNH pastKey/pastValue is not supported");if(g&&w){if(n.dims.length!==4)throw new Error('Input "past_key" is expected to have 4 dimensions');if(s.dims.length!==4)throw new Error('Input "past_value" is expected to have 4 dimensions');d=n.dims[2]}else if(g||w)throw new Error('Input "past_key" and "past_value" shall be both present or both absent');let $=1;if(i&&i.dims.length>0){if(r.dims.length!==3)throw new Error('Input "query" is expected to have 3 dimensions when key is given');if(i.dims.length<3||i.dims.length>5)throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');if(r.dims[0]!==i.dims[0])throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');if(i.dims.length===3){if(r.dims[2]%i.dims[2]!==0)throw new Error('Dimension 2 of "query" should be a multiple of "key"');p=i.dims[1]}else if(i.dims.length===5){if(i.dims[2]!==t.numHeads||i.dims[3]!==2||i.dims[4]!==f)throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');if(a)throw new Error('Expect "value" be none when "key" has packed kv format.');p=i.dims[1]}else{if(i.dims[1]!==t.numHeads||i.dims[3]!==f)throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');p=i.dims[2]}}else{if(r.dims.length!==3&&r.dims.length!==5)throw new Error('Input "query" is expected to have 3 or 5 dimensions when key is empty');if(r.dims.length===5&&(r.dims[2]!==t.numHeads||r.dims[3]!==3))throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');$=3}let _=0,y=!1,v=t.kvNumHeads?f*t.kvNumHeads:l;if(a&&a.dims.length>0){if(a.dims.length!==3&&a.dims.length!==4)throw new Error('Input "value" is expected to have 3 or 4 dimensions');if(r.dims[0]!==a.dims[0])throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');if(a.dims.length===3){if(p!==a.dims[1])throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');v=a.dims[2]}else{if(p!==a.dims[2])throw new Error('Input "past_key" and "past_value" shall have the same dim 2 (kv_sequence_length)');v=a.dims[1]*a.dims[3],y=!0}}let x=e.length>4?e[5]:void 0;if(x&&x.dims.length!==1&&x.dims[0]!==o)throw new Error('Input "seqlens" is expected to have 1 dimension and the same dim 0 as batch_size');return{batchSize:o,sequenceLength:u,pastSequenceLength:d,kvSequenceLength:p,totalSequenceLength:-1,maxSequenceLength:-1,inputHiddenSize:0,hiddenSize:l,vHiddenSize:v,headSize:f,vHeadSize:Math.floor(v/t.kvNumHeads),numHeads:t.numHeads,kvNumHeads:t.kvNumHeads,nReps:t.numHeads/t.kvNumHeads,pastPresentShareBuffer:!1,maskType:_,scale:t.scale,broadcastResPosBias:!1,passPastInKv:y,qkvFormat:$}},vl=m({perm:[0,2,1,3]}),gn=(e,t,r)=>{let i=t,a=r.kvNumHeads;return t.dims.length===3&&r.kvSequenceLength!==0&&(i=t.reshape([r.batchSize,r.kvSequenceLength,a,r.headSize]),i=e.compute(Fe(i,vl.perm),{inputs:[i],outputs:[-1]})[0]),i},xl=(e,t,r,i)=>{let a=7,n=["type","type"],s=[e*t],o=e*t,u=[{type:12,data:o},{type:12,data:t},{type:12,data:e}],l=p=>{let d=C("seq_lens",r.dataType,r.dims),h=C("total_seq_lens",i.dataType,i.dims),f=F("pos_ids",a,s);return`
  ${p.registerUniforms([{name:"output_size",type:"u32"},{name:"sequence_length",type:"u32"},{name:"batch_size",type:"u32"}]).declareVariables(d,h,f)}
  ${p.mainStart()}
    ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let total_sequence_length = u32(${h.getByOffset("0")});
    let is_subsequent_prompt = uniforms.sequence_length > 1 && uniforms.sequence_length != total_sequence_length;
    let is_first_prompt = !is_subsequent_prompt && uniforms.sequence_length == total_sequence_length;
    let batch_idx = global_idx / uniforms.sequence_length;
    let sequence_idx = i32(global_idx % uniforms.sequence_length);
    var pos_id: i32 = 0;
    let seqlen = ${d.getByOffset("batch_idx")};
    let total_seqlen = seqlen + 1;
    if (is_first_prompt) {
      if (sequence_idx < total_seqlen) {
        pos_id = sequence_idx;
      } else {
        pos_id = 1;
      }
      ${f.setByOffset("global_idx","pos_id")}
    } else if (is_subsequent_prompt) {
      let past_seqlen = total_seqlen - i32(uniforms.sequence_length);
      if (past_seqlen + sequence_idx < total_seqlen) {
        pos_id = past_seqlen + sequence_idx;
      } else {
        pos_id = 1;
      }
      ${f.setByOffset("global_idx","pos_id")}
    } else if (global_idx < uniforms.batch_size) {
      ${f.setByOffset("global_idx","seqlen")}
    };
  }
  `};return{name:"GeneratePositionIds",shaderCache:{hint:`${e};${t}`,inputDependencies:n},getRunData:()=>({outputs:[{dims:s,dataType:a}],dispatchGroup:{x:Math.ceil(o/64)},programUniforms:u}),getShaderSource:l}},Sl=(e,t)=>{let r=$l(e.inputs,t);if(e.inputs[0].dims.length===5)throw new Error("Packed QKV is not implemented");if(e.inputs[1]?.dims.length===5)throw new Error("Packed KV is not implemented");let i=e.inputs[0],a=e.inputs[1]&&e.inputs[1].dims.length>0?e.inputs[1]:void 0,n=e.inputs[2]&&e.inputs[2].dims.length>0?e.inputs[2]:void 0,s=e.inputs[3]&&e.inputs[3].dims.length!==0?e.inputs[3]:void 0,o=e.inputs[4]&&e.inputs[4].dims.length!==0?e.inputs[4]:void 0,u=e.inputs.length>4?e.inputs[5]:void 0,l=e.inputs.length>5?e.inputs[6]:void 0,p=r.kvNumHeads?r.kvNumHeads:r.numHeads,d=m({axis:2,numOutputs:3,splitSizes:[r.numHeads*r.headSize,p*r.headSize,p*r.headSize]}),[h,f,g]=!a&&!n?e.compute(mn([i],d),{inputs:[i],outputs:[-1,-1,-1]}):[i,a,n],w,$;if(t.doRotary){let x=e.compute(xl(r.batchSize,r.sequenceLength,u,l),{inputs:[u,l],outputs:[-1]})[0],I=e.inputs[7],B=e.inputs[8],R=m({interleaved:t.rotaryInterleaved!==0,numHeads:r.numHeads,rotaryEmbeddingDim:0,scale:t.scale}),N=[h,x,I,B],G=[-1];w=e.compute($a(N,R),{inputs:N,outputs:G})[0],N.splice(0,1,f);let H=m({interleaved:t.rotaryInterleaved!==0,numHeads:r.kvNumHeads,rotaryEmbeddingDim:0,scale:t.scale});$=e.compute($a(N,H),{inputs:N,outputs:G})[0]}let _=Ji(e,r.batchSize,r.numHeads,r.sequenceLength,r.headSize,t.doRotary?w:h,void 0,0),y=gn(e,t.doRotary?$:f,r),v=gn(e,g,r);Ki(e,_,y,v,void 0,void 0,s,o,void 0,r,u,l)}}),yn,Tl,El,Il,sc=k(()=>{"use strict";ue(),ne(),we(),j(),yn=(e,t,r,i,a,n,s,o)=>{let u=A(n),l=u===1?"f32":`vec${u}f`,p=u===1?"vec2f":`mat2x${u}f`,d=a*s,h=64;d===1&&(h=256);let f=[a,s,n/u],g=[a,s,2],w=["rank","type","type"],$=[];$.push(...E(f,g));let _=y=>{let v=C("x",t.dataType,3,u),x=[v,C("scale",r.dataType,r.dims),C("bias",i.dataType,i.dims),F("output",1,3,2)];return`
  var<workgroup> workgroup_shared : array<${p}, ${h}>;
  const workgroup_size = ${h}u;
  ${y.declareVariables(...x)}
  ${y.mainStart(h)}
    let batch = workgroup_index / uniforms.x_shape[1];
    let channel = workgroup_index % uniforms.x_shape[1];
    let hight = uniforms.x_shape[2];
    // initialize workgroup memory
    var sum = ${l}(0);
    var squared_sum = ${l}(0);
    for (var h = local_idx; h < hight; h += workgroup_size) {
      let value = ${l}(${v.get("batch","channel","h")});
      sum += value;
      squared_sum += value * value;
    }
    workgroup_shared[local_idx] = ${p}(sum, squared_sum);
    workgroupBarrier();

    for (var currSize = workgroup_size >> 1;  currSize > 0; currSize = currSize >> 1) {
      if (local_idx < currSize) {
        workgroup_shared[local_idx] = workgroup_shared[local_idx] + workgroup_shared[local_idx + currSize];
      }
      workgroupBarrier();
    }
    if (local_idx == 0) {
      let sum_final = ${P("workgroup_shared[0][0]",u)} / f32(hight * ${u});
      let squared_sum_final = ${P("workgroup_shared[0][1]",u)} / f32(hight * ${u});

      let inv_std_dev = inverseSqrt(squared_sum_final - sum_final * sum_final + f32(${o}));
      let channel_scale = inv_std_dev * f32(scale[channel]);
      let channel_shift = f32(bias[channel]) - sum_final * channel_scale;
      output[workgroup_index] = vec2f(channel_scale, channel_shift);
    }
  }`};return e.compute({name:"InstanceNormComputeChannelScaleShift",shaderCache:{hint:`${u};${o};${h}`,inputDependencies:w},getRunData:()=>({outputs:[{dims:g,dataType:1}],dispatchGroup:{x:d},programUniforms:$}),getShaderSource:_},{inputs:[t,r,i],outputs:[-1]})[0]},Tl=(e,t,r)=>{let i=t[0].dims,a=i,n=2,s=i[0],o=i[1],u=M.sizeFromDimension(i,n),l=A(u),p=M.size(a)/l,d=yn(e,t[0],t[1],t[2],s,u,o,r.epsilon),h=[s,o,u/l],f=[s,o],g=["type","none"],w=$=>{let _=C("x",t[0].dataType,h.length,l),y=C("scale_shift",1,f.length,2),v=F("output",t[0].dataType,h.length,l),x=[_,y,v];return`
  ${$.registerUniform("output_size","u32").declareVariables(...x)}
  ${$.mainStart()}
  ${$.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let outputIndices = ${v.offsetToIndices("global_idx")};
      let batch = outputIndices[0];
      let channel = outputIndices[1];
      let scale_shift = ${y.getByIndices("vec2<u32>(batch, channel)")};
      let value = ${_.getByOffset("global_idx")} * ${v.type.value}(scale_shift.x) + ${v.type.value}(scale_shift.y);
      ${v.setByOffset("global_idx","value")};
  }`};e.compute({name:"InstanceNormalization",shaderCache:{hint:`${l}`,inputDependencies:g},getRunData:()=>({outputs:[{dims:a,dataType:t[0].dataType}],dispatchGroup:{x:Math.ceil(p/64)},programUniforms:[{type:12,data:p},...E(h,f,h)]}),getShaderSource:w},{inputs:[t[0],d]})},El=(e,t,r)=>{let i=t[0].dims,a=i,n=i[0],s=i[i.length-1],o=M.sizeFromDimension(i,1)/s,u=A(s),l=M.size(a)/u,p=[{type:12,data:o},{type:12,data:Math.floor(s/u)}],d=["type","type"],h=!1,f=[0,i.length-1];for(let _=0;_<i.length-2;_++)h=h||i[_+1]!==1,f.push(_+1);h=h&&i[i.length-1]!==1;let g=h?e.compute(Fe(e.inputs[0],f),{inputs:[e.inputs[0]],outputs:[-1]})[0]:e.inputs[0].reshape(Array.from({length:i.length},(_,y)=>i[f[y]])),w=yn(e,g,t[1],t[2],n,o,s,r.epsilon),$=_=>{let y=O(t[0].dataType),v=u===1?"vec2f":`mat${u}x2f`,x=R=>{let N=R===0?"x":"y",G=u===1?"f32":`vec${u}f`;switch(u){case 1:return`${y}(${G}(scale.${N}))`;case 2:return`vec2<${y}>(${G}(scale[0].${N}, scale[1].${N}))`;case 4:return`vec4<${y}>(${G}(scale[0].${N}, scale[1].${N}, scale[2].${N}, scale[3].${N}))`;default:throw new Error(`Not supported compoents ${u}`)}},I=C("input",t[0].dataType,t[0].dims,u),B=F("output",t[0].dataType,a,u);return`
  @group(0) @binding(0) var<storage, read> input : array<${I.type.storage}>;
  @group(0) @binding(1) var<storage, read> scale_input : array<${v}>;
  @group(0) @binding(2) var<storage, read_write> output : array<${B.type.storage}>;
  struct Uniforms {H: u32, C : u32};
  @group(0) @binding(3) var<uniform> uniforms: Uniforms;

  ${_.mainStart()}
    let current_image_number = global_idx / (uniforms.C * uniforms.H);
    let current_channel_number = global_idx % uniforms.C;

    let scale_offset = current_image_number * uniforms.C + current_channel_number;
    let scale = scale_input[scale_offset];
    output[global_idx] = fma(input[global_idx], ${x(0)}, ${x(1)});
  }`};e.compute({name:"InstanceNormalizationNHWC",shaderCache:{hint:`${u}`,inputDependencies:d},getRunData:()=>({outputs:[{dims:a,dataType:t[0].dataType}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:p}),getShaderSource:$},{inputs:[t[0],w]})},Il=(e,t)=>{t.format==="NHWC"?El(e,e.inputs,t):Tl(e,e.inputs,t)}}),kl,zl,Cl,oc=k(()=>{"use strict";ue(),ne(),j(),kl=e=>{if(!e||e.length<2)throw new Error("layerNorm requires at least 2 inputs.")},zl=(e,t,r)=>{let i=t.simplified,a=e[0].dims,n=e[1],s=!i&&e[2],o=a,u=M.normalizeAxis(t.axis,a.length),l=M.sizeToDimension(a,u),p=M.sizeFromDimension(a,u),d=M.size(n.dims),h=s?M.size(s.dims):0;if(d!==p||s&&h!==p)throw new Error(`Size of X.shape()[axis:] == ${p}.
       Size of scale and bias (if provided) must match this.
       Got scale size of ${d} and bias size of ${h}`);let f=[];for(let I=0;I<a.length;++I)I<u?f.push(a[I]):f.push(1);let g=A(p),w=["type","type"],$=[{type:12,data:l},{type:1,data:p},{type:12,data:Math.floor(p/g)},{type:1,data:t.epsilon}];s&&w.push("type");let _=r>1,y=r>2,v=I=>{let B=O(e[0].dataType),R=[C("x",e[0].dataType,e[0].dims,g),C("scale",n.dataType,n.dims,g)];return s&&R.push(C("bias",s.dataType,s.dims,g)),R.push(F("output",e[0].dataType,o,g)),_&&R.push(F("mean_data_output",1,f)),y&&R.push(F("inv_std_output",1,f)),`
  ${I.registerUniforms([{name:"norm_count",type:"u32"},{name:"norm_size",type:"f32"},{name:"norm_size_vectorized",type:"u32"},{name:"epsilon",type:"f32"}]).declareVariables(...R)}
  ${I.mainStart()}
    ${I.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.norm_count")}
    let offset = global_idx * uniforms.norm_size_vectorized;
    var mean_vector = ${L("f32",g)};
    var mean_square_vector = ${L("f32",g)};

    for (var h: u32 = 0u; h < uniforms.norm_size_vectorized; h++) {
      let value = ${q(B,g,"x[h + offset]")};
      mean_vector += value;
      mean_square_vector += value * value;
    }
    let mean = ${P("mean_vector",g)} / uniforms.norm_size;
    let inv_std_dev = inverseSqrt(${P("mean_square_vector",g)} / uniforms.norm_size ${i?"":"- mean * mean"} + uniforms.epsilon);

    for (var j: u32 = 0; j < uniforms.norm_size_vectorized; j++) {
      let f32input = ${q(B,g,"x[j + offset]")};
      let f32scale = ${q(B,g,"scale[j]")};
      output[j + offset] = ${R[0].type.value}((f32input ${i?"":"- mean"}) * inv_std_dev * f32scale
        ${s?`+ ${q(B,g,"bias[j]")}`:""}
      );
    }

    ${_?"mean_data_output[global_idx] = mean":""};
    ${y?"inv_std_output[global_idx] = inv_std_dev":""};
  }`},x=[{dims:o,dataType:e[0].dataType}];return _&&x.push({dims:f,dataType:1}),y&&x.push({dims:f,dataType:1}),{name:"LayerNormalization",shaderCache:{hint:`${g};${r};${i}`,inputDependencies:w},getRunData:()=>({outputs:x,dispatchGroup:{x:Math.ceil(l/64)},programUniforms:$}),getShaderSource:v}},Cl=(e,t)=>{kl(e.inputs),e.compute(zl(e.inputs,t,e.outputCount))}}),Al,Ol,uc=k(()=>{"use strict";ne(),Ya(),rn(),Al=e=>{if(!e||e.length!==2)throw new Error("MatMul requires 2 inputs.");if(e[0].dims[e[0].dims.length-1]!==e[1].dims[e[1].dims.length-2])throw new Error("shared dimension does not match.")},Ol=e=>{Al(e.inputs);let t=Ut.calcShape(e.inputs[0].dims,e.inputs[1].dims,!0);if(!t)throw new Error("Can't use matmul on the given tensors");let r=t[t.length-1],i=e.inputs[0].dims[e.inputs[0].dims.length-1];if(r<8&&i<8)e.compute(Xa(e.inputs,{activation:""},t));else{let a=t[t.length-2],n=M.size(e.inputs[0].dims.slice(0,-2)),s=M.size(e.inputs[1].dims.slice(0,-2));if(n!==1&&a===1&&s===1){let o=e.inputs[0].reshape([1,n,i]),u=e.inputs[1].reshape([1,i,r]),l=[1,n,r],p=[o,u];e.compute(ya(p,{activation:""},t,l),{inputs:p})}else e.compute(ya(e.inputs,{activation:""},t))}}}),Rl,Bl,Ml,Dl,Pl,lc=k(()=>{"use strict";ue(),ne(),b(),j(),Rl=(e,t)=>{if(e.length<3||e.length>4)throw new Error("MatMulNBits requires 3 or 4 inputs");let r=e[0],i=r.dims.length;if(r.dims[i-1]!==t.k)throw new Error("The last dim of input shape does not match the k value");let a=Math.floor((t.k+t.blockSize-1)/t.blockSize),n=t.blockSize/8*t.bits,s=e[1];if(!M.areEqual(s.dims,[t.n,a,n]))throw new Error("The second inputs must be 3D tensor with shape N X nBlocksPerCol X blobSize");let o=e[2].dims;if(M.size(o)!==t.n*a)throw new Error("scales input size error.");if(e.length===4){let u=e[3].dims,l=t.n*(t.bits===8?a:Math.floor((a*t.bits+7)/8));if(M.size(u)!==l)throw new Error("zeroPoints input size error.")}},Bl=(e,t)=>{let r=e[0].dims,i=r.length,a=r[i-2],n=t.k,s=t.n,o=r.slice(0,i-2),u=M.size(o),l=e[1].dims[2]/4,p=e[0].dataType,d=A(t.k),h=A(l),f=A(s),g=o.concat([a,s]),w=a>1&&s/f%2===0?2:1,$=M.size(g)/f/w,_=64,y=[],v=[u,a,n/d],x=M.convertShape(e[1].dims).slice();x.splice(-1,1,l/h),y.push(...E(v)),y.push(...E(x)),y.push(...E(e[2].dims)),e.length===4&&y.push(...E(M.convertShape(e[3].dims)));let I=[u,a,s/f];y.push(...E(I));let B=R=>{let N=v.length,G=C("a",e[0].dataType,N,d),H=C("b",12,x.length,h),ve=C("scales",e[2].dataType,e[2].dims.length),se=[G,H,ve],ce=e.length===4?C("zero_points",12,e[3].dims.length):void 0;ce&&se.push(ce);let Me=I.length,W=F("output",e[0].dataType,Me,f),J=O(e[0].dataType),Se=(()=>{switch(d){case 1:return`array<${J}, 8>`;case 2:return`mat4x2<${J}>`;case 4:return`mat2x4<${J}>`;default:throw new Error(`${d}-component is not supported.`)}})(),_e=()=>{let Z=`
          // reuse a data
            var input_offset = ${G.indicesToOffset(`${G.type.indices}(batch, row, word_offset)`)};
            var a_data: ${Se};
            for (var j: u32 = 0; j < ${8/d}; j++) {
              a_data[j] = ${G.getByOffset("input_offset")};
              input_offset++;
            }
          `;for(let me=0;me<f*w;me++)Z+=`
            b_value = ${h===1?`b${me}_data`:`b${me}_data[i]`};
            b_value_lower = unpack4xU8(b_value & b_mask);
            b_value_upper = unpack4xU8((b_value >> 4) & b_mask);
            b_quantized_values = ${Se}(${Array.from({length:4},(De,Be)=>`${J}(b_value_lower[${Be}]), ${J}(b_value_upper[${Be}])`).join(", ")});
            b_dequantized_values = ${d===1?`${Se}(${Array.from({length:8},(De,Be)=>`(b_quantized_values[${Be}] - ${ce?`zero_point${me}`:"zero_point"}) * scale${me}`).join(", ")});`:`(b_quantized_values - ${Se}(${Array(8).fill(`${ce?`zero_point${me}`:"zero_point"}`).join(",")})) * scale${me};`};
            workgroup_shared[local_id.x * ${w} + ${Math.floor(me/f)}]${f>1?`[${me%f}]`:""} += ${Array.from({length:8/d},(De,Be)=>`${d===1?`a_data[${Be}] * b_dequantized_values[${Be}]`:`dot(a_data[${Be}], b_dequantized_values[${Be}])`}`).join(" + ")};
          `;return Z},fe=()=>{let Z=`
            var col_index = col * ${f};
            ${ce?`
            let zero_point_bytes_per_col = (nBlocksPerCol + 1) / 2;
            var zero_point_byte_count: u32;
            var zero_point_word_index: u32;
            var zero_point_byte_offset: u32;
            let zero_point_nibble_offset: u32 = block & 0x1u;
            var zero_point_bits_offset: u32;
            var zero_point_word: u32;`:`
            // The default zero point is 8 for unsigned 4-bit quantization.
            let zero_point = ${J}(8);`}
            `;for(let me=0;me<f*w;me++)Z+=`
            let scale${me} = ${ve.getByOffset("col_index * nBlocksPerCol + block")};
            ${ce?`
            zero_point_byte_count = col_index * zero_point_bytes_per_col + (block >> 0x1u);
            zero_point_word_index = zero_point_byte_count >> 0x2u;
            zero_point_byte_offset = zero_point_byte_count & 0x3u;
            zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_nibble_offset << 2);
            zero_point_word = ${ce.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point${me} = ${J}((zero_point_word) & 0xFu);`:""}
            col_index += 1;`;return Z},V=()=>{let Z=`col_index = col * ${f};`;for(let me=0;me<f*w;me++)Z+=`
            let b${me}_data = ${H.getByIndices(`${H.type.indices}(col_index, block, word)`)};
            col_index += 1;`;return Z+=`
            var b_value: u32;
            let b_mask: u32 = 0x0F0F0F0Fu;
            var b_value_lower: vec4<u32>;
            var b_value_upper: vec4<u32>;
            var b_quantized_values: ${Se};
            var b_dequantized_values: ${Se};`,Z};return`
        var<workgroup> workgroup_shared: array<${W.type.value}, ${w*_}>;
        ${R.declareVariables(...se,W)}
        ${R.mainStart([_,1,1])}
          let output_indices = ${W.offsetToIndices(`(global_idx / ${_}) * ${w}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let nBlocksPerCol = uniforms.b_shape[1];

          for (var block = local_id.x; block < nBlocksPerCol; block += ${_}) {
            //process one block
            var word_offset: u32 = block * ${t.blockSize/d};
            ${fe()}
            for (var word: u32 = 0; word < ${l}; word += ${h}) {
              ${V()}
              for (var i: u32 = 0; i < ${h}; i++) {
                ${_e()}
                word_offset += ${8/d};
              }
            }
          }
          workgroupBarrier();

          if (local_id.x < ${w}) {
            var output_value: ${W.type.value} = ${W.type.value}(0);
            var workgroup_shared_offset: u32 = local_id.x;
            for (var b: u32 = 0u; b < ${_}u; b++) {
              output_value += workgroup_shared[workgroup_shared_offset];
              workgroup_shared_offset += ${w};
            }
            ${W.setByIndices(`${W.type.indices}(batch, row, col + local_id.x)`,"output_value")};
          }
        }`};return{name:"MatMulNBits",shaderCache:{hint:`${t.blockSize};${t.bits};${d};${h};${f};${w};${_}`,inputDependencies:Array(e.length).fill("rank")},getRunData:()=>({outputs:[{dims:g,dataType:p}],dispatchGroup:{x:$},programUniforms:y}),getShaderSource:B}},Ml=(e,t)=>{let r=e[0].dims,i=r.length,a=r[i-2],n=t.k,s=t.n,o=r.slice(0,i-2),u=M.size(o),l=e[1].dims[2]/4,p=e[0].dataType,d=A(t.k),h=A(l),f=o.concat([a,s]),g=128,w=s%8===0?8:s%4===0?4:1,$=g/w,_=$*h*8,y=_/d,v=_/t.blockSize,x=M.size(f)/w,I=[],B=[u,a,n/d],R=M.convertShape(e[1].dims).slice();R.splice(-1,1,l/h),I.push(...E(B)),I.push(...E(R)),I.push(...E(e[2].dims)),e.length===4&&I.push(...E(M.convertShape(e[3].dims)));let N=[u,a,s];I.push(...E(N));let G=H=>{let ve=B.length,se=C("a",e[0].dataType,ve,d),ce=C("b",12,R.length,h),Me=C("scales",e[2].dataType,e[2].dims.length),W=[se,ce,Me],J=e.length===4?C("zero_points",12,e[3].dims.length):void 0;J&&W.push(J);let Se=N.length,_e=F("output",e[0].dataType,Se),fe=O(e[0].dataType),V=()=>{switch(d){case 1:return`
          let a_data0 = vec4<${fe}>(sub_a[word_offset], sub_a[word_offset + 1], sub_a[word_offset + 2], sub_a[word_offset + 3]);
          let a_data1 = vec4<${fe}>(sub_a[word_offset + 4], sub_a[word_offset + 5], sub_a[word_offset + 6], sub_a[word_offset + 7]);`;case 2:return`
          let a_data0 = vec4<${fe}>(sub_a[word_offset], sub_a[word_offset + 1]);
          let a_data1 = vec4<${fe}>(sub_a[word_offset + 2], sub_a[word_offset + 3]);`;case 4:return`
          let a_data0 = sub_a[word_offset];
          let a_data1 = sub_a[word_offset + 1];`;default:throw new Error(`${d}-component is not supported.`)}};return`
        var<workgroup> sub_a: array<${se.type.value}, ${y}>;
        var<workgroup> inter_results: array<array<${_e.type.value}, ${$}>, ${w}>;
        ${H.declareVariables(...W,_e)}
        ${H.mainStart([$,w,1])}
          let output_indices = ${_e.offsetToIndices(`workgroup_index * ${w}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let n_blocks_per_col = uniforms.b_shape[1];
          let num_tiles =  (n_blocks_per_col - 1) / ${v} + 1;

          // Loop over shared dimension.
          for (var tile: u32 = 0; tile < num_tiles; tile += 1) {
            let a_col_start = tile * ${y};
            // load one tile A data into shared memory.
            for (var a_offset = local_idx; a_offset < ${y}; a_offset += ${g})
            {
              let a_col = a_col_start + a_offset;
              if (a_col < uniforms.a_shape[2])
              {
                sub_a[a_offset] = ${se.getByIndices(`${se.type.indices}(batch, row, a_col)`)};
              } else {
                sub_a[a_offset] = ${se.type.value}(0);
              }
            }
            workgroupBarrier();

            // each thread process one block
            let b_row = col + local_id.y;
            let block = tile * ${v} + local_id.x;
            ${J?`
            let zero_point_bytes_per_col = (n_blocks_per_col + 1) / 2;
            let zero_point_byte_count = b_row * zero_point_bytes_per_col + (block >> 0x1u);
            let zero_point_word_index = zero_point_byte_count >> 0x2u;
            let zero_point_byte_offset = zero_point_byte_count & 0x3u;
            let zero_point_nibble_offset: u32 = block & 0x1u;
            let zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_nibble_offset << 2);
            let zero_point_word = ${J.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point = ${fe}((zero_point_word) & 0xFu);`:`
            // The default zero point is 8 for unsigned 4-bit quantization.
            let zero_point = ${fe}(8);`}
            let scale = ${Me.getByOffset("b_row * n_blocks_per_col + block")};
            let b_data = ${ce.getByIndices(`${ce.type.indices}(b_row, block, 0)`)};
            var word_offset = local_id.x * ${t.blockSize/d};
            for (var i: u32 = 0; i < ${h}; i++) {
              ${V()}
              let b_value = ${h===1?"b_data":"b_data[i]"};
              let b_value_lower = unpack4xU8(b_value & 0x0F0F0F0Fu);
              let b_value_upper = unpack4xU8((b_value >> 4) & 0x0F0F0F0Fu);
              let b_quantized_values = mat2x4<${fe}>(${Array.from({length:4},(Z,me)=>`${fe}(b_value_lower[${me}]), ${fe}(b_value_upper[${me}])`).join(", ")});
              let b_dequantized_values = (b_quantized_values - mat2x4<${fe}>(${Array(8).fill("zero_point").join(",")})) * scale;
              inter_results[local_id.y][local_id.x] += ${Array.from({length:2},(Z,me)=>`${`dot(a_data${me}, b_dequantized_values[${me}])`}`).join(" + ")};
              word_offset += ${8/d};
            }
            workgroupBarrier();
          }

          if (local_idx < ${w}) {
            var output_value: ${_e.type.value} = ${_e.type.value}(0);
            for (var b = 0u; b < ${$}; b++) {
              output_value += inter_results[local_idx][b];
            }
            if (col + local_idx < uniforms.output_shape[2])
            {
              ${_e.setByIndices(`${_e.type.indices}(batch, row, col + local_idx)`,"output_value")}
            }
          }
        }`};return{name:"BlockwiseMatMulNBits32",shaderCache:{hint:`${t.blockSize};${d};${h};${$};${w}`,inputDependencies:Array(e.length).fill("rank")},getRunData:()=>({outputs:[{dims:f,dataType:p}],dispatchGroup:{x},programUniforms:I}),getShaderSource:G}},Dl=(e,t)=>{Rl(e.inputs,t),t.blockSize===32&&e.adapterInfo.isVendor("intel")&&e.adapterInfo.isArchitecture("gen-12lp")?e.compute(Ml(e.inputs,t)):e.compute(Bl(e.inputs,t))},Pl=e=>m(e)}),Ul,Nl,Ll,Vl,ql,Fl,Gl,Wl,Hl,dc=k(()=>{"use strict";ue(),ne(),j(),Ul=e=>{if(!e||e.length<1)throw new Error("Too few inputs");if(e[0].dataType!==1&&e[0].dataType!==10)throw new Error("Input type must be float or float16.");if(e.length>=2){let t=e[0].dims.length*2===e[1].dims[0];if(e.length===4&&(t=e[3].dims[0]*2===e[1].dims[0]),!t)throw new Error("The pads should be a 1D tensor of shape [2 * input_rank] or [2 * num_axes].")}},Nl=(e,t,r)=>{let i="";for(let a=t-1;a>=0;--a)i+=`
            k = i32(${e.indicesGet("indices",a)}) - ${D("uniforms.pads",a,r)};
            if (k < 0) {
              break;
            }
            if (k >= i32(${D("uniforms.x_shape",a,t)})) {
              break;
            }
            offset += k * i32(${D("uniforms.x_strides",a,t)});
        `;return`
          value = ${e.type.value}(uniforms.constant_value);
          for (var i = 0; i < 1; i++) {
            var offset = 0;
            var k = 0;
            ${i}
            value = x[offset];
          }
      `},Ll=(e,t,r)=>{let i="";for(let a=t-1;a>=0;--a)i+=`
                k = i32(${e.indicesGet("indices",a)}) - ${D("uniforms.pads",a,r)};
                if (k < 0) {
                  k = -k;
                }
                {
                  let _2n_1 = 2 * (i32(${D("uniforms.x_shape",a,t)}) - 1);
                  k = k % _2n_1;
                  if(k >= i32(${D("uniforms.x_shape",a,t)})) {
                    k = _2n_1 - k;
                  }
                }
                offset += k * i32(${D("uniforms.x_strides",a,t)});
            `;return`
              var offset = 0;
              var k = 0;
              ${i}
              value = x[offset];
          `},Vl=(e,t,r)=>{let i="";for(let a=t-1;a>=0;--a)i+=`
                k = i32(${e.indicesGet("indices",a)}) - ${D("uniforms.pads",a,r)};
                if (k < 0) {
                  k = 0;
                }
                if (k >= i32(${D("uniforms.x_shape",a,t)})) {
                  k = i32(${D("uniforms.x_shape",a,t)}) - 1;
                }
                offset += k * i32(${D("uniforms.x_strides",a,t)});
            `;return`
              var offset = 0;
              var k = 0;
              ${i}
              value = x[offset];
          `},ql=(e,t,r)=>{let i="";for(let a=t-1;a>=0;--a)i+=`
                k = i32(${e.indicesGet("indices",a)}) - ${D("uniforms.pads",a,r)};
                if (k < 0)  {
                  k += i32(${D("uniforms.x_shape",a,t)}]);
                }
                if (k >= i32(${D("uniforms.x_shape",a,t)})) {
                  k -= i32(${D("uniforms.x_shape",a,t)});
                }
                offset += k * i32(${D("uniforms.x_strides",a,t)});
            `;return`
              var offset = 0;
              var k = 0;
              ${i}
              value = x[offset];
          `},Fl=(e,t,r)=>{switch(r.mode){case 0:return Nl(e,t,r.pads.length);case 1:return Ll(e,t,r.pads.length);case 2:return Vl(e,t,r.pads.length);case 3:return ql(e,t,r.pads.length);default:throw new Error("Invalid mode")}},Gl=(e,t)=>{let r=M.padShape(e[0].dims.slice(),t.pads),i=e[0].dims,a=[{type:12,data:M.size(r)},{type:6,data:t.pads}],n=e.length>=3&&e[2].data;t.mode===0&&a.push({type:n?e[2].dataType:1,data:t.value}),a.push(...E(e[0].dims,r));let s=["rank"],o=u=>{let l=F("output",e[0].dataType,r.length),p=C("x",e[0].dataType,i.length),d=p.type.value,h=Fl(l,i.length,t),f=[{name:"output_size",type:"u32"},{name:"pads",type:"i32",length:t.pads.length}];return t.mode===0&&f.push({name:"constant_value",type:n?d:"f32"}),`
            ${u.registerUniforms(f).declareVariables(p,l)}
            ${u.mainStart()}
            ${u.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

            let indices = ${l.offsetToIndices("global_idx")};

            var value = ${d}(0);
            ${h}
            output[global_idx] = value;
        }`};return{name:"Pad",shaderCache:{hint:`${t.mode}${n}`,inputDependencies:s},getRunData:()=>({outputs:[{dims:r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(M.size(r)/64)},programUniforms:a}),getShaderSource:o}},Wl=(e,t)=>{if(e.length>1){let r=e[1].getBigInt64Array(),i=e.length>=3&&e[2].data?e[2].dataType===10?e[2].getUint16Array()[0]:e[2].getFloat32Array()[0]:0,a=e[0].dims.length,n=new Int32Array(2*a).fill(0);if(e.length>=4){let o=e[3].getBigInt64Array();for(let u=0;u<o.length;u++)n[Number(o[u])]=Number(r[u]),n[Number(o[u])+a]=Number(r[u+o.length])}else r.forEach((o,u)=>n[Number(u)]=Number(o));let s=[];return n.forEach(o=>s.push(o)),{mode:t.mode,value:i,pads:s}}else return t},Hl=(e,t)=>{Ul(e.inputs);let r=Wl(e.inputs,t);e.compute(Gl(e.inputs,r),{inputs:[0]})}}),ea,wn,_n,bn,$n,jl,Kl,vn,xn,Zl,Ql,Sn,Xl,Yl,Tn,Jl,ed,td,rd,pc=k(()=>{"use strict";Xe(),ue(),ne(),j(),ea=e=>{if(te.webgpu.validateInputContent&&(!e||e.length!==1))throw new Error("Pool ops requires 1 input.")},wn=(e,t,r)=>{let i=t.format==="NHWC",a=e.dims.slice();i&&a.splice(1,0,a.pop());let n=Object.hasOwnProperty.call(t,"dilations"),s=t.kernelShape.slice(),o=t.strides.slice(),u=n?t.dilations.slice():[],l=t.pads.slice();Qt.adjustPoolAttributes(r,a,s,o,u,l);let p=Qt.computePoolOutputShape(r,a,o,u,s,l,t.autoPad),d=Object.assign({},t);n?Object.assign(d,{kernelShape:s,strides:o,pads:l,dilations:u,cacheKey:t.cacheKey}):Object.assign(d,{kernelShape:s,strides:o,pads:l,cacheKey:t.cacheKey});let h=p.slice();return h.push(h.splice(1,1)[0]),[d,i?h:p]},_n=(e,t)=>{let r=t.format==="NHWC",i=M.size(e),a=M.size(t.kernelShape),n=[{type:12,data:i},{type:12,data:a}],s=[{name:"outputSize",type:"u32"},{name:"kernelSize",type:"u32"}];if(t.kernelShape.length<=2){let o=t.kernelShape[t.kernelShape.length-1],u=t.strides[t.strides.length-1],l=t.pads[t.pads.length/2-1],p=t.pads[t.pads.length-1],d=!!(l+p);n.push({type:12,data:o},{type:12,data:u},{type:12,data:l},{type:12,data:p}),s.push({name:"kw",type:"u32"},{name:"sw",type:"u32"},{name:"pwStart",type:"u32"},{name:"pwEnd",type:"u32"});let h=!1;if(t.kernelShape.length===2){let f=t.kernelShape[t.kernelShape.length-2],g=t.strides[t.strides.length-2],w=t.pads[t.pads.length/2-2],$=t.pads[t.pads.length-2];h=!!(w+$),n.push({type:12,data:f},{type:12,data:g},{type:12,data:w},{type:12,data:$}),s.push({name:"kh",type:"u32"},{name:"sh",type:"u32"},{name:"phStart",type:"u32"},{name:"phEnd",type:"u32"})}return[n,s,!0,d,h]}else{if(r)throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");let o=M.computeStrides(t.kernelShape);return n.push({type:12,data:o},{type:12,data:t.pads},{type:12,data:t.strides}),s.push({name:"kernelStrides",type:"u32",length:o.length},{name:"pads",type:"u32",length:t.pads.length},{name:"strides",type:"u32",length:t.strides.length}),[n,s,!!t.pads.reduce((u,l)=>u+l),!1,!1]}},bn=(e,t,r,i,a,n,s,o,u,l,p,d)=>{let h=a.format==="NHWC",f=t.type.value,g=F("output",t.type.tensor,i);if(a.kernelShape.length<=2){let w="",$="",_="",y=r-(h?2:1);if(p?w=`
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${y}] = indices[${y}] * uniforms.sw - uniforms.pwStart + i;
                  if (xIndices[${y}] < 0 || xIndices[${y}]
                      >= uniforms.x_shape[${y}]) {
                    pad++;
                    continue;
                  }
                  let x_val = x[${t.indicesToOffset("xIndices")}];
                  ${n}
                }`:w=`
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${y}] = indices[${y}] * uniforms.sw - uniforms.pwStart + i;
                  let x_val = x[${t.indicesToOffset("xIndices")}];
                  ${n}
                }`,a.kernelShape.length===2){let v=r-(h?3:2);d?$=`
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${v}] = indices[${v}] * uniforms.sh - uniforms.phStart + j;
                  if (xIndices[${v}] < 0 || xIndices[${v}] >= uniforms.x_shape[${v}]) {
                    pad += i32(uniforms.kw);
                    continue;
                  }
              `:$=`
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${v}] = indices[${v}] * uniforms.sh - uniforms.phStart + j;
                `,_=`
              }
            `}return`
            ${e.registerUniforms(u).declareVariables(t,g)}

            ${e.mainStart()}
              ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

              let indices = ${g.offsetToIndices("global_idx")};
              var xIndices = ${g.offsetToIndices("global_idx")};

              var value = ${f}(${o});
              var pad = 0;
              ${$}
              ${w}
              ${_}
              ${s}

              output[global_idx] = value;
            }`}else{if(h)throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");let w=a.kernelShape.length,$=a.pads.length,_="";return l?_=`
                if (xIndices[j] >= uniforms.x_shape[j]) {
                  pad++;
                  isPad = true;
                  break;
                }
              }
              if (!isPad) {
                let x_val = x[${t.indicesToOffset("xIndices")}];
                ${n}
              }`:_=`
              }
              let x_val = x[${t.indicesToOffset("xIndices")}];
              ${n}
            `,`
            ${e.registerUniforms(u).declareVariables(t,g)}

            ${e.mainStart()}
              ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
              let indices = ${g.offsetToIndices("global_idx")};
              var xIndices = ${g.offsetToIndices("global_idx")};

              var offsets: array<u32, ${w}>;

              var value = ${f}(${o});
              var pad = 0;
              var isPad = false;

              for (var i: u32 = 0u; i < uniforms.kernelSize; i++) {
                var offset = i;
                for (var j = 0u; j < ${w-1}u; j++) {
                  offsets[j] = offset / ${D("uniforms.kernelStrides","j",w)};
                  offset -= offsets[j] * ${D("uniforms.kernelStrides","j",w)};
                }
                offsets[${w-1}] = offset;

                isPad = false;
                for (var j = ${r-w}u; j < ${r}u; j++) {
                  xIndices[j] = indices[j] * ${D("uniforms.strides",`j - ${r-w}u`,w)}
                    + offsets[j - ${r-w}u] - ${D("uniforms.pads","j - 2u",$)};
                  ${_}
              }
              ${s}

              output[global_idx] = value;
            }`}},$n=e=>`${e.format};${e.ceilMode};${e.autoPad};${e.kernelShape.length}`,jl=e=>`${$n(e)};${e.countIncludePad}`,Kl=e=>`${$n(e)};${e.storageOrder};${e.dilations}`,vn=e=>({format:e.format,autoPad:["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][e.auto_pad],ceilMode:e.ceil_mode,kernelShape:e.kernel_shape,strides:e.strides,pads:e.pads}),xn=(e,t,r,i)=>{let[a,n]=wn(t,i,r),s=C("x",t.dataType,t.dims.length),o=s.type.value,u="value += x_val;",l="";a.countIncludePad?l+=`value /= ${o}(uniforms.kernelSize);`:l+=`value /= ${o}(i32(uniforms.kernelSize) - pad);`;let[p,d,h,f,g]=_n(n,a);return p.push(...E(t.dims,n)),{name:e,shaderCache:{hint:`${i.cacheKey};${h};${f};${g}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:n,dataType:t.dataType}],dispatchGroup:{x:Math.ceil(M.size(n)/64)},programUniforms:p}),getShaderSource:w=>bn(w,s,t.dims.length,n.length,a,u,l,0,d,h,f,g)}},Zl=e=>{let t=e.count_include_pad!==0,r=vn(e);if(r.ceilMode!==0)throw new Error("using ceil() in shape computation is not yet supported for AveragePool");let i={countIncludePad:t,...r,cacheKey:""};return{...i,cacheKey:jl(i)}},Ql=(e,t)=>{ea(e.inputs),e.compute(xn("AveragePool",e.inputs[0],!1,t))},Sn={autoPad:"",ceilMode:0,countIncludePad:!1,kernelShape:[],strides:[],pads:[],storageOrder:0,dilations:[]},Xl=e=>{let t=e.format;return{format:t,...Sn,cacheKey:t}},Yl=(e,t)=>{ea(e.inputs),e.compute(xn("GlobalAveragePool",e.inputs[0],!0,t))},Tn=(e,t,r,i)=>{let[a,n]=wn(t,i,r),s=`
      value = max(x_val, value);
    `,o="",u=C("x",t.dataType,t.dims.length),l=["rank"],[p,d,h,f,g]=_n(n,a);return p.push(...E(t.dims,n)),{name:e,shaderCache:{hint:`${i.cacheKey};${h};${f};${g}`,inputDependencies:l},getRunData:()=>({outputs:[{dims:n,dataType:t.dataType}],dispatchGroup:{x:Math.ceil(M.size(n)/64)},programUniforms:p}),getShaderSource:w=>bn(w,u,t.dims.length,n.length,a,s,o,t.dataType===10?-65504:-1e5,d,h,f,g)}},Jl=(e,t)=>{ea(e.inputs),e.compute(Tn("MaxPool",e.inputs[0],!1,t))},ed=e=>{let t=e.storage_order,r=e.dilations,i=vn(e);if(t!==0)throw new Error("column major storage order is not yet supported for MaxPool");if(i.ceilMode!==0)throw new Error("using ceil() in shape computation is not yet supported for MaxPool");let a={storageOrder:t,dilations:r,...i,cacheKey:""};return{...a,cacheKey:Kl(a)}},td=e=>{let t=e.format;return{format:t,...Sn,cacheKey:t}},rd=(e,t)=>{ea(e.inputs),e.compute(Tn("GlobalMaxPool",e.inputs[0],!0,t))}}),id,ad,nd,sd,cc=k(()=>{"use strict";ue(),ne(),b(),j(),id=(e,t)=>{if(e.length<2||e.length>3)throw new Error("DequantizeLinear requires 2 or 3 inputs.");if(e.length===3&&e[1].dims===e[2].dims)throw new Error("x-scale and x-zero-point must have the same shape.");if(e.length===3&&e[0].dataType!==e[2].dataType)throw new Error("x and x-zero-point must have the same data type.");if(e[0].dataType===6&&e.length>2)throw new Error("In the case of dequantizing int32 there is no zero point.");if(e[1].dims.length!==0&&e[1].dims.length!==1&&e[1].dims.length!==e[0].dims.length)throw new Error("scale input must be a scalar, a 1D tensor, or have the same rank as the input tensor.");if(e.length>2){if(e[0].dataType!==e[2].dataType)throw new Error("x and x-zero-point must have the same data type.");if(e[1].dims.length!==e[2].dims.length)throw new Error("scale and zero-point inputs must have the same rank.");if(!e[1].dims.map((r,i)=>r===e[2].dims[i]).reduce((r,i)=>r&&i,!0))throw new Error("scale and zero-point inputs must have the same shape.")}if(t.blockSize>0){if(e[1].dims.length===0||e[1].dims.length===1&&e[1].dims[0]===1)throw new Error("blockSize must be set only for block quantization.");if(!e[1].dims.map((a,n)=>n===t.axis||a===e[0].dims[n]).reduce((a,n)=>a&&n,!0))throw new Error("For block qunatization, scale input shape to match the input shape except for the axis");if(e[1].dims.length!==e[0].dims.length)throw new Error("For block qunatization the scale input rank must be the same as the x rank.");let r=e[0].dims[t.axis],i=e[1].dims[t.axis];if(t.blockSize<Math.ceil(r/i)||t.blockSize>Math.ceil(r/(i-1)-1))throw new Error("blockSize must be with in the range [ceil(dI / Si), ceil(dI / (Si - 1) - 1)].")}},ad=(e,t)=>{let r=M.normalizeAxis(t.axis,e[0].dims.length),i=e[0].dataType,a=i===3,n=e[0].dims,s=e[1].dataType,o=M.size(n),u=i===3||i===2,l=u?[Math.ceil(M.size(e[0].dims)/4)]:e[0].dims,p=e[1].dims,d=e.length>2?e[2]:void 0,h=d?u?[Math.ceil(M.size(d.dims)/4)]:d.dims:void 0,f=p.length===0||p.length===1&&p[0]===1,g=f===!1&&p.length===1,w=A(o),$=f&&(!u||w===4),_=$?w:1,y=$&&!u?w:1,v=C("input",u?12:i,l.length,y),x=C("scale",s,p.length),I=d?C("zero_point",u?12:i,h.length):void 0,B=F("output",s,n.length,_),R=[v,x];I&&R.push(I);let N=[l,p];d&&N.push(h);let G=[{type:12,data:o/_},{type:12,data:r},{type:12,data:t.blockSize},...E(...N,n)],H=ve=>`
      ${ve.registerUniforms([{name:"output_size",type:"u32"},{name:"axis",type:"u32"},{name:"block_size",type:"u32"}]).declareVariables(...R,B)}
      ${ve.mainStart()}
          ${ve.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let output_indices = ${B.offsetToIndices("global_idx")};

          // Set input x
          ${u?`
            let input = ${v.getByOffset("global_idx / 4")};
            let x_vec = ${a?"unpack4xI8(input)":"unpack4xU8(input)"};
            let x_value = ${_===1?"x_vec[global_idx % 4]":"x_vec"};`:`let x_value = ${v.getByOffset("global_idx")};`};

          // Set scale input
          ${f?`let scale_value= ${x.getByOffset("0")}`:g?`
            let scale_index = ${B.indicesGet("output_indices","uniforms.axis")};
            let scale_value= ${x.getByOffset("scale_index")};`:`
            var scale_indices: ${x.type.indices} = output_indices;
            let index = ${x.indicesGet("scale_indices","uniforms.axis")} / uniforms.block_size;
            ${x.indicesSet("scale_indices","uniforms.axis","index")};
            let scale_value= ${x.getByIndices("scale_indices")};`};

          // Set zero-point input
          ${I?f?u?`
                let zero_point_input = ${I.getByOffset("0")};
                let zero_point_vec =  ${a?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value= zero_point_vec[0]`:`let zero_point_value = ${I.getByOffset("0")}`:g?u?`
                let zero_point_index = ${B.indicesGet("output_indices","uniforms.axis")};
                let zero_point_input = ${I.getByOffset("zero_point_index / 4")};
                let zero_point_vec =  ${a?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_index % 4]`:`
                let zero_point_index = ${B.indicesGet("output_indices","uniforms.axis")};
                let zero_point_value = ${I.getByOffset("zero_point_index")};`:u?`
                let zero_point_offset = ${x.indicesToOffset("scale_indices")};
                let zero_point_input = ${I.getByOffset("zero_point_offset / 4")};
                let zero_point_vec = ${a?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_offset % 4];`:`let zero_point_value = ${I.getByIndices("scale_indices")};`:`let zero_point_value = ${u?a?"i32":"u32":v.type.value}(0);`};
      // Compute and write output
      ${B.setByOffset("global_idx",`${B.type.value}(x_value - zero_point_value) * scale_value`)};
      }`;return{name:"DequantizeLinear",shaderCache:{hint:t.cacheKey,inputDependencies:I?["rank","rank","rank"]:["rank","rank"]},getShaderSource:H,getRunData:()=>({outputs:[{dims:n,dataType:s}],dispatchGroup:{x:Math.ceil(o/_/64),y:1,z:1},programUniforms:G})}},nd=(e,t)=>{id(e.inputs,t),e.compute(ad(e.inputs,t))},sd=e=>m({axis:e.axis,blockSize:e.blockSize})}),od,ud,ld,hc=k(()=>{"use strict";Xe(),ue(),j(),od=(e,t,r)=>{if(e===t||e<t&&r<0||e>t&&r>0)throw new Error("Range these inputs' contents are invalid.")},ud=(e,t,r,i)=>{let a=Math.abs(Math.ceil((t-e)/r)),n=[a],s=a,o=[{type:12,data:s},{type:i,data:e},{type:i,data:r},...E(n)],u=l=>{let p=F("output",i,n.length),d=p.type.value,h=[{name:"outputSize",type:"u32"},{name:"start",type:d},{name:"delta",type:d}];return`
        ${l.registerUniforms(h).declareVariables(p)}
        ${l.mainStart()}
        ${l.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        output[global_idx] = uniforms.start + ${d}(global_idx) * uniforms.delta;
      }`};return{name:"Range",shaderCache:{hint:`${i}`},getShaderSource:u,getRunData:()=>({outputs:[{dims:n,dataType:i}],dispatchGroup:{x:Math.ceil(s/64)},programUniforms:o})}},ld=e=>{let t=0,r=0,i=0;e.inputs[0].dataType===6?(t=e.inputs[0].getInt32Array()[0],r=e.inputs[1].getInt32Array()[0],i=e.inputs[2].getInt32Array()[0]):e.inputs[0].dataType===1&&(t=e.inputs[0].getFloat32Array()[0],r=e.inputs[1].getFloat32Array()[0],i=e.inputs[2].getFloat32Array()[0]),te.webgpu.validateInputContent&&od(t,r,i),e.compute(ud(t,r,i,e.inputs[0].dataType),{inputs:[]})}}),dd,pd,cd,hd,fc=k(()=>{"use strict";ue(),ne(),b(),j(),dd=(e,t,r,i)=>{if(e!=="none"&&i!=="i32"&&i!=="u32"&&i!=="f32")throw new Error(`Input ${i} is not supported with reduction ${e}.`);let a=`{
                var oldValue = 0;
                loop {
                  let newValueF32 =`,n=`;
                  let newValue = bitcast<i32>(newValueF32);
                  let res = atomicCompareExchangeWeak(&${t}, oldValue, newValue);
                  if res.exchanged {
                    break;
                  }
                  oldValue = res.old_value;
                }
              }`;switch(e){case"none":return`${t}=${r};`;case"add":return i==="i32"||i==="u32"?`atomicAdd(&${t}, bitcast<${i}>(${r}));`:`
              ${a}bitcast<${i}>(oldValue) + (${r})${n}`;case"max":return i==="i32"||i==="u32"?`atomicMax(&${t}, bitcast<${i}>(${r}));`:`
                ${a}max(bitcast<f32>(oldValue), (${r}))${n}`;case"min":return i==="i32"||i==="u32"?`atomicMin(&${t}, bitcast<${i}>(${r}));`:`${a}min(bitcast<${i}>(oldValue), (${r}))${n}`;case"mul":return`${a}(bitcast<${i}>(oldValue) * (${r}))${n}`;default:throw new Error(`Reduction ${e} is not supported.`)}},pd=(e,t)=>{let r=e[0].dims,i=e[1].dims,a=r,n=1,s=Math.ceil(M.sizeToDimension(i,i.length-1)/n),o=i[i.length-1],u=M.sizeFromDimension(r,o),l=[{type:12,data:s},{type:12,data:o},{type:12,data:u},...E(e[1].dims,e[2].dims,a)],p=d=>{let h=C("indices",e[1].dataType,e[1].dims.length),f=C("updates",e[2].dataType,e[2].dims.length,n),g=t.reduction!=="none"&&t.reduction!==""?Ve("output",e[0].dataType,a.length):F("output",e[0].dataType,a.length,n);return`
      ${d.registerUniform("output_size","u32").registerUniform("last_index_dimension","u32").registerUniform("num_updates_elements","u32").declareVariables(h,f,g)}
      ${d.mainStart()}
        ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
  var data_offset = 0u;
  let indices_start = uniforms.last_index_dimension * global_idx;
  let indices_end = indices_start + uniforms.last_index_dimension;
  for (var i = indices_start; i < indices_end; i++) {
    var index = i32(indices[i].x);
    ${e[0].dims.length===1?`
    let element_count_dim = uniforms.output_strides;
    let dim_value = uniforms.output_shape;`:`
    let element_count_dim = uniforms.output_strides[i - indices_start];
    let dim_value = uniforms.output_shape[i - indices_start];`}
    if (index >= 0) {
      if (index >= i32(dim_value)) {
        index = i32(dim_value - 1);
      }
    } else {
      if (index < -i32(dim_value)) {
        index = 0;
      } else {
        index += i32(dim_value);
      }
    }
    data_offset += u32((u32(index) * element_count_dim));
  }

  for (var i = 0u; i < uniforms.num_updates_elements; i++) {
    let value = updates[uniforms.num_updates_elements * global_idx + i];
    ${dd(t.reduction,"output[data_offset + i]","value",g.type.value)}
  }

      }`};return{name:"ScatterND",shaderCache:{hint:`${t.cacheKey}_${t.reduction}`,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:a,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(s/64)},programUniforms:l}),getShaderSource:p}},cd=e=>m({reduction:e.reduction}),hd=(e,t)=>{e.compute(pd(e.inputs,t),{inputs:[e.inputs[1],e.inputs[2]],outputs:[]})}}),fd,md,gd,En,yd,wd,_d,bd,$d,vd,xd,Sd,In,Td,Ed,Id,kd,zd,Cd,Ad,mc=k(()=>{"use strict";ue(),ne(),b(),j(),fd=(e,t)=>{if(e.every(r=>r>0||(()=>{throw new Error("Resize requires scales input values to be positive")})),e.length>0){if(t.mode==="linear"){if(!(e.length===2||e.length===3||e.length===4&&e[0]===1&&e[1]===1||e.length===4&&e[0]===1&&e[3]===1||e.length===5&&e[0]===1&&e[1]===1))throw new Error(`For linear mode, Resize requires scales to be 2D, 3D, 4D with either two outermost or one innermost and
            one outermost scale values equal to 1, or 5D with two outermost scale values equal to 1`)}else if(t.mode==="cubic"&&!(e.length===2||e.length===4&&e[0]===1&&e[1]===1||e.length===4&&e[0]===1&&e[3]===1))throw new Error("Resize requires scales input size to be 2 or 4 for cubic mode")}},md=(e,t,r)=>{t.every(a=>a>=0&&a<r||(()=>{throw new Error("Resize requires axes input values to be positive and less than rank")}));let i=new Array(r).fill(1);return t.forEach((a,n)=>i[a]=e[n]),i},gd=(e,t,r,i,a,n)=>{let[s,o,u]=r>10?[1,2,3]:[-1,e.length>1?1:-1,-1],l=e[0].dims.length;if(s>0&&e.length>s&&e[s].dims.length>0)e[s].getFloat32Array().forEach(p=>n.push(p));else if(t.coordinateTransformMode==="tf_crop_and_resize")throw new Error("Resize requires RoI input to be specified when coordinateTransformMode is tfCropAndResize");if(o>0&&e.length>o&&e[o].dims.length===1&&e[o].dims[0]>0){if(e[o].getFloat32Array().forEach(p=>i.push(p)),i.length!==0&&i.length!==l&&r>=18&&i.length!==t.axes.length)throw new Error("Resize requires scales input size to be same as input rank or axes size for opset 18 and up");fd(i,t),t.axes.length>0&&md(i,t.axes,l).forEach((p,d)=>i[d]=p)}if(u>0&&e.length>u&&e[u].dims.length===1&&e[u].dims[0]>0&&(e[u].getBigInt64Array().forEach(p=>a.push(Number(p))),a.length!==0&&a.length!==l&&r>=18&&a.length!==t.axes.length))throw new Error("Resize requires sizes input size to be same as input rank or axes size for opset 18 and up");if(t.axes.length>0){if(i.length!==0&&i.length!==t.axes.length)throw new Error('Resize requires "scales" input size to be of axes rank when axes attributes is specified');if(a.length!==0&&a.length!==t.axes.length)throw new Error('Resize requires "sizes" input size to be of rank axes rank when axes attributes is specified')}if(typeof i<"u"&&typeof a<"u"&&i.length>0&&a.length>l)throw new Error("Resize requires only of scales or sizes to be specified")},En=(e,t,r,i)=>`
  // The whole part and the fractional part are calculated separately due to inaccuracy of floating
  // point division. As an example, f32(21) / f32(7) may evaluate to 2.99... instead of 3, causing an
  // offset-by-one error later in floor().
  let big = (${e}) * (${t});
  let whole = ${i}(big / (${r}));
  let fract = ${i}(big % (${r})) / ${i}(${r});
  return whole + fract;
`,yd=(e,t)=>`fn getOriginalCoordinateFromResizedCoordinate(xResized: u32, xScale: f32, lengthResized: u32,
     lengthOriginal: u32, roiStart: f32, roiEnd: f32) -> ${t} { `+(()=>{switch(e){case"asymmetric":return`
          if (xScale < 1.0 || floor(xScale) != xScale) {
            return ${t}(xResized) / ${t}(xScale);
          } else {
            ${En("xResized","lengthOriginal","lengthResized",t)}
          }
        `;case"pytorch_half_pixel":return`if (lengthResized > 1) {
                    return (${t}(xResized) + 0.5) / ${t}(xScale) - 0.5;
                  } else {
                    return 0.0;
                  }`;case"tf_half_pixel_for_nn":return`return (${t}(xResized) + 0.5) / ${t}(xScale);`;case"align_corners":return`if (lengthResized == 1) {
                    return 0.0;
                  } else {
                    ${En("xResized","lengthOriginal - 1","lengthResized - 1",t)}
                  }`;case"tf_crop_and_resize":return`if (lengthResized > 1) {
                    return ${t}(roiStart) * ${t}(lengthOriginal - 1) +
                        (${t}(xResized) * ${t}(roiEnd - roiStart) * ${t}(lengthOriginal - 1)) /
                        ${t}(lengthResized - 1);
                  } else {
                    return 0.5 * ${t}(roiStart + roiEnd) * ${t}(lengthOriginal - 1);
                  }`;case"half_pixel_symmetric":return`const outputWidth = ${t}xScale * ${t}(lengthResized);
                  const adjustment = ${t}(lengthResized) / outputWidth;
                  const center = ${t}(lengthOriginal) / 2;
                  const offset = center * (1 - adjustment);
                  return offset + ((${t}(xResized) + 0.5) / ${t}(xScale)) - 0.5;`;case"half_pixel":return`return ((${t}(xResized) + 0.5) / ${t}(xScale)) - 0.5;`;default:throw new Error(`Coordinate transform mode ${e} is not supported`)}})()+"}",wd=(e,t,r)=>`fn getNearestPixelFromOriginal(xOriginal: ${r}, isDownSample: bool) -> ${r} {`+(()=>{switch(e){case"round_prefer_ceil":return"if (fract(xOriginal) == 0.5) {             return ceil(xOriginal);           } else {             return round(xOriginal);           }";case"floor":return"return floor(xOriginal);";case"ceil":return"return ceil(xOriginal);";case"round_prefer_floor":return"if (fract(xOriginal) == 0.5) {                     return floor(xOriginal);                   } else {                     return round(xOriginal);                   }";default:if(t<11)return"if (isDownSample)                     {                       return ceil(xOriginal);                     } else {                       return xOriginal;                     }";throw new Error(`Nearest mode ${e} is not supported`)}})()+"}",_d=(e,t,r)=>{let i=new Array(r).fill(0).concat(new Array(r).fill(1)),a=e.length===0?i:e.slice();return t.length>0?(t.forEach((n,s)=>{i[n]=a[s],i[s+r]=a[t.length+s]}),i):a},bd=(e,t,r,i)=>{let a=[];if(r.length>0)if(i.length>0){if(e.forEach(n=>a.push(n)),Math.max(...i)>e.length)throw new Error("axes is out of bound");i.forEach((n,s)=>a[n]=r[s])}else r.forEach(n=>a.push(n));else{if(t.length===0)throw new Error("Resize requires either scales or sizes.");a=e.map((n,s)=>Math.round(n*t[s]))}return a},$d=(e,t,r)=>{let i=(()=>{switch(r.keepAspectRatioPolicy){case"not_larger":return r.axes.length>0?Math.min(...r.axes.map(n=>t[n]),Number.MAX_VALUE):Math.min(...t,Number.MAX_VALUE);case"not_smaller":return r.axes.length>0?Math.max(...r.axes.map(n=>t[n]),Number.MIN_VALUE):Math.max(...t,Number.MIN_VALUE);default:throw new Error(`Keep aspect ratio policy ${r.keepAspectRatioPolicy} is not supported`)}})();t.fill(1,0,t.length);let a=e.slice();return r.axes.length>0?(r.axes.forEach(n=>t[n]=i),r.axes.forEach(n=>a[n]=Math.round(e[n]*t[n]))):(t.fill(i,0,t.length),a.forEach((n,s)=>a[s]=Math.round(n*t[s]))),a},vd=(e,t,r,i,a)=>`
    fn calculateOriginalIndicesFromOutputIndices(output_indices: ${e.type.indices}) -> array<${e.type.value}, ${r.length}> {
      var original_indices: array<${e.type.value}, ${r.length}>;
      for (var i:u32 = 0; i < ${r.length}; i++) {
        var output_index = ${e.indicesGet("output_indices","i")};
        var scale = ${D("uniforms.scales","i",i)};
        var roi_low = ${D("uniforms.roi","i",a)};
        var roi_hi = ${D("uniforms.roi",`i + ${t.length}`,a)};
        if (scale == 1.0) {
          original_indices[i] = ${e.type.value}(output_index);
        } else {
          var input_shape_i = ${D("uniforms.input_shape","i",t.length)};
          var output_shape_i = ${D("uniforms.output_shape","i",r.length)};
          original_indices[i] = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                           input_shape_i, roi_low, roi_hi);
        }
      }
      return original_indices;
    }`,xd=(e,t,r,i,a,n,s)=>`
    fn calculateInputIndicesFromOutputIndices(output_indices: ${t.type.indices}) -> ${e.type.indices} {
      var input_indices: ${e.type.indices};
      for (var i:u32 = 0; i < ${i.length}; i++) {
        var output_index = ${t.indicesGet("output_indices","i")};
        var input_index: u32;
        var scale = ${D("uniforms.scales","i",a)};
        if (scale == 1.0) {
          input_index = output_index;
        } else {
          var roi_low = ${D("uniforms.roi","i",n)};
          var roi_hi = ${D("uniforms.roi",`i + ${r.length}`,n)};
          var input_shape_i = ${D("uniforms.input_shape","i",r.length)};
          var output_shape_i = ${D("uniforms.output_shape","i",i.length)};
          var original_idx = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                        input_shape_i, roi_low, roi_hi);
          if (!${s} || (original_idx >= 0 && original_idx < ${t.type.value}(input_shape_i))) {
            if (original_idx < 0) {
              input_index = 0;
            } else if (original_idx > ${t.type.value}(input_shape_i - 1)) {
              input_index = input_shape_i - 1;
            } else {
              input_index = u32(getNearestPixelFromOriginal(original_idx, scale < 1));
            }
          } else {
            input_index = u32(original_idx);
          }
        }
        ${e.indicesSet("input_indices","i","input_index")}
      }
      return input_indices;
    }`,Sd=(e,t)=>`
    fn checkInputIndices(input_indices: ${e.type.indices}) -> bool {
      for (var i:u32 = 0; i < ${t.length}; i++) {
        var input_index = ${e.indicesGet("input_indices","i")};
        if (input_index < 0 || input_index >= ${D("uniforms.input_shape","i",t.length)}) {
          return false;
        }
      }
      return true;
    }`,In=(e,t,r,i)=>e.rank>i?`
    ${e.indicesSet("input_indices",t,"channel")};
    ${e.indicesSet("input_indices",r,"batch")};
`:"",Td=(e,t,r,i,a)=>{let[n,s,o,u]=r.length===2?[-1,0,1,-1]:[0,2,3,1],l=e.type.value;return`
    fn getInputValue(batch: u32, channel: u32, row: u32, col: u32) -> ${l} {
      var input_indices: ${e.type.indices};
      ${e.indicesSet("input_indices",s,`max(0, min(row, ${r[s]} - 1))`)};
      ${e.indicesSet("input_indices",o,`max(0, min(col, ${r[o]} - 1))`)};
      ${In(e,u,n,2)}
      return ${e.getByIndices("input_indices")};
    }

    fn bilinearInterpolation(output_indices: ${t.type.indices}) -> ${l} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var row:${l} = originalIndices[${s}];
      var col:${l} = originalIndices[${o}];
      ${i?`if (row < 0 || row > (${r[s]} - 1) || col < 0 || col > (${r[o]} - 1)) {
        return ${a};
      }`:""};
      row = max(0, min(row, ${r[s]} - 1));
      col = max(0, min(col, ${r[o]} - 1));
      var row1: u32 = u32(row);
      var col1: u32 = u32(col);
      var row2: u32 = u32(row + 1);
      var col2: u32 = u32(col + 1);
      var channel: u32 = ${r.length>2?`u32(originalIndices[${u}])`:"0"};
      var batch: u32 =  ${r.length>2?`u32(originalIndices[${n}])`:"0"};
      var x11: ${l} = getInputValue(batch, channel, row1, col1);
      var x12: ${l} = getInputValue(batch, channel, row1, col2);
      var x21: ${l} = getInputValue(batch, channel, row2, col1);
      var x22: ${l} = getInputValue(batch, channel, row2, col2);
      var dx1: ${l} = abs(row - ${l}(row1));
      var dx2: ${l} = abs(${l}(row2) - row);
      var dy1: ${l} = abs(col - ${l}(col1));
      var dy2: ${l} = abs(${l}(col2) - col);
      if (row1 == row2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (col1 == col2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      return (x11 * dx2 * dy2 + x12 * dx2 * dy1 + x21 * dx1 * dy2 + x22 * dx1 * dy1);
    }`},Ed=(e,t,r,i,a,n,s,o,u,l)=>{let[p,d]=r.length===2?[0,1]:[2,3],h=e.type.value,f=g=>{let w=g===p?"row":"col";return`
      fn ${w}CubicInterpolation(input_indices: ${e.type.indices}, output_indices: ${t.type.indices}) -> ${h} {
        var output_index = ${t.indicesGet("output_indices",g)};
        var originalIdx: ${h} = getOriginalCoordinateFromResizedCoordinate(output_index, ${a[g]},
        ${i[g]}, ${r[g]}, ${n[g]}, ${n[g]} + ${r.length});
        var fractOriginalIdx: ${h} = originalIdx - floor(originalIdx);
        var coefs = getCubicInterpolationCoefs(fractOriginalIdx);

        if (${o} && (originalIdx < 0 || originalIdx > (${r[g]} - 1))) {
          return ${u};
        }
        var data: array<${h}, 4> = array<${h}, 4>(0.0, 0.0, 0.0, 0.0);
        for (var i: i32 = -1; i < 3; i++) {
          var ${w}: ${h} = originalIdx + ${h}(i);
          if (${w} < 0 || ${w} >= ${r[g]}) {
            ${l?`coefs[i + 1] = 0.0;
                        continue;`:o?`return ${u};`:`${w} = max(0, min(${w}, ${r[g]} - 1));`};
          }
        var input_indices_copy: ${e.type.indices} = input_indices;
          ${e.indicesSet("input_indices_copy",g,`u32(${w})`)};
          data[i + 1] = ${g===p?e.getByIndices("input_indices_copy"):"rowCubicInterpolation(input_indices_copy, output_indices)"};
        }
        return cubicInterpolation1D(data, coefs);
      }`};return`
    ${f(p)};
    ${f(d)};
  fn getCubicInterpolationCoefs(s: ${h}) -> array<${h}, 4> {
    var absS = abs(s);
    var coeffs: array<${h}, 4> = array<${h}, 4>(0.0, 0.0, 0.0, 0.0);
    var oneMinusAbsS: ${h} = 1.0 - absS;
    var twoMinusAbsS: ${h} = 2.0 - absS;
    var onePlusAbsS: ${h} = 1.0 + absS;
    coeffs[0] = ((${s} * onePlusAbsS - 5 * ${s}) * onePlusAbsS + 8 * ${s}) * onePlusAbsS - 4 * ${s};
    coeffs[1] = ((${s} + 2) * absS - (${s} + 3)) * absS * absS + 1;
    coeffs[2] = ((${s} + 2) * oneMinusAbsS - (${s} + 3)) * oneMinusAbsS * oneMinusAbsS + 1;
    coeffs[3] = ((${s} * twoMinusAbsS - 5 * ${s}) * twoMinusAbsS + 8 * ${s}) * twoMinusAbsS - 4 * ${s};
    return coeffs;
  }

  fn cubicInterpolation1D(x: array<${h}, 4>, coefs: array<${h}, 4>) -> ${h} {
    var coefsSum: ${h} = coefs[0] + coefs[1] + coefs[2] + coefs[3];
    return (x[0] * coefs[0] + x[1] * coefs[1]+ x[2] * coefs[2]+ x[3] * coefs[3]) / coefsSum;
  }

  fn bicubicInterpolation(output_indices: ${t.type.indices}) -> ${h} {
    var input_indices: ${e.type.indices} = output_indices;
    return colCubicInterpolation(input_indices, output_indices);
  }
    `},Id=(e,t,r,i,a)=>{let[n,s,o,u,l]=r.length===3?[-1,0,1,2,-1]:[0,2,3,4,1],p=e.type.value;return`
    fn getInputValue(batch: u32, channel: u32, depth:u32, height: u32, width: u32) -> ${p} {
      var input_indices: ${e.type.indices};
      ${e.indicesSet("input_indices",s,`max(0, min(depth, ${r[s]} - 1))`)};
      ${e.indicesSet("input_indices",o,`max(0, min(height, ${r[o]} - 1))`)};
      ${e.indicesSet("input_indices",u,`max(0, min(width, ${r[u]} - 1))`)};
      ${In(e,l,n,3)}
      return ${e.getByIndices("input_indices")};
    }

    fn trilinearInterpolation(output_indices: ${t.type.indices}) -> ${p} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var depth:${p} = originalIndices[${s}];
      var height:${p} = originalIndices[${o}];
      var width:${p} = originalIndices[${u}];
      ${i?`if (depth < 0 || depth > (${r[s]} - 1) || height < 0 || height > (${r[o]} - 1) || width < 0 || (width > ${r[u]} - 1)) {
      return ${a};
        }`:""};

    depth = max(0, min(depth, ${r[s]} - 1));
      height = max(0, min(height, ${r[o]} - 1));
      width = max(0, min(width, ${r[u]} - 1));
      var depth1: u32 = u32(depth);
      var height1: u32 = u32(height);
      var width1: u32 = u32(width);
      var depth2: u32 = u32(depth + 1);
      var height2: u32 = u32(height + 1);
      var width2: u32 = u32(width + 1);
      var channel: u32 = ${r.length>3?`u32(originalIndices[${l}])`:"0"};
      var batch: u32 =  ${r.length>3?`u32(originalIndices[${n}])`:"0"};

      var x111: ${p} = getInputValue(batch, channel, depth1, height1, width1);
      var x112: ${p} = getInputValue(batch, channel, depth1, height1, width2);
      var x121: ${p} = getInputValue(batch, channel, depth1, height2, width1);
      var x122: ${p} = getInputValue(batch, channel, depth1, height2, width2);
      var x211: ${p} = getInputValue(batch, channel, depth2, height1, width1);
      var x212: ${p} = getInputValue(batch, channel, depth2, height1, width2);
      var x221: ${p} = getInputValue(batch, channel, depth2, height2, width1);
      var x222: ${p} = getInputValue(batch, channel, depth2, height2, width2);
      var dx1: ${p} = abs(depth - ${p}(depth1));
      var dx2: ${p} = abs(${p}(depth2) - depth);
      var dy1: ${p} = abs(height - ${p}(height1));
      var dy2: ${p} = abs(${p}(height2) - height);
      var dz1: ${p} = abs(width - ${p}(width1));
      var dz2: ${p} = abs(${p}(width2) - width);
      if (depth1 == depth2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (height1 == height2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      if (width1 == width2) {
        dz1 = 0.5;
        dz2 = 0.5;
      }
      return (x111 * dx2 * dy2 * dz2 + x112 * dx2 * dy2 * dz1 + x121 * dx2 * dy1 *dz2 + x122 * dx2 * dy1 * dz1 +
              x211 * dx1 * dy2 * dz2 + x212 * dx1 * dy2 * dz1 + x221 * dx1 * dy1 *dz2 + x222 * dx1 * dy1 * dz1);
    }`},kd=(e,t,r,i,a,n)=>{let s=e.dims,o=_d(n,t.axes,s.length),u=bd(s,i,a,t.axes),l=i.slice();i.length===0&&(l=s.map((y,v)=>y===0?1:u[v]/y),t.keepAspectRatioPolicy!=="stretch"&&(u=$d(s,l,t)));let p=F("output",e.dataType,u.length),d=C("input",e.dataType,s.length),h=M.size(u),f=s.length===u.length&&s.every((y,v)=>y===u[v]),g=t.coordinateTransformMode==="tf_crop_and_resize",w=t.extrapolationValue,$=d.type.value,_=y=>`
      ${f?"":`
      ${yd(t.coordinateTransformMode,$)};
      ${(()=>{switch(t.mode){case"nearest":return`
              ${Sd(d,s)};
              ${wd(t.nearestMode,r,$)};
              ${xd(d,p,s,u,l.length,o.length,g)};
              `;case"linear":return`
              ${vd(p,s,u,l.length,o.length)};
              ${(()=>{if(s.length===2||s.length===4)return`${Td(d,p,s,g,w)}`;if(s.length===3||s.length===5)return`${Id(d,p,s,g,w)}`;throw Error("Linear mode only supports input dims 2, 3, 4 and 5 are supported in linear mode.")})()};
            `;case"cubic":return`
            ${(()=>{if(s.length===2||s.length===4)return`${Ed(d,p,s,u,l,o,t.cubicCoeffA,g,t.extrapolationValue,t.excludeOutside)}`;throw Error("Cubic mode only supports input dims 2 and 4 are supported in linear mode.")})()};
            `;default:throw Error("Invalid resize mode")}})()};
      `}
      ${y.registerUniform("output_size","u32").registerUniform("scales","f32",l.length).registerUniform("roi","f32",o.length).declareVariables(d,p)}
      ${y.mainStart()}
        ${y.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
        ${f?"output[global_idx] = input[global_idx];":`
        let output_indices = ${p.offsetToIndices("global_idx")};
        var input_indices: ${d.type.indices};
        ${(()=>{switch(t.mode){case"nearest":return`input_indices = calculateInputIndicesFromOutputIndices(output_indices);
                if (checkInputIndices(input_indices)) {
                  output[global_idx] = ${d.getByIndices("input_indices")};
                } else {
                  output[global_idx] = ${t.extrapolationValue};
                }`;case"linear":return`output[global_idx] = ${s.length===2||s.length===4?"bilinearInterpolation":"trilinearInterpolation"}(output_indices);`;case"cubic":return"output[global_idx] = bicubicInterpolation(output_indices);";default:throw Error(`Unsupported resize mode: ${t.mode}`)}})()};
`}
      }`;return{name:"Resize",shaderCache:{hint:`${t.cacheKey}|${r}|${l.length>0?t.mode==="cubic"?l:l.length:""}|${a.length>0?a:""}|${o.length>0?o:""}|${f}|${t.mode==="nearest"?s.length:s}`,inputDependencies:["rank"]},getShaderSource:_,getRunData:()=>({outputs:[{dims:u,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(h/64)},programUniforms:[{type:12,data:h},{type:1,data:l},{type:1,data:o},...E(s,u)]})}},zd=e=>{let t=e.customDataBuffer;return new Uint32Array(t,t.byteOffset,1)[0]},Cd=(e,t)=>{let r=[],i=[],a=[],n=zd(e);if(t.antialias!==0)throw Error("Only default value (0) for Antialias attribute is supported");gd(e.inputs,t,n,r,i,a),e.compute(kd(e.inputs[0],t,n,r,i,a),{inputs:[0]})},Ad=e=>{let t=e.antialias,r=e.axes,i=e.coordinateTransformMode,a=e.cubicCoeffA,n=e.excludeOutside!==0,s=e.extrapolationValue,o=e.keepAspectRatioPolicy,u=e.mode,l=e.nearestMode===""?"simple":e.nearestMode;return m({antialias:t,axes:r,coordinateTransformMode:i,cubicCoeffA:a,excludeOutside:n,extrapolationValue:s,keepAspectRatioPolicy:o,mode:u,nearestMode:l})}}),Od,Rd,Bd,gc=k(()=>{"use strict";ue(),ne(),j(),Od=e=>{if(!e||e.length<3)throw new Error("layerNorm requires at least 3 inputs.");let t=e[0],r=e[1],i=e[2];if(t.dataType!==r.dataType||t.dataType!==i.dataType)throw new Error("All inputs must have the same data type");if(t.dims.length!==3&&t.dims.length!==2)throw new Error("Input must be 2D or 3D");if(r.dims.length!==3&&r.dims.length!==2)throw new Error("Skip must be 2D or 3D");let a=t.dims[t.dims.length-1],n=t.dims[t.dims.length-2];if(r.dims[r.dims.length-1]!==a)throw new Error("Skip must have the same hidden size as input");if(r.dims[r.dims.length-2]!==n)throw new Error("Skip must have the same sequence length as input");if(i.dims.length!==1)throw new Error("Gamma must be 1D");if(i.dims[i.dims.length-1]!==a)throw new Error("Gamma must have the same hidden size as input");if(e.length>3){let s=e[3];if(s.dims.length!==1)throw new Error("Beta must be 1D");if(s.dims[s.dims.length-1]!==a)throw new Error("Beta must have the same hidden size as input")}if(e.length>4){let s=e[4];if(s.dims.length!==1)throw new Error("Bias must be 1D");if(s.dims[s.dims.length-1]!==a)throw new Error("Bias must have the same hidden size as input")}},Rd=(e,t,r,i)=>{let a=t.simplified,n=e[0].dims,s=M.size(n),o=n,u=s,l=n.slice(-1)[0],p=i?n.slice(0,-1).concat(1):[],d=!a&&e.length>3,h=e.length>4,f=i&&r>1,g=i&&r>2,w=r>3,$=64,_=A(l),y=[{type:12,data:u},{type:12,data:_},{type:12,data:l},{type:1,data:t.epsilon}],v=I=>{let B=[{name:"output_size",type:"u32"},{name:"components",type:"u32"},{name:"hidden_size",type:"u32"},{name:"epsilon",type:"f32"}],R=[C("x",e[0].dataType,e[0].dims,_),C("skip",e[1].dataType,e[1].dims,_),C("gamma",e[2].dataType,e[2].dims,_)];d&&R.push(C("beta",e[3].dataType,e[3].dims,_)),h&&R.push(C("bias",e[4].dataType,e[4].dims,_)),R.push(F("output",e[0].dataType,o,_)),f&&R.push(F("mean_output",1,p)),g&&R.push(F("inv_std_output",1,p)),w&&R.push(F("input_skip_bias_sum",e[0].dataType,o,_));let N=O(e[0].dataType),G=O(1,_);return`

      ${I.registerUniforms(B).declareVariables(...R)}
      var<workgroup> sum_shared : array<${G}, ${$}>;
      var<workgroup> sum_squared_shared : array<${G}, ${$}>;

      ${I.mainStart([$,1,1])}
        let ix = local_id.x;
        let iy = global_id.x / ${$};

        let hidden_size_vectorized: u32 = uniforms.hidden_size / uniforms.components;
        var stride = hidden_size_vectorized / ${$};
        let offset = ix * stride + iy * hidden_size_vectorized;
        let offset1d = stride * ix;
        if (ix == ${$-1}) {
          stride = hidden_size_vectorized - stride * ix;
        }
        for (var i: u32 = 0; i < stride; i++) {
          let skip_value = skip[offset + i];
          let bias_value = ${h?"bias[offset1d + i]":N+"(0.0)"};
          let input_value = x[offset + i];
          let value = input_value + skip_value + bias_value;
          ${w?"input_skip_bias_sum[offset + i] = value;":""}
          output[offset + i] = value;
          let f32_value = ${q(N,_,"value")};
          sum_shared[ix] += f32_value;
          sum_squared_shared[ix] += f32_value * f32_value;
        }
        workgroupBarrier();

        var reduce_size : u32 = ${$};
        for (var curr_size = reduce_size >> 1;  curr_size > 0; curr_size = reduce_size >> 1) {
          reduce_size = curr_size + (reduce_size & 1);
          if (ix < curr_size) {
            sum_shared[ix] += sum_shared[ix + reduce_size];
            sum_squared_shared[ix] += sum_squared_shared[ix + reduce_size];
          }
          workgroupBarrier();
        }

        let sum = sum_shared[0];
        let square_sum = sum_squared_shared[0];
        let mean = ${P("sum",_)} / f32(uniforms.hidden_size);
        let inv_std_dev = inverseSqrt(${P("square_sum",_)} / f32(uniforms.hidden_size) ${a?"":"- mean * mean"} + uniforms.epsilon);
        ${f?"mean_output[global_idx] = mean;":""}
        ${g?"inv_std_output[global_idx] = inv_std_dev;":""}

        for (var i: u32 = 0; i < stride; i++) {
          output[offset + i] = (output[offset + i] ${a?"":`- ${N}(mean)`}) *
            ${N}(inv_std_dev) * gamma[offset1d + i]
            ${d?"+ beta[offset1d + i]":""};
        }
      }`},x=[{dims:o,dataType:e[0].dataType}];return r>1&&x.push({dims:p,dataType:1}),r>2&&x.push({dims:p,dataType:1}),r>3&&x.push({dims:n,dataType:e[0].dataType}),{name:"SkipLayerNormalization",shaderCache:{hint:`${_};${f};${g};${w}`,inputDependencies:e.map((I,B)=>"type")},getShaderSource:v,getRunData:()=>({outputs:x,dispatchGroup:{x:Math.ceil(u/l)},programUniforms:y})}},Bd=(e,t)=>{Od(e.inputs);let r=[0];e.outputCount>1&&r.push(-3),e.outputCount>2&&r.push(-3),e.outputCount>3&&r.push(3),e.compute(Rd(e.inputs,t,e.outputCount,!1),{outputs:r})}}),Md,ta,Dd,kn,Pd,Ud,Nd,Ld,yc=k(()=>{"use strict";ue(),ne(),b(),j(),Md=(e,t)=>{if(!e||e.length<1)throw new Error("too few inputs");if(t.axes.length!==0){if(t.axes.length!==t.starts.length||t.axes.length!==t.ends.length)throw new Error("axes, starts and ends must have the same length")}else if(t.starts.length!==t.ends.length)throw new Error("starts and ends must have the same length");e.slice(1).forEach((r,i)=>{if(e[i+1].dataType!==6&&e[i+1].dataType!==7)throw new Error(`Input ${i} must be an array of int32 or int64`)})},ta=(e,t)=>{let r=[];if(e.length>t)if(e[t].dataType===7)e[t].getBigInt64Array().forEach(i=>r.push(Number(i)));else if(e[t].dataType===6)e[t].getInt32Array().forEach(i=>r.push(Number(i)));else throw new Error(`Input ${t} must be an array of int32 or int64`);return r},Dd=(e,t)=>{if(e.length>1){let r=ta(e,1),i=ta(e,2),a=ta(e,3);return a.length===0&&(a=[...Array(e[0].dims.length).keys()]),m({starts:r,ends:i,axes:a})}else return t},kn=(e,t,r,i,a)=>{let n=e;return e<0&&(n+=r[i[t]]),a[t]<0?Math.max(0,Math.min(n,r[i[t]]-1)):Math.max(0,Math.min(n,r[i[t]]))},Pd=(e,t,r)=>`fn calculateInputIndices(output_indices: ${t.type.indices}) -> ${e.type.indices} {
          var input_indices: ${e.type.indices};
          var carry = 0u;
          for (var i = ${r.length-1}; i >= 0; i--) {
            let input_shape_i = ${D("uniforms.input_shape","i",r.length)};
            let steps_i = ${D("uniforms.steps","i",r.length)};
            let signs_i = ${D("uniforms.signs","i",r.length)};
            let starts_i = ${D("uniforms.starts","i",r.length)};
            var output_index = ${t.indicesGet("output_indices","i")};
            var input_index = output_index * steps_i + starts_i + carry;
            carry = input_index / input_shape_i;
            input_index = input_index % input_shape_i;
            if (signs_i < 0) {
              input_index = input_shape_i - input_index - 1u + starts_i;
            }
            ${e.indicesSet("input_indices","i","input_index")};
          }
          return input_indices;
      }`,Ud=(e,t)=>{let r=e[0].dims,i=M.size(r),a=t.axes.length>0?M.normalizeAxes(t.axes,r.length):[...Array(r.length).keys()],n=ta(e,4);n.forEach(_=>_!==0||(()=>{throw new Error("step cannot be 0")})),n.length===0&&(n=Array(a.length).fill(1));let s=t.starts.map((_,y)=>kn(_,y,r,a,n)),o=t.ends.map((_,y)=>kn(_,y,r,a,n));if(a.length!==s.length||a.length!==o.length)throw new Error("start, ends and axes should have the same number of elements");if(a.length!==r.length)for(let _=0;_<r.length;++_)a.includes(_)||(s.splice(_,0,0),o.splice(_,0,r[_]),n.splice(_,0,1));let u=n.map(_=>Math.sign(_));n.forEach((_,y,v)=>{if(_<0){let x=(o[y]-s[y])/_,I=s[y];s[y]=I+x*n[y],o[y]=I,v[y]=-_}});let l=r.slice(0);a.forEach((_,y)=>{l[_]=Math.ceil((o[_]-s[_])/n[_])});let p={dims:l,dataType:e[0].dataType},d=F("output",e[0].dataType,l.length),h=C("input",e[0].dataType,e[0].dims.length),f=M.size(l),g=[{name:"outputSize",type:"u32"},{name:"starts",type:"u32",length:s.length},{name:"signs",type:"i32",length:u.length},{name:"steps",type:"u32",length:n.length}],w=[{type:12,data:f},{type:12,data:s},{type:6,data:u},{type:12,data:n},...E(e[0].dims,l)],$=_=>`
      ${_.registerUniforms(g).declareVariables(h,d)}
        ${Pd(h,d,r)}
        ${_.mainStart()}
          ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
          let output_indices = ${d.offsetToIndices("global_idx")};
          let input_indices = calculateInputIndices(output_indices);
          ${d.setByOffset("global_idx",h.getByIndices("input_indices"))}
      }`;return{name:"Slice",shaderCache:{hint:`${u.length}_${s.length}_${n.length}`,inputDependencies:["rank"]},getShaderSource:$,getRunData:()=>({outputs:[p],dispatchGroup:{x:Math.ceil(i/64)},programUniforms:w})}},Nd=(e,t)=>{Md(e.inputs,t);let r=Dd(e.inputs,t);e.compute(Ud(e.inputs,r),{inputs:[0]})},Ld=e=>{let t=e.starts,r=e.ends,i=e.axes;return m({starts:t,ends:r,axes:i})}}),Vd,qd,Fd,Gd,wc=k(()=>{"use strict";ue(),ne(),b(),we(),j(),Vd=e=>{if(!e||e.length!==1)throw new Error("Softmax op requires 1 input.")},qd=(e,t)=>{let r=e.inputs[0],i=r.dims,a=M.size(i),n=i.length,s=M.normalizeAxis(t.axis,n),o=s<i.length-1,u,l=[];o?(l=Array.from({length:n},(R,N)=>N),l[s]=n-1,l[n-1]=s,u=e.compute(Fe(r,l),{inputs:[r],outputs:[-1]})[0]):u=r;let p=u.dims,d=p[n-1],h=a/d,f=A(d),g=d/f,w=64;h===1&&(w=256);let $=(R,N)=>N===4?`max(max(${R}.x, ${R}.y), max(${R}.z, ${R}.w))`:N===2?`max(${R}.x, ${R}.y)`:N===3?`max(max(${R}.x, ${R}.y), ${R}.z)`:R,_=C("x",u.dataType,u.dims,f),y=F("result",u.dataType,u.dims,f),v=_.type.value,x=O(u.dataType)==="f32"?`var threadMax = ${v}(-3.4028234663852886e+38f);`:`var threadMax = ${v}(-65504.0h);`,I=R=>`
      var<workgroup> rowMaxShared : ${v};
      var<workgroup> rowSumShared : ${v};
      var<workgroup> threadShared : array<${v}, ${w}>;

      fn getValue(row: i32, col: i32, row_stride: i32) -> ${v} {
        let index = row * row_stride + col;
        return x[index];
      }

      fn setValue(row: i32, col: i32, row_stride: i32, value: ${v}) {
        let index = row * row_stride + col;
        result[index] = value;
      }
      ${R.registerUniform("packedCols","i32").declareVariables(_,y)}
      ${R.mainStart(w)}
        let gindex = i32(global_idx);
        let lindex = i32(local_idx);
        const wg = ${w};
        let row = gindex / wg;
        let cols = uniforms.packedCols;
        let row_stride : i32 = uniforms.packedCols;

        // find the rows max
        ${x}
        for (var col = lindex; col < cols; col += wg) {
          let value = getValue(row, col, row_stride);
          threadMax = max(threadMax, value);
        }
        if (lindex < cols) {
          threadShared[lindex] = threadMax;
        }
        workgroupBarrier();

        var reduceSize = min(cols, wg);
        for (var currSize = reduceSize >> 1;  currSize > 0; currSize = reduceSize >> 1) {
          reduceSize = currSize + (reduceSize & 1);
          if (lindex < currSize) {
            threadShared[lindex] = max(threadShared[lindex], threadShared[lindex + reduceSize]);
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowMaxShared = ${v}(${$("threadShared[0]",f)});
        }
        workgroupBarrier();

        // find the rows sum
        var threadSum = ${v}(0.0);
        for (var col = lindex; col < cols; col += wg) {
          let subExp = exp(getValue(row, col, row_stride) - rowMaxShared);
          threadSum += subExp;
        }
        threadShared[lindex] = threadSum;
        workgroupBarrier();

        for (var currSize = wg >> 1;  currSize > 0; currSize = currSize >> 1) {
          if (lindex < currSize) {
            threadShared[lindex] = threadShared[lindex] + threadShared[lindex + currSize];
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowSumShared = ${v}(${P("threadShared[0]",f)});
        }
        workgroupBarrier();

        // calculate final value for each element in the row
        for (var col = lindex; col < cols; col += wg) {
          var value = exp(getValue(row, col, row_stride) - rowMaxShared) / rowSumShared;
          // max operation protects against NaN since all values should be >=0
          value = max(value, ${v}(0.0));
          setValue(row, col, row_stride, value);
        }
      }`,B=e.compute({name:"Softmax",shaderCache:{hint:`${f};${w}`,inputDependencies:["type"]},getRunData:()=>({outputs:[{dims:p,dataType:u.dataType}],dispatchGroup:{x:h},programUniforms:[{type:6,data:g}]}),getShaderSource:I},{inputs:[u],outputs:[o?-1:0]})[0];o&&e.compute(Fe(B,l),{inputs:[B]})},Fd=(e,t)=>{Vd(e.inputs),qd(e,t)},Gd=e=>m({axis:e.axis})}),zn,Wd,Hd,jd,Kd,_c=k(()=>{"use strict";ue(),ne(),j(),zn=e=>Array.from(e.getBigInt64Array(),Number),Wd=e=>{if(!e||e.length!==2)throw new Error("Tile requires 2 inputs.");if(e[0].dataType!==1&&e[0].dataType!==10&&e[0].dataType!==6&&e[0].dataType!==12)throw new Error("Tile only support float, float16, int32, and uint32 data types");if(e[1].dataType!==7)throw new Error("Tile `repeats` input should be of int64 data type");if(e[1].dims.length!==1)throw new Error("Tile `repeats` input should be 1-D");if(zn(e[1]).length!==e[0].dims.length)throw new Error("Tile `repeats` input should have same number of elements as rank of input data tensor")},Hd=(e,t)=>{let r=[];for(let i=0;i<e.length;++i)r.push(e[i]*t[i]);return r},jd=(e,t)=>{let r=e[0].dims,i=t??zn(e[1]),a=Hd(r,i),n=M.size(a),s=e[0].dataType,o=C("input",s,r.length),u=F("output",s,a.length),l=p=>`
      const inputShape = ${o.indices(...r)};
      ${p.registerUniform("output_size","u32").declareVariables(o,u)}
      ${p.mainStart()}
      ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let output_indices = ${u.offsetToIndices("global_idx")};
      var input_indices: ${o.type.indices};
      for (var i = 0; i < ${r.length}; i++) {
        let input_dim_i = ${o.indicesGet("uniforms.input_shape","i")};
        let input_dim_value = ${u.indicesGet("output_indices","i")}  % input_dim_i;

        ${o.indicesSet("input_indices","i","input_dim_value")}
      }
      ${u.setByOffset("global_idx",o.getByIndices("input_indices"))}
    }`;return{name:"Tile",shaderCache:{hint:`${i}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:a,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(n/64)},programUniforms:[{type:12,data:n},...E(e[0].dims,a)]}),getShaderSource:l}},Kd=e=>{Wd(e.inputs),e.compute(jd(e.inputs),{inputs:[0]})}}),Zd,Qd,Xd,bc=k(()=>{"use strict";ue(),ne(),j(),Zd=(e,t,r,i,a)=>{let n=F("output_data",a,r.length,4),s=C("a_data",t[1].dataType,t[1].dims.length,4),o=C("b_data",t[2].dataType,t[2].dims.length,4),u=C("c_data",t[0].dataType,t[0].dims.length,4),l,p=(d,h,f)=>`select(${h}, ${d}, ${f})`;if(!i)l=n.setByOffset("global_idx",p(s.getByOffset("global_idx"),o.getByOffset("global_idx"),u.getByOffset("global_idx")));else{let d=(h,f,g="")=>{let w=`a_data[index_a${f}][component_a${f}]`,$=`b_data[index_b${f}][component_b${f}]`,_=`bool(c_data[index_c${f}] & (0xffu << (component_c${f} * 8)))`;return`
            let output_indices${f} = ${n.offsetToIndices(`global_idx * 4u + ${f}u`)};
            let offset_a${f} = ${s.broadcastedIndicesToOffset(`output_indices${f}`,n)};
            let offset_b${f} = ${o.broadcastedIndicesToOffset(`output_indices${f}`,n)};
            let offset_c${f} = ${u.broadcastedIndicesToOffset(`output_indices${f}`,n)};
            let index_a${f} = offset_a${f} / 4u;
            let index_b${f} = offset_b${f} / 4u;
            let index_c${f} = offset_c${f} / 4u;
            let component_a${f} = offset_a${f} % 4u;
            let component_b${f} = offset_b${f} % 4u;
            let component_c${f} = offset_c${f} % 4u;
            ${h}[${f}] = ${g}(${p(w,$,_)});
          `};a===9?l=`
            var data = vec4<u32>(0);
            ${d("data",0,"u32")}
            ${d("data",1,"u32")}
            ${d("data",2,"u32")}
            ${d("data",3,"u32")}
            output_data[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));`:l=`
            ${d("output_data[global_idx]",0)}
            ${d("output_data[global_idx]",1)}
            ${d("output_data[global_idx]",2)}
            ${d("output_data[global_idx]",3)}
          `}return`
        ${e.registerUniform("vec_size","u32").declareVariables(u,s,o,n)}
        ${e.mainStart()}
        ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${l}
      }`},Qd=e=>{let t=e[1].dims,r=e[2].dims,i=e[0].dims,a=e[1].dataType,n=!(M.areEqual(t,r)&&M.areEqual(r,i)),s=t,o=M.size(t);if(n){let l=Ut.calcShape(Ut.calcShape(t,r,!1),i,!1);if(!l)throw new Error("Can't perform where op on the given tensors");s=l,o=M.size(s)}let u=Math.ceil(o/4);return{name:"Where",shaderCache:{inputDependencies:["rank","rank","rank"]},getShaderSource:l=>Zd(l,e,s,n,a),getRunData:()=>({outputs:[{dims:s,dataType:a}],dispatchGroup:{x:Math.ceil(o/64/4)},programUniforms:[{type:12,data:u},...E(i,t,r,s)]})}},Xd=e=>{e.compute(Qd(e.inputs))}}),Yd,$c=k(()=>{"use strict";Mp(),Ga(),Dp(),Pp(),Up(),Np(),Lp(),Wp(),jp(),Kp(),Zp(),Qp(),Xp(),Yp(),Jp(),ec(),tc(),rc(),ic(),ac(),nc(),sc(),oc(),uc(),lc(),dl(),dc(),pc(),cc(),hc(),fc(),Va(),mc(),bl(),gc(),yc(),wc(),yl(),_c(),we(),Ka(),bc(),Yd=new Map([["Abs",[As]],["Acos",[Os]],["Acosh",[Rs]],["Add",[$o]],["ArgMax",[gs,Fa]],["ArgMin",[ms,Fa]],["Asin",[Bs]],["Asinh",[Ms]],["Atan",[Ds]],["Atanh",[Ps]],["Attention",[vs]],["AveragePool",[Ql,Zl]],["BatchNormalization",[Es]],["BiasAdd",[zs]],["BiasSplitGelu",[wo]],["Cast",[Ns,Us]],["Ceil",[qs]],["Clip",[Vs]],["Concat",[Mo,Do]],["Conv",[un,sn]],["ConvTranspose",[lu,su]],["Cos",[Fs]],["Cosh",[Gs]],["CumSum",[pu,cu]],["DepthToSpace",[gu,yu]],["DequantizeLinear",[nd,sd]],["Div",[vo]],["Einsum",[xu,Su]],["Elu",[Ws,Zi]],["Equal",[xo]],["Erf",[Hs]],["Exp",[js]],["Expand",[ku]],["FastGelu",[Cu]],["Floor",[Ks]],["FusedConv",[un,sn]],["Gather",[Bu,Ru]],["GatherElements",[Wu,Gu]],["GatherBlockQuantized",[Lu,Vu]],["GatherND",[Du,Pu]],["Gelu",[Zs]],["Gemm",[Zu,Ku]],["GlobalAveragePool",[Yl,Xl]],["GlobalMaxPool",[rd,td]],["Greater",[Io]],["GreaterOrEqual",[zo]],["GridSample",[al,nl]],["GroupQueryAttention",[Sl]],["HardSigmoid",[io,ro]],["InstanceNormalization",[Il]],["LayerNormalization",[Cl]],["LeakyRelu",[Qs,Zi]],["Less",[ko]],["LessOrEqual",[Co]],["Log",[co]],["MatMul",[Ol]],["MatMulNBits",[Dl,Pl]],["MaxPool",[Jl,ed]],["Mul",[So]],["MultiHeadAttention",[ll,ol]],["Neg",[Ys]],["Not",[Xs]],["Pad",[Hl]],["Pow",[To]],["QuickGelu",[mo,Zi]],["Range",[ld]],["Reciprocal",[Js]],["ReduceMin",[ds]],["ReduceMean",[ns]],["ReduceMax",[ls]],["ReduceSum",[cs]],["ReduceProd",[ps]],["ReduceL1",[ss]],["ReduceL2",[os]],["ReduceLogSum",[fs]],["ReduceLogSumExp",[us]],["ReduceSumSquare",[hs]],["Relu",[eo]],["Resize",[Cd,Ad]],["RotaryEmbedding",[_l]],["ScatterND",[hd,cd]],["Sigmoid",[to]],["Sin",[ao]],["Sinh",[no]],["Slice",[Nd,Ld]],["SkipLayerNormalization",[Bd]],["Split",[ml,gl]],["Sqrt",[so]],["Softmax",[Fd,Gd]],["Sub",[Eo]],["Tan",[oo]],["Tanh",[uo]],["ThresholdedRelu",[po,Zi]],["Tile",[Kd]],["Transpose",[_t,Hi]],["Where",[Xd]]])}),Jd,vc=k(()=>{"use strict";Xe(),yt(),j(),Jd=class{constructor(e){this.backend=e,this.repo=new Map,this.attributesBound=!1}getArtifact(e){return this.repo.get(e)}setArtifact(e,t){this.repo.set(e,t)}run(e,t,r,i,a){et(e.programInfo.name);let n=this.backend.device,s=this.backend.getComputePassEncoder();this.backend.writeTimestamp(this.backend.pendingDispatchNumber*2);let o=[];for(let l of t)o.push({binding:o.length,resource:{buffer:l.buffer}});for(let l of r)o.push({binding:o.length,resource:{buffer:l.buffer}});a&&o.push({binding:o.length,resource:a});let u=n.createBindGroup({layout:e.computePipeline.getBindGroupLayout(0),entries:o,label:e.programInfo.name});if(this.backend.sessionStatus==="capturing"){let l={kernelId:this.backend.currentKernelId,computePipeline:e.computePipeline,bindGroup:u,dispatchGroup:i};this.backend.capturedCommandList.get(this.backend.currentSessionId).push(l)}s.setPipeline(e.computePipeline),s.setBindGroup(0,u),s.dispatchWorkgroups(...i),this.backend.writeTimestamp(this.backend.pendingDispatchNumber*2+1),this.backend.pendingDispatchNumber++,(this.backend.pendingDispatchNumber>=this.backend.maxDispatchNumber||this.backend.queryType==="at-passes")&&this.backend.endComputePass(),this.backend.pendingDispatchNumber>=this.backend.maxDispatchNumber&&this.backend.flush(),Qe(e.programInfo.name)}dispose(){}build(e,t){et(e.name);let r=this.backend.device,i=[];[{feature:"shader-f16",extension:"f16"},{feature:"subgroups",extension:"subgroups"}].forEach(l=>{r.features.has(l.feature)&&i.push(`enable ${l.extension};`)});let a=Oe(t,this.backend.device.limits),n=e.getShaderSource(a),s=`${i.join(`
`)}
${a.additionalImplementations}
${n}`,o=r.createShaderModule({code:s,label:e.name});ze("verbose",()=>`[WebGPU] ${e.name} shader code: ${s}`);let u=r.createComputePipeline({compute:{module:o,entryPoint:"main"},layout:"auto",label:e.name});return Qe(e.name),{programInfo:e,computePipeline:u,uniformVariablesInfo:a.variablesInfo}}normalizeDispatchGroupSize(e){let t=typeof e=="number"?e:e.x,r=typeof e=="number"?1:e.y||1,i=typeof e=="number"?1:e.z||1,a=this.backend.device.limits.maxComputeWorkgroupsPerDimension;if(t<=a&&r<=a&&i<=a)return[t,r,i];let n=t*r*i,s=Math.ceil(Math.sqrt(n));if(s>a){if(s=Math.ceil(Math.cbrt(n)),s>a)throw new Error("Total dispatch size exceeds WebGPU maximum.");return[s,s,s]}else return[s,s,1]}}}),ep={};ie(ep,{WebGpuBackend:()=>ap});var tp,rp,ip,ap,xc=k(()=>{"use strict";Xe(),ue(),yt(),Xt(),Na(),$c(),vc(),tp=(e,t)=>{if(t.length!==e.length)throw new Error(`inputDependencies length ${t.length} is not equal to inputTensors length ${e.length}.`);let r=[];for(let i=0;i<e.length;++i){let a=e[i].dataType;switch(t[i]){case"none":r.push("");break;case"type":r.push(`${a}`);break;case"rank":{let n=e[i].dims.length;r.push(`${a};${n}`);break}case"dims":{let n=e[i].dims.join(",");r.push(`${a};${n}`);break}default:throw new Error(`unsupported input dependency: ${t[i]}`)}}return r.join("|")},rp=(e,t,r)=>{let i=e.name;return e.shaderCache?.hint&&(i+="["+e.shaderCache.hint+"]"),i+=":"+r+`:${tp(t,e.shaderCache?.inputDependencies??new Array(t.length).fill("dims"))}`,i},ip=class{constructor(e){e&&(this.architecture=e.architecture,this.vendor=e.vendor)}isArchitecture(e){return this.architecture===e}isVendor(e){return this.vendor===e}},ap=class{constructor(){this.currentSessionId=null,this.currentKernelId=null,this.commandEncoder=null,this.computePassEncoder=null,this.maxDispatchNumber=16,this.pendingDispatchNumber=0,this.pendingKernels=[],this.pendingQueries=new Map,this.sessionStatus="default",this.capturedCommandList=new Map,this.capturedPendingKernels=new Map,this.sessionExternalDataMapping=new Map}get currentKernelCustomData(){if(this.currentKernelId===null)throw new Error("currentKernelCustomData(): currentKernelId is null. (should not happen)");let e=this.kernelCustomData.get(this.currentKernelId);return e||(e={},this.kernelCustomData.set(this.currentKernelId,e)),e}async initialize(e,t){this.env=e;let r=[],i={requiredLimits:{maxComputeWorkgroupStorageSize:t.limits.maxComputeWorkgroupStorageSize,maxComputeWorkgroupsPerDimension:t.limits.maxComputeWorkgroupsPerDimension,maxStorageBufferBindingSize:t.limits.maxStorageBufferBindingSize,maxBufferSize:t.limits.maxBufferSize,maxComputeInvocationsPerWorkgroup:t.limits.maxComputeInvocationsPerWorkgroup,maxComputeWorkgroupSizeX:t.limits.maxComputeWorkgroupSizeX,maxComputeWorkgroupSizeY:t.limits.maxComputeWorkgroupSizeY,maxComputeWorkgroupSizeZ:t.limits.maxComputeWorkgroupSizeZ},requiredFeatures:r},a=n=>t.features.has(n)&&r.push(n)&&!0;a("chromium-experimental-timestamp-query-inside-passes")||a("timestamp-query"),a("shader-f16"),a("subgroups"),this.device=await t.requestDevice(i),this.adapterInfo=new ip(t.info||await t.requestAdapterInfo()),this.gpuDataManager=la(this),this.programManager=new Jd(this),this.kernels=new Map,this.kernelPersistentData=new Map,this.kernelCustomData=new Map,jr(e.logLevel,!!e.debug),this.device.onuncapturederror=n=>{n.error instanceof GPUValidationError&&console.error(`An uncaught WebGPU validation error was raised: ${n.error.message}`)},Object.defineProperty(this.env.webgpu,"device",{value:this.device,writable:!1,enumerable:!0,configurable:!1}),Object.defineProperty(this.env.webgpu,"adapter",{value:t,writable:!1,enumerable:!0,configurable:!1}),this.setQueryType()}dispose(){typeof this.querySet<"u"&&this.querySet.destroy(),this.gpuDataManager.dispose()}getCommandEncoder(){return this.commandEncoder||(this.commandEncoder=this.device.createCommandEncoder()),this.commandEncoder}getComputePassEncoder(){if(!this.computePassEncoder){let e=this.getCommandEncoder(),t={};this.queryType==="at-passes"&&(t.timestampWrites={querySet:this.querySet,beginningOfPassWriteIndex:this.pendingDispatchNumber*2,endOfPassWriteIndex:this.pendingDispatchNumber*2+1}),this.computePassEncoder=e.beginComputePass(t)}return this.computePassEncoder}endComputePass(){this.computePassEncoder&&(this.computePassEncoder.end(),this.computePassEncoder=null)}flush(){if(!this.commandEncoder)return;et(),this.endComputePass();let e;this.queryType!=="none"&&(this.commandEncoder.resolveQuerySet(this.querySet,0,this.pendingDispatchNumber*2,this.queryResolveBuffer,0),e=this.device.createBuffer({size:this.pendingDispatchNumber*2*8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.pendingQueries.set(e,this.pendingKernels),this.pendingKernels=[],this.commandEncoder.copyBufferToBuffer(this.queryResolveBuffer,0,e,0,this.pendingDispatchNumber*2*8)),this.device.queue.submit([this.commandEncoder.finish()]),this.gpuDataManager.refreshPendingBuffers(),this.commandEncoder=null,this.pendingDispatchNumber=0,this.queryType!=="none"&&e.mapAsync(GPUMapMode.READ).then(()=>{let t=new BigUint64Array(e.getMappedRange()),r=this.pendingQueries.get(e);for(let i=0;i<t.length/2;i++){let a=r[i],n=a.kernelId,s=this.kernels.get(n),o=s.kernelType,u=s.kernelName,l=a.programName,p=a.inputTensorViews,d=a.outputTensorViews,h=t[i*2],f=t[i*2+1];typeof this.queryTimeBase>"u"&&(this.queryTimeBase=h);let g=Number(h-this.queryTimeBase),w=Number(f-this.queryTimeBase);if(!Number.isSafeInteger(g)||!Number.isSafeInteger(w))throw new RangeError("incorrect timestamp range");if(this.env.webgpu.profiling?.ondata)this.env.webgpu.profiling.ondata({version:1,inputsMetadata:p.map($=>({dims:$.dims,dataType:mt($.dataType)})),outputsMetadata:d.map($=>({dims:$.dims,dataType:mt($.dataType)})),kernelId:n,kernelType:o,kernelName:u,programName:l,startTime:g,endTime:w});else{let $="";p.forEach((y,v)=>{$+=`input[${v}]: [${y.dims}] | ${mt(y.dataType)}, `});let _="";d.forEach((y,v)=>{_+=`output[${v}]: [${y.dims}] | ${mt(y.dataType)}, `}),console.log(`[profiling] kernel "${n}|${o}|${u}|${l}" ${$}${_}start time: ${g} ns, execution time: ${w-g} ns`)}Dt("GPU",`${l}::${h}::${f}`)}e.unmap(),this.pendingQueries.delete(e)}),Qe()}run(e,t,r,i,a,n){et(e.name);let s=[];for(let y=0;y<t.length;++y){let v=t[y].data;if(v===0)continue;let x=this.gpuDataManager.get(v);if(!x)throw new Error(`no GPU data for input: ${v}`);s.push(x)}let{outputs:o,dispatchGroup:u,programUniforms:l}=e.getRunData(t),p=r.length===0?o.map((y,v)=>v):r;if(p.length!==o.length)throw new Error(`Output size ${p.length} must be equal to ${o.length}.`);let d=[],h=[];for(let y=0;y<o.length;++y){if(!Number.isInteger(p[y])||p[y]<-3||p[y]>=n)throw new Error(`Invalid output index: ${p[y]}`);if(p[y]===-3)continue;let v=p[y]===-1,x=p[y]===-2,I=v||x?a(o[y].dataType,o[y].dims):i(p[y],o[y].dataType,o[y].dims);if(d.push(I),I.data===0)continue;let B=this.gpuDataManager.get(I.data);if(!B)throw new Error(`no GPU data for output: ${I.data}`);if(v&&this.temporaryData.push(B),x){let R=this.kernelPersistentData.get(this.currentKernelId);R||(R=[],this.kernelPersistentData.set(this.currentKernelId,R)),R.push(B)}h.push(B)}if(s.length!==t.length||h.length!==d.length){if(h.length===0)return Qe(e.name),d;throw new Error(`Program ${e.name} has zero-sized tensor(s) in inputs or outputs. This is not supported now.`)}let f;if(l){let y=0,v=[];l.forEach(R=>{let N=typeof R.data=="number"?[R.data]:R.data;if(N.length===0)return;let G=R.type===10?2:4,H,ve;R.type===10?(ve=N.length>4?16:N.length>2?8:N.length*G,H=N.length>4?16:G*N.length):(ve=N.length<=2?N.length*G:16,H=16),y=Math.ceil(y/ve)*ve,v.push(y);let se=R.type===10?8:4;y+=N.length>4?Math.ceil(N.length/se)*H:N.length*G});let x=16;y=Math.ceil(y/x)*x;let I=new ArrayBuffer(y);l.forEach((R,N)=>{let G=v[N],H=typeof R.data=="number"?[R.data]:R.data;if(R.type===6)new Int32Array(I,G,H.length).set(H);else if(R.type===12)new Uint32Array(I,G,H.length).set(H);else if(R.type===10)new Uint16Array(I,G,H.length).set(H);else if(R.type===1)new Float32Array(I,G,H.length).set(H);else throw new Error(`Unsupported uniform type: ${mt(R.type)}`)});let B=this.gpuDataManager.create(y,GPUBufferUsage.COPY_DST|GPUBufferUsage.UNIFORM);this.device.queue.writeBuffer(B.buffer,0,I,0,y),this.gpuDataManager.release(B.id),f={offset:0,size:y,buffer:B.buffer}}let g=this.programManager.normalizeDispatchGroupSize(u),w=g[1]===1&&g[2]===1,$=rp(e,t,w),_=this.programManager.getArtifact($);if(_||(_=this.programManager.build(e,g),this.programManager.setArtifact($,_),ze("info",()=>`[artifact] key: ${$}, programName: ${e.name}`)),l&&_.uniformVariablesInfo){if(l.length!==_.uniformVariablesInfo.length)throw new Error(`Uniform variables count mismatch: expect ${_.uniformVariablesInfo.length}, got ${l.length} in program "${_.programInfo.name}".`);for(let y=0;y<l.length;y++){let v=l[y],x=v.type,I=typeof v.data=="number"?1:v.data.length,[B,R]=_.uniformVariablesInfo[y];if(x!==B||I!==R)throw new Error(`Uniform variable ${y} mismatch: expect type ${B} with size ${R}, got type ${x} with size ${I} in program "${_.programInfo.name}".`)}}if(ze("info",()=>`[ProgramManager] run "${e.name}" (key=${$}) with ${g[0]}x${g[1]}x${g[2]}`),this.queryType!=="none"||this.sessionStatus==="capturing"){let y={kernelId:this.currentKernelId,programName:_.programInfo.name,inputTensorViews:t,outputTensorViews:d};this.pendingKernels.push(y),this.sessionStatus==="capturing"&&this.capturedPendingKernels.get(this.currentSessionId).push(y)}return this.programManager.run(_,s,h,g,f),Qe(e.name),d}upload(e,t){this.gpuDataManager.upload(e,t)}memcpy(e,t){this.gpuDataManager.memcpy(e,t)}async download(e,t){await this.gpuDataManager.download(e,t)}alloc(e){return this.gpuDataManager.create(e).id}free(e){return this.gpuDataManager.release(e)}createKernel(e,t,r,i){let a=Yd.get(e);if(!a)throw new Error(`kernel not implemented: ${e}`);let n={kernelType:e,kernelName:i,kernelEntry:a[0],attributes:[a[1],r]};this.kernels.set(t,n)}releaseKernel(e){let t=this.kernelPersistentData.get(e);if(t){for(let r of t)this.gpuDataManager.release(r.id);this.kernelPersistentData.delete(e)}this.kernelCustomData.delete(e),this.kernels.delete(e)}computeKernel(e,t,r){let i=this.kernels.get(e);if(!i)throw new Error(`kernel not created: ${e}`);let a=i.kernelType,n=i.kernelName,s=i.kernelEntry,o=i.attributes;if(this.currentKernelId!==null)throw new Error(`kernel "[${a}] ${n}" is not allowed to be called recursively`);this.currentKernelId=e,o[0]&&(o[1]=o[0](o[1]),o[0]=void 0),ze("info",()=>`[WebGPU] Start to run kernel "[${a}] ${n}"...`);let u=this.env.debug;this.temporaryData=[];try{return u&&this.device.pushErrorScope("validation"),s(t,o[1]),0}catch(l){return r.push(Promise.resolve(`[WebGPU] Kernel "[${a}] ${n}" failed. ${l}`)),1}finally{u&&r.push(this.device.popErrorScope().then(l=>l?`GPU validation error for kernel "[${a}] ${n}": ${l.message}`:null));for(let l of this.temporaryData)this.gpuDataManager.release(l.id);this.temporaryData=[],this.currentKernelId=null}}registerBuffer(e,t,r,i){let a=this.sessionExternalDataMapping.get(e);a||(a=new Map,this.sessionExternalDataMapping.set(e,a));let n=a.get(t),s=this.gpuDataManager.registerExternalBuffer(r,i,n);return a.set(t,[s,r]),s}unregisterBuffers(e){let t=this.sessionExternalDataMapping.get(e);t&&(t.forEach(r=>this.gpuDataManager.unregisterExternalBuffer(r[0])),this.sessionExternalDataMapping.delete(e))}getBuffer(e){let t=this.gpuDataManager.get(e);if(!t)throw new Error(`no GPU data for buffer: ${e}`);return t.buffer}createDownloader(e,t,r){return async()=>{let i=await Fi(this,e,t);return Nt(i.buffer,r)}}writeTimestamp(e){this.queryType==="inside-passes"&&this.computePassEncoder.writeTimestamp(this.querySet,e)}setQueryType(){this.queryType="none",(this.env.webgpu.profiling?.mode==="default"||(typeof this.env.trace>"u"?this.env.wasm.trace:this.env.trace))&&(this.device.features.has("chromium-experimental-timestamp-query-inside-passes")?this.queryType="inside-passes":this.device.features.has("timestamp-query")&&(this.queryType="at-passes"),this.queryType!=="none"&&typeof this.querySet>"u"&&(this.querySet=this.device.createQuerySet({type:"timestamp",count:this.maxDispatchNumber*2}),this.queryResolveBuffer=this.device.createBuffer({size:this.maxDispatchNumber*2*8,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.QUERY_RESOLVE})))}captureBegin(){ze("info","captureBegin"),this.capturedCommandList.get(this.currentSessionId)||this.capturedCommandList.set(this.currentSessionId,[]),this.capturedPendingKernels.get(this.currentSessionId)||this.capturedPendingKernels.set(this.currentSessionId,[]),this.flush(),this.sessionStatus="capturing"}captureEnd(){ze("info","captureEnd"),this.flush(),this.sessionStatus="default"}replay(){ze("info","replay"),this.sessionStatus="replaying";let e=this.capturedCommandList.get(this.currentSessionId),t=this.capturedPendingKernels.get(this.currentSessionId),r=e.length;this.pendingKernels=[];for(let i=0;i<r;i++){let a=this.getComputePassEncoder(),n=e[i];this.writeTimestamp(this.pendingDispatchNumber*2),a.setPipeline(n.computePipeline),a.setBindGroup(0,n.bindGroup),a.dispatchWorkgroups(...n.dispatchGroup),this.writeTimestamp(this.pendingDispatchNumber*2+1),this.pendingDispatchNumber++,this.queryType!=="none"&&this.pendingKernels.push(t[i]),(this.pendingDispatchNumber>=this.maxDispatchNumber||this.queryType==="at-passes")&&this.endComputePass(),this.pendingDispatchNumber>=this.maxDispatchNumber&&this.flush()}this.flush(),this.sessionStatus="default"}onCreateSession(){this.gpuDataManager.onCreateSession()}onReleaseSession(e){this.unregisterBuffers(e),this.capturedCommandList.has(e)&&this.capturedCommandList.delete(e),this.capturedPendingKernels.has(e)&&this.capturedPendingKernels.delete(e),this.gpuDataManager.onReleaseSession(e)}onRunStart(e){this.currentSessionId=e,this.setQueryType()}}}),np={};ie(np,{init:()=>op});var va,sp,op,Sc=k(()=>{"use strict";ue(),yt(),ne(),qi(),va=class zp{constructor(t,r,i,a){this.module=t,this.dataType=r,this.data=i,this.dims=a}getFloat32Array(){if(this.dataType!==1)throw new Error("Invalid data type");let t=M.size(this.dims);return t===0?new Float32Array:new Float32Array(this.module.HEAP8.buffer,this.data,t)}getBigInt64Array(){if(this.dataType!==7)throw new Error("Invalid data type");let t=M.size(this.dims);return t===0?new BigInt64Array:new BigInt64Array(this.module.HEAP8.buffer,this.data,t)}getInt32Array(){if(this.dataType!==6)throw new Error("Invalid data type");let t=M.size(this.dims);return t===0?new Int32Array:new Int32Array(this.module.HEAP8.buffer,this.data,t)}getUint16Array(){if(this.dataType!==10&&this.dataType!==4)throw new Error("Invalid data type");let t=M.size(this.dims);return t===0?new Uint16Array:new Uint16Array(this.module.HEAP8.buffer,this.data,t)}reshape(t){if(M.size(t)!==M.size(this.dims))throw new Error("Invalid new shape");return new zp(this.module,this.dataType,this.data,t)}},sp=class{constructor(e,t,r){this.module=e,this.backend=t,this.customDataOffset=0,this.customDataSize=0,this.adapterInfo=t.adapterInfo;let i=e.PTR_SIZE,a=r/e.PTR_SIZE,n=i===4?"i32":"i64";this.opKernelContext=Number(e.getValue(i*a++,n));let s=Number(e.getValue(i*a++,n));this.outputCount=Number(e.getValue(i*a++,n)),this.customDataOffset=Number(e.getValue(i*a++,"*")),this.customDataSize=Number(e.getValue(i*a++,n));let o=[];for(let u=0;u<s;u++){let l=Number(e.getValue(i*a++,n)),p=Number(e.getValue(i*a++,"*")),d=Number(e.getValue(i*a++,n)),h=[];for(let f=0;f<d;f++)h.push(Number(e.getValue(i*a++,n)));o.push(new va(e,l,p,h))}this.inputs=o}get kernelCustomData(){return this.backend.currentKernelCustomData}get customDataBuffer(){return this.module.HEAPU8.subarray(this.customDataOffset,this.customDataOffset+this.customDataSize)}compute(e,t){let r=t?.inputs?.map(s=>typeof s=="number"?this.inputs[s]:s)??this.inputs,i=t?.outputs??[],a=(s,o,u)=>new va(this.module,o,this.output(s,u),u),n=(s,o)=>{let u=gt(s,o);if(!u)throw new Error(`Unsupported data type: ${s}`);let l=u>0?this.backend.gpuDataManager.create(u).id:0;return new va(this.module,s,l,o)};return this.backend.run(e,r,i,a,n,this.outputCount)}output(e,t){let r=this.module.stackSave();try{let i=this.module.PTR_SIZE,a=i===4?"i32":"i64",n=this.module.stackAlloc((1+t.length)*i);this.module.setValue(n,t.length,a);for(let s=0;s<t.length;s++)this.module.setValue(n+i*(s+1),t[s],a);return this.module._JsepOutput(this.opKernelContext,e,n)}catch(i){throw new Error(`Failed to generate kernel's output[${e}] with dims [${t}]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: ${i}`)}finally{this.module.stackRestore(r)}}},op=async(e,t,r,i)=>{let a=t.jsepInit;if(!a)throw new Error("Failed to initialize JSEP. The WebAssembly module is not built with JSEP support.");if(e==="webgpu"){let n=(xc(),pe(ep)).WebGpuBackend,s=new n;await s.initialize(r,i),a("webgpu",[s,o=>s.alloc(Number(o)),o=>s.free(o),(o,u,l,p=!1)=>{if(p)ze("verbose",()=>`[WebGPU] jsepCopyGpuToGpu: src=${Number(o)}, dst=${Number(u)}, size=${Number(l)}`),s.memcpy(Number(o),Number(u));else{ze("verbose",()=>`[WebGPU] jsepCopyCpuToGpu: dataOffset=${Number(o)}, gpuDataId=${Number(u)}, size=${Number(l)}`);let d=t.HEAPU8.subarray(Number(o>>>0),Number(o>>>0)+Number(l));s.upload(Number(u),d)}},async(o,u,l)=>{ze("verbose",()=>`[WebGPU] jsepCopyGpuToCpu: gpuDataId=${o}, dataOffset=${u}, size=${l}`),await s.download(Number(o),()=>t.HEAPU8.subarray(Number(u)>>>0,Number(u+l)>>>0))},(o,u,l)=>s.createKernel(o,Number(u),l,t.UTF8ToString(t._JsepGetNodeName(Number(u)))),o=>s.releaseKernel(o),(o,u,l,p)=>{ze("verbose",()=>`[WebGPU] jsepRun: sessionHandle=${l}, kernel=${o}, contextDataOffset=${u}`);let d=new sp(t,s,Number(u));return s.computeKernel(Number(o),d,p)},()=>s.captureBegin(),()=>s.captureEnd(),()=>s.replay()])}else{let n=new Vi(r);a("webnn",[n,()=>n.reserveTensorId(),s=>n.releaseTensorId(s),async(s,o,u,l,p)=>n.ensureTensor(s,o,u,l,p),(s,o)=>{n.uploadTensor(s,o)},async(s,o)=>n.downloadTensor(s,o),(s,o)=>n.registerMLContext(s,o),!!r.trace])}}}),up,Cn,An,ir,lp,On,xa,Rn,Bn,Mn,Dn,Pn,Un,dp=k(()=>{"use strict";Xe(),Pa(),Ua(),ue(),ht(),Tr(),Mi(),up=(e,t)=>{de()._OrtInit(e,t)!==0&&ae("Can't initialize onnxruntime.")},Cn=async e=>{up(e.wasm.numThreads,Ir(e.logLevel))},An=async(e,t)=>{de().asyncInit?.();let r=e.webgpu.adapter;if(t==="webgpu"){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not supported in current environment");if(r){if(typeof r.limits!="object"||typeof r.features!="object"||typeof r.requestDevice!="function")throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.")}else{let i=e.webgpu.powerPreference;if(i!==void 0&&i!=="low-power"&&i!=="high-performance")throw new Error(`Invalid powerPreference setting: "${i}"`);let a=e.webgpu.forceFallbackAdapter;if(a!==void 0&&typeof a!="boolean")throw new Error(`Invalid forceFallbackAdapter setting: "${a}"`);if(r=await navigator.gpu.requestAdapter({powerPreference:i,forceFallbackAdapter:a}),!r)throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.')}}if(t==="webnn"&&(typeof navigator>"u"||!navigator.ml))throw new Error("WebNN is not supported in current environment");{let i=(Sc(),pe(np)).init;t==="webgpu"&&await i("webgpu",de(),e,r),t==="webnn"&&await i("webnn",de(),e)}},ir=new Map,lp=e=>{let t=de(),r=t.stackSave();try{let i=t.PTR_SIZE,a=t.stackAlloc(2*i);t._OrtGetInputOutputCount(e,a,a+i)!==0&&ae("Can't get session input/output count.");let n=i===4?"i32":"i64";return[Number(t.getValue(a,n)),Number(t.getValue(a+i,n))]}finally{t.stackRestore(r)}},On=(e,t)=>{let r=de(),i=r.stackSave(),a=0;try{let n=r.PTR_SIZE,s=r.stackAlloc(2*n);r._OrtGetInputOutputMetadata(e,t,s,s+n)!==0&&ae("Can't get session input/output metadata.");let o=Number(r.getValue(s,"*"));a=Number(r.getValue(s+n,"*"));let u=r.HEAP32[a/4];if(u===0)return[o,0];let l=r.HEAPU32[a/4+1],p=[];for(let d=0;d<l;d++){let h=Number(r.getValue(a+8+d*n,"*"));p.push(h!==0?r.UTF8ToString(h):Number(r.getValue(a+8+(d+l)*n,"*")))}return[o,u,p]}finally{r.stackRestore(i),a!==0&&r._OrtFree(a)}},xa=e=>{let t=de(),r=t._malloc(e.byteLength);if(r===0)throw new Error(`Can't create a session. failed to allocate a buffer of size ${e.byteLength}.`);return t.HEAPU8.set(e,r),[r,e.byteLength]},Rn=async(e,t)=>{let r,i,a=de();Array.isArray(e)?[r,i]=e:e.buffer===a.HEAPU8.buffer?[r,i]=[e.byteOffset,e.byteLength]:[r,i]=xa(e);let n=0,s=0,o=0,u=[],l=[],p=[];try{if([s,u]=await Bi(t),t?.externalData&&a.mountExternalData){let x=[];for(let I of t.externalData){let B=typeof I=="string"?I:I.path;x.push(Cr(typeof I=="string"?I:I.data).then(R=>{a.mountExternalData(B,R)}))}await Promise.all(x)}for(let x of t?.executionProviders??[])if((typeof x=="string"?x:x.name)==="webnn"){if(a.shouldTransferToMLTensor=!1,typeof x!="string"){let I=x,B=I?.context,R=I?.gpuDevice,N=I?.deviceType,G=I?.powerPreference;B?a.currentContext=B:R?a.currentContext=await a.webnnCreateMLContext(R):a.currentContext=await a.webnnCreateMLContext({deviceType:N,powerPreference:G})}else a.currentContext=await a.webnnCreateMLContext();break}n=await a._OrtCreateSession(r,i,s),a.webgpuOnCreateSession?.(n),n===0&&ae("Can't create a session."),a.jsepOnCreateSession?.(),a.currentContext&&(a.webnnRegisterMLContext(n,a.currentContext),a.currentContext=void 0,a.shouldTransferToMLTensor=!0);let[d,h]=lp(n),f=!!t?.enableGraphCapture,g=[],w=[],$=[],_=[],y=[];for(let x=0;x<d;x++){let[I,B,R]=On(n,x);I===0&&ae("Can't get an input name."),l.push(I);let N=a.UTF8ToString(I);g.push(N),$.push(B===0?{name:N,isTensor:!1}:{name:N,isTensor:!0,type:mt(B),shape:R})}for(let x=0;x<h;x++){let[I,B,R]=On(n,x+d);I===0&&ae("Can't get an output name."),p.push(I);let N=a.UTF8ToString(I);w.push(N),_.push(B===0?{name:N,isTensor:!1}:{name:N,isTensor:!0,type:mt(B),shape:R});{if(f&&t?.preferredOutputLocation===void 0){y.push("gpu-buffer");continue}let G=typeof t?.preferredOutputLocation=="string"?t.preferredOutputLocation:t?.preferredOutputLocation?.[N]??"cpu",H=a.webnnIsGraphOutput;if(G==="cpu"&&H&&H(n,N)){y.push("ml-tensor-cpu-output");continue}if(G!=="cpu"&&G!=="cpu-pinned"&&G!=="gpu-buffer"&&G!=="ml-tensor")throw new Error(`Not supported preferred output location: ${G}.`);if(f&&G!=="gpu-buffer")throw new Error(`Not supported preferred output location: ${G}. Only 'gpu-buffer' location is supported when enableGraphCapture is true.`);y.push(G)}}let v=null;return y.some(x=>x==="gpu-buffer"||x==="ml-tensor"||x==="ml-tensor-cpu-output")&&(o=a._OrtCreateBinding(n),o===0&&ae("Can't create IO binding."),v={handle:o,outputPreferredLocations:y,outputPreferredLocationsEncoded:y.map(x=>x==="ml-tensor-cpu-output"?"ml-tensor":x).map(x=>Gr(x))}),ir.set(n,[n,l,p,v,f,!1]),[n,g,w,$,_]}catch(d){throw l.forEach(h=>a._OrtFree(h)),p.forEach(h=>a._OrtFree(h)),o!==0&&a._OrtReleaseBinding(o)!==0&&ae("Can't release IO binding."),n!==0&&a._OrtReleaseSession(n)!==0&&ae("Can't release session."),d}finally{a._free(r),s!==0&&a._OrtReleaseSessionOptions(s)!==0&&ae("Can't release session options."),u.forEach(d=>a._free(d)),a.unmountExternalData?.()}},Bn=e=>{let t=de(),r=ir.get(e);if(!r)throw new Error(`cannot release session. invalid session id: ${e}`);let[i,a,n,s,o]=r;s&&(o&&t._OrtClearBoundOutputs(s.handle)!==0&&ae("Can't clear bound outputs."),t._OrtReleaseBinding(s.handle)!==0&&ae("Can't release IO binding.")),t.jsepOnReleaseSession?.(e),t.webnnOnReleaseSession?.(e),t.webgpuOnReleaseSession?.(e),a.forEach(u=>t._OrtFree(u)),n.forEach(u=>t._OrtFree(u)),t._OrtReleaseSession(i)!==0&&ae("Can't release session."),ir.delete(e)},Mn=async(e,t,r,i,a,n,s=!1)=>{if(!e){t.push(0);return}let o=de(),u=o.PTR_SIZE,l=e[0],p=e[1],d=e[3],h=d,f,g;if(l==="string"&&(d==="gpu-buffer"||d==="ml-tensor"))throw new Error("String tensor is not supported on GPU.");if(s&&d!=="gpu-buffer")throw new Error(`External buffer must be provided for input/output index ${n} when enableGraphCapture is true.`);if(d==="gpu-buffer"){let _=e[2].gpuBuffer;g=gt(ft(l),p);{let y=o.jsepRegisterBuffer;if(!y)throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');f=y(i,n,_,g)}}else if(d==="ml-tensor"){let _=e[2].mlTensor;g=gt(ft(l),p);let y=o.webnnRegisterMLTensor;if(!y)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');f=y(i,_,ft(l),p)}else{let _=e[2];if(Array.isArray(_)){g=u*_.length,f=o._malloc(g),r.push(f);for(let y=0;y<_.length;y++){if(typeof _[y]!="string")throw new TypeError(`tensor data at index ${y} is not a string`);o.setValue(f+y*u,je(_[y],r),"*")}}else{let y=o.webnnIsGraphInput,v=o.webnnIsGraphOutput;if(l!=="string"&&y&&v){let x=o.UTF8ToString(a);if(y(i,x)||v(i,x)){let I=ft(l);g=gt(I,p),h="ml-tensor";let B=o.webnnCreateTemporaryTensor,R=o.webnnUploadTensor;if(!B||!R)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');let N=await B(i,I,p);R(N,new Uint8Array(_.buffer,_.byteOffset,_.byteLength)),f=N}else g=_.byteLength,f=o._malloc(g),r.push(f),o.HEAPU8.set(new Uint8Array(_.buffer,_.byteOffset,g),f)}else g=_.byteLength,f=o._malloc(g),r.push(f),o.HEAPU8.set(new Uint8Array(_.buffer,_.byteOffset,g),f)}}let w=o.stackSave(),$=o.stackAlloc(4*p.length);try{p.forEach((y,v)=>o.setValue($+v*u,y,u===4?"i32":"i64"));let _=o._OrtCreateTensor(ft(l),f,g,$,p.length,Gr(h));_===0&&ae(`Can't create tensor for input/output. session=${i}, index=${n}.`),t.push(_)}finally{o.stackRestore(w)}},Dn=async(e,t,r,i,a,n)=>{let s=de(),o=s.PTR_SIZE,u=ir.get(e);if(!u)throw new Error(`cannot run inference. invalid session id: ${e}`);let l=u[0],p=u[1],d=u[2],h=u[3],f=u[4],g=u[5],w=t.length,$=i.length,_=0,y=[],v=[],x=[],I=[],B=[],R=s.stackSave(),N=s.stackAlloc(w*o),G=s.stackAlloc(w*o),H=s.stackAlloc($*o),ve=s.stackAlloc($*o);try{[_,y]=zi(n),st("wasm prepareInputOutputTensor");for(let W=0;W<w;W++)await Mn(r[W],v,I,e,p[t[W]],t[W],f);for(let W=0;W<$;W++)await Mn(a[W],x,I,e,d[i[W]],w+i[W],f);ot("wasm prepareInputOutputTensor");for(let W=0;W<w;W++)s.setValue(N+W*o,v[W],"*"),s.setValue(G+W*o,p[t[W]],"*");for(let W=0;W<$;W++)s.setValue(H+W*o,x[W],"*"),s.setValue(ve+W*o,d[i[W]],"*");if(h&&!g){let{handle:W,outputPreferredLocations:J,outputPreferredLocationsEncoded:Se}=h;if(p.length!==w)throw new Error(`input count from feeds (${w}) is expected to be always equal to model's input count (${p.length}).`);st("wasm bindInputsOutputs");for(let _e=0;_e<w;_e++){let fe=t[_e];await s._OrtBindInput(W,p[fe],v[_e])!==0&&ae(`Can't bind input[${_e}] for session=${e}.`)}for(let _e=0;_e<$;_e++){let fe=i[_e];a[_e]?.[3]?(B.push(x[_e]),s._OrtBindOutput(W,d[fe],x[_e],0)!==0&&ae(`Can't bind pre-allocated output[${_e}] for session=${e}.`)):s._OrtBindOutput(W,d[fe],0,Se[fe])!==0&&ae(`Can't bind output[${_e}] to ${J[_e]} for session=${e}.`)}ot("wasm bindInputsOutputs"),ir.set(e,[l,p,d,h,f,!0])}s.jsepOnRunStart?.(l),s.webnnOnRunStart?.(l);let se;h?se=await s._OrtRunWithBinding(l,h.handle,$,H,_):se=await s._OrtRun(l,G,N,w,ve,$,H,_),se!==0&&ae("failed to call OrtRun().");let ce=[],Me=[];st("wasm ProcessOutputTensor");for(let W=0;W<$;W++){let J=Number(s.getValue(H+W*o,"*"));if(J===x[W]||B.includes(x[W])){ce.push(a[W]),J!==x[W]&&s._OrtReleaseTensor(J)!==0&&ae("Can't release tensor.");continue}let Se=s.stackSave(),_e=s.stackAlloc(4*o),fe=!1,V,Z=0;try{s._OrtGetTensorData(J,_e,_e+o,_e+2*o,_e+3*o)!==0&&ae(`Can't access output tensor data on index ${W}.`);let me=o===4?"i32":"i64",De=Number(s.getValue(_e,me));Z=s.getValue(_e+o,"*");let Be=s.getValue(_e+o*2,"*"),aa=Number(s.getValue(_e+o*3,me)),nr=[];for(let Ke=0;Ke<aa;Ke++)nr.push(Number(s.getValue(Be+Ke*o,me)));s._OrtFree(Be)!==0&&ae("Can't free memory for tensor dims.");let sr=nr.reduce((Ke,ct)=>Ke*ct,1);V=mt(De);let na=h?.outputPreferredLocations[i[W]];if(V==="string"){if(na==="gpu-buffer"||na==="ml-tensor")throw new Error("String tensor is not supported on GPU.");let Ke=[];for(let ct=0;ct<sr;ct++){let Zt=s.getValue(Z+ct*o,"*"),zc=s.getValue(Z+(ct+1)*o,"*"),Cc=ct===sr-1?void 0:zc-Zt;Ke.push(s.UTF8ToString(Zt,Cc))}ce.push([V,nr,Ke,"cpu"])}else if(na==="gpu-buffer"&&sr>0){let Ke=s.jsepGetBuffer;if(!Ke)throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');let ct=Ke(Z),Zt=gt(De,sr);if(Zt===void 0||!kr(V))throw new Error(`Unsupported data type: ${V}`);fe=!0,ce.push([V,nr,{gpuBuffer:ct,download:s.jsepCreateDownloader(ct,Zt,V),dispose:()=>{s._OrtReleaseTensor(J)!==0&&ae("Can't release tensor.")}},"gpu-buffer"])}else if(na==="ml-tensor"&&sr>0){let Ke=s.webnnEnsureTensor,ct=s.webnnIsGraphInputOutputTypeSupported;if(!Ke||!ct)throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');if(gt(De,sr)===void 0||!zr(V))throw new Error(`Unsupported data type: ${V}`);if(!ct(e,V,!1))throw new Error(`preferredLocation "ml-tensor" for ${V} output is not supported by current WebNN Context.`);let Zt=await Ke(e,Z,De,nr,!1);fe=!0,ce.push([V,nr,{mlTensor:Zt,download:s.webnnCreateMLTensorDownloader(Z,V),dispose:()=>{s.webnnReleaseTensorId(Z),s._OrtReleaseTensor(J)}},"ml-tensor"])}else if(na==="ml-tensor-cpu-output"&&sr>0){let Ke=s.webnnCreateMLTensorDownloader(Z,V)(),ct=ce.length;fe=!0,Me.push((async()=>{let Zt=[ct,await Ke];return s.webnnReleaseTensorId(Z),s._OrtReleaseTensor(J),Zt})()),ce.push([V,nr,[],"cpu"])}else{let Ke=new(Er(V))(sr);new Uint8Array(Ke.buffer,Ke.byteOffset,Ke.byteLength).set(s.HEAPU8.subarray(Z,Z+Ke.byteLength)),ce.push([V,nr,Ke,"cpu"])}}finally{s.stackRestore(Se),V==="string"&&Z&&s._free(Z),fe||s._OrtReleaseTensor(J)}}h&&!f&&(s._OrtClearBoundOutputs(h.handle)!==0&&ae("Can't clear bound outputs."),ir.set(e,[l,p,d,h,f,!1]));for(let[W,J]of await Promise.all(Me))ce[W][2]=J;return ot("wasm ProcessOutputTensor"),ce}finally{s.webnnOnRunEnd?.(l),s.stackRestore(R),v.forEach(se=>s._OrtReleaseTensor(se)),x.forEach(se=>s._OrtReleaseTensor(se)),I.forEach(se=>s._free(se)),_!==0&&s._OrtReleaseRunOptions(_),y.forEach(se=>s._free(se))}},Pn=e=>{let t=de(),r=ir.get(e);if(!r)throw new Error("invalid session id");let i=r[0],a=t._OrtEndProfiling(i);a===0&&ae("Can't get an profile file name."),t._OrtFree(a)},Un=e=>{let t=[];for(let r of e){let i=r[2];!Array.isArray(i)&&"buffer"in i&&t.push(i.buffer)}return t}}),ar,$t,ui,ra,ia,Sa,Nn,Ta,qr,Fr,pp,cp,hp,fp,mp,gp,yp,wp,_p=k(()=>{"use strict";Xe(),dp(),ht(),$r(),ar=()=>!!te.wasm.proxy&&typeof document<"u",ui=!1,ra=!1,ia=!1,Ta=new Map,qr=(e,t)=>{let r=Ta.get(e);r?r.push(t):Ta.set(e,[t])},Fr=()=>{if(ui||!ra||ia||!$t)throw new Error("worker not ready")},pp=e=>{switch(e.data.type){case"init-wasm":ui=!1,e.data.err?(ia=!0,Nn[1](e.data.err)):(ra=!0,Nn[0]()),Sa&&(URL.revokeObjectURL(Sa),Sa=void 0);break;case"init-ep":case"copy-from":case"create":case"release":case"run":case"end-profiling":{let t=Ta.get(e.data.type);e.data.err?t.shift()[1](e.data.err):t.shift()[0](e.data.out);break}default:}},cp=async()=>{if(!ra){if(ui)throw new Error("multiple calls to 'initWasm()' detected.");if(ia)throw new Error("previous call to 'initWasm()' failed.");if(ui=!0,ar())return new Promise((e,t)=>{$t?.terminate(),Si().then(([r,i])=>{try{$t=i,$t.onerror=n=>t(n),$t.onmessage=pp,Nn=[e,t];let a={type:"init-wasm",in:te};if(!a.in.wasm.wasmPaths&&r){let n=yr();n&&(a.in.wasm.wasmPaths=n)}$t.postMessage(a),Sa=r}catch(a){t(a)}},t)});try{await Sr(te.wasm),await Cn(te),ra=!0}catch(e){throw ia=!0,e}finally{ui=!1}}},hp=async e=>{if(ar())return Fr(),new Promise((t,r)=>{qr("init-ep",[t,r]);let i={type:"init-ep",in:{epName:e,env:te}};$t.postMessage(i)});await An(te,e)},fp=async e=>ar()?(Fr(),new Promise((t,r)=>{qr("copy-from",[t,r]);let i={type:"copy-from",in:{buffer:e}};$t.postMessage(i,[e.buffer])})):xa(e),mp=async(e,t)=>{if(ar()){if(t?.preferredOutputLocation)throw new Error('session option "preferredOutputLocation" is not supported for proxy.');return Fr(),new Promise((r,i)=>{qr("create",[r,i]);let a={type:"create",in:{model:e,options:{...t}}},n=[];e instanceof Uint8Array&&n.push(e.buffer),$t.postMessage(a,n)})}else return Rn(e,t)},gp=async e=>{if(ar())return Fr(),new Promise((t,r)=>{qr("release",[t,r]);let i={type:"release",in:e};$t.postMessage(i)});Bn(e)},yp=async(e,t,r,i,a,n)=>{if(ar()){if(r.some(s=>s[3]!=="cpu"))throw new Error("input tensor on GPU is not supported for proxy.");if(a.some(s=>s))throw new Error("pre-allocated output tensor is not supported for proxy.");return Fr(),new Promise((s,o)=>{qr("run",[s,o]);let u=r,l={type:"run",in:{sessionId:e,inputIndices:t,inputs:u,outputIndices:i,options:n}};$t.postMessage(l,Un(u))})}else return Dn(e,t,r,i,a,n)},wp=async e=>{if(ar())return Fr(),new Promise((t,r)=>{qr("end-profiling",[t,r]);let i={type:"end-profiling",in:e};$t.postMessage(i)});Pn(e)}}),Ln,bp,$p,Tc=k(()=>{"use strict";Xe(),_p(),ue(),fr(),Mi(),Ln=(e,t)=>{switch(e.location){case"cpu":return[e.type,e.dims,e.data,"cpu"];case"gpu-buffer":return[e.type,e.dims,{gpuBuffer:e.gpuBuffer},"gpu-buffer"];case"ml-tensor":return[e.type,e.dims,{mlTensor:e.mlTensor},"ml-tensor"];default:throw new Error(`invalid data location: ${e.location} for ${t()}`)}},bp=e=>{switch(e[3]){case"cpu":return new He(e[0],e[2],e[1]);case"gpu-buffer":{let t=e[0];if(!kr(t))throw new Error(`not supported data type: ${t} for deserializing GPU tensor`);let{gpuBuffer:r,download:i,dispose:a}=e[2];return He.fromGpuBuffer(r,{dataType:t,dims:e[1],download:i,dispose:a})}case"ml-tensor":{let t=e[0];if(!zr(t))throw new Error(`not supported data type: ${t} for deserializing MLTensor tensor`);let{mlTensor:r,download:i,dispose:a}=e[2];return He.fromMLTensor(r,{dataType:t,dims:e[1],download:i,dispose:a})}default:throw new Error(`invalid data location: ${e[3]}`)}},$p=class{async fetchModelAndCopyToWasmMemory(e){return fp(await Cr(e))}async loadModel(e,t){et();let r;typeof e=="string"?r=await this.fetchModelAndCopyToWasmMemory(e):r=e,[this.sessionId,this.inputNames,this.outputNames,this.inputMetadata,this.outputMetadata]=await mp(r,t),Qe()}async dispose(){return gp(this.sessionId)}async run(e,t,r){et();let i=[],a=[];Object.entries(e).forEach(d=>{let h=d[0],f=d[1],g=this.inputNames.indexOf(h);if(g===-1)throw new Error(`invalid input '${h}'`);i.push(f),a.push(g)});let n=[],s=[];Object.entries(t).forEach(d=>{let h=d[0],f=d[1],g=this.outputNames.indexOf(h);if(g===-1)throw new Error(`invalid output '${h}'`);n.push(f),s.push(g)});let o=i.map((d,h)=>Ln(d,()=>`input "${this.inputNames[a[h]]}"`)),u=n.map((d,h)=>d?Ln(d,()=>`output "${this.outputNames[s[h]]}"`):null),l=await yp(this.sessionId,a,o,s,u,r),p={};for(let d=0;d<l.length;d++)p[this.outputNames[s[d]]]=n[d]??bp(l[d]);return Qe(),p}startProfiling(){}endProfiling(){wp(this.sessionId)}}}),vp={};ie(vp,{OnnxruntimeWebAssemblyBackend:()=>qn,initializeFlags:()=>Vn,wasmBackend:()=>xp});var Vn,qn,xp,Ec=k(()=>{"use strict";Xe(),_p(),Tc(),Vn=()=>{(typeof te.wasm.initTimeout!="number"||te.wasm.initTimeout<0)&&(te.wasm.initTimeout=0);let e=te.wasm.simd;if(typeof e!="boolean"&&e!==void 0&&e!=="fixed"&&e!=="relaxed"&&(console.warn(`Property "env.wasm.simd" is set to unknown value "${e}". Reset it to \`false\` and ignore SIMD feature checking.`),te.wasm.simd=!1),typeof te.wasm.proxy!="boolean"&&(te.wasm.proxy=!1),typeof te.wasm.trace!="boolean"&&(te.wasm.trace=!1),typeof te.wasm.numThreads!="number"||!Number.isInteger(te.wasm.numThreads)||te.wasm.numThreads<=0)if(typeof self<"u"&&!self.crossOriginIsolated)te.wasm.numThreads=1;else{let t=typeof navigator>"u"?K("node:os").cpus().length:navigator.hardwareConcurrency;te.wasm.numThreads=Math.min(4,Math.ceil((t||1)/2))}},qn=class{async init(e){Vn(),await cp(),await hp(e)}async createInferenceSessionHandler(e,t){let r=new $p;return await r.loadModel(e,t),r}},xp=new qn}),Sp={};ie(Sp,{InferenceSession:()=>hr,TRACE:()=>Dt,TRACE_EVENT_BEGIN:()=>st,TRACE_EVENT_END:()=>ot,TRACE_FUNC_BEGIN:()=>et,TRACE_FUNC_END:()=>Qe,Tensor:()=>He,default:()=>kc,env:()=>te,registerBackend:()=>le}),Xe(),Xe(),Xe();var Ic="1.24.1",kc=gi;{let e=(Ec(),pe(vp)).wasmBackend;le("webgpu",e,5),le("webnn",e,5),le("cpu",e,10),le("wasm",e,10)}return Object.defineProperty(te.versions,"web",{value:Ic,enumerable:!0}),pe(Sp)})();typeof U=="object"&&typeof Te=="object"&&(Te.exports=ge)})),Bc=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0})})),Mc=lt((U=>{var Te;Object.defineProperty(U,"__esModule",{value:!0}),U.SileroLegacy=void 0;var ge=oa(),Ce=class{constructor(Ie,be,$e,K,k){this.ortInstance=Ie,this._session=be,this._h=$e,this._c=K,this._sr=k,this.reset_state=()=>{const ie=Array(128).fill(0);this._h=new this.ortInstance.Tensor("float32",ie,[2,1,64]),this._c=new this.ortInstance.Tensor("float32",ie,[2,1,64])},this.process=async ie=>{const xe={input:new this.ortInstance.Tensor("float32",ie,[1,ie.length]),h:this._h,c:this._c,sr:this._sr},pe=await this._session.run(xe);this._h=pe.hn,this._c=pe.cn;const[X]=pe.output?.data;return{notSpeech:1-X,isSpeech:X}},this.release=async()=>{await this._session.release(),this._h.dispose(),this._c.dispose(),this._sr.dispose()}}};U.SileroLegacy=Ce,Te=Ce,Ce.new=async(Ie,be)=>{ge.log.debug("initializing vad");const $e=await be(),K=await Ie.InferenceSession.create($e),k=new Ie.Tensor("int64",[16000n]),ie=Array(128).fill(0),xe=new Ie.Tensor("float32",ie,[2,1,64]),pe=new Ie.Tensor("float32",ie,[2,1,64]);return ge.log.debug("vad is initialized"),new Te(Ie,K,xe,pe,k)}})),Dc=lt((U=>{var Te;Object.defineProperty(U,"__esModule",{value:!0}),U.SileroV5=void 0;var ge=oa();function Ce(be){const $e=Array(256).fill(0);return new be.Tensor("float32",$e,[2,1,128])}var Ie=class{constructor(be,$e,K,k){this._session=be,this._state=$e,this._sr=K,this.ortInstance=k,this.reset_state=()=>{this._state=Ce(this.ortInstance)},this.process=async ie=>{const xe={input:new this.ortInstance.Tensor("float32",ie,[1,ie.length]),state:this._state,sr:this._sr},pe=await this._session.run(xe);if(!pe.stateN)throw new Error("No state from model");if(this._state=pe.stateN,!pe.output?.data)throw new Error("No output from model");const X=pe.output.data[0];if(typeof X!="number")throw new Error("Weird output data");return{notSpeech:1-X,isSpeech:X}},this.release=async()=>{await this._session.release(),this._state.dispose(),this._sr.dispose()}}};U.SileroV5=Ie,Te=Ie,Ie.new=async(be,$e)=>{ge.log.debug("Loading VAD...");const K=await $e(),k=await be.InferenceSession.create(K),ie=new be.Tensor("int64",[16000n]),xe=Ce(be);return ge.log.debug("...finished loading VAD"),new Te(k,xe,ie,be)}})),Cp=lt((U=>{var Te=U&&U.__createBinding||(Object.create?(function(be,$e,K,k){k===void 0&&(k=K);var ie=Object.getOwnPropertyDescriptor($e,K);(!ie||("get"in ie?!$e.__esModule:ie.writable||ie.configurable))&&(ie={enumerable:!0,get:function(){return $e[K]}}),Object.defineProperty(be,k,ie)}):(function(be,$e,K,k){k===void 0&&(k=K),be[k]=$e[K]})),ge=U&&U.__exportStar||function(be,$e){for(var K in be)K!=="default"&&!Object.prototype.hasOwnProperty.call($e,K)&&Te($e,be,K)};Object.defineProperty(U,"__esModule",{value:!0}),U.SileroV5=U.SileroLegacy=void 0,ge(Bc(),U);var Ce=Mc();Object.defineProperty(U,"SileroLegacy",{enumerable:!0,get:function(){return Ce.SileroLegacy}});var Ie=Dc();Object.defineProperty(U,"SileroV5",{enumerable:!0,get:function(){return Ie.SileroV5}})})),Ap=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.Resampler=void 0;var Te=oa(),ge=class{constructor(Ce){this.options=Ce,this.process=Ie=>{const be=[];for(const $e of Ie)for(this.inputBuffer.push($e);this.hasEnoughDataForFrame();){const K=this.generateOutputFrame();be.push(K)}return be},Ce.nativeSampleRate<16e3&&Te.log.error("nativeSampleRate is too low. Should have 16000 = targetSampleRate <= nativeSampleRate"),this.inputBuffer=[]}async*stream(Ce){for(const Ie of Ce)for(this.inputBuffer.push(Ie);this.hasEnoughDataForFrame();)yield this.generateOutputFrame()}hasEnoughDataForFrame(){return this.inputBuffer.length*this.options.targetSampleRate/this.options.nativeSampleRate>=this.options.targetFrameSize}generateOutputFrame(){const Ce=new Float32Array(this.options.targetFrameSize);let Ie=0,be=0;for(;Ie<this.options.targetFrameSize;){let $e=0,K=0;for(;be<Math.min(this.inputBuffer.length,(Ie+1)*this.options.nativeSampleRate/this.options.targetSampleRate);){const k=this.inputBuffer[be];k!==void 0&&($e+=k,K++),be++}Ce[Ie]=$e/K,Ie++}return this.inputBuffer=this.inputBuffer.slice(be),Ce}};U.Resampler=ge})),Pc=lt((U=>{var Te=U&&U.__createBinding||(Object.create?(function(X,ee,le,ke){ke===void 0&&(ke=le);var he=Object.getOwnPropertyDescriptor(ee,le);(!he||("get"in he?!ee.__esModule:he.writable||he.configurable))&&(he={enumerable:!0,get:function(){return ee[le]}}),Object.defineProperty(X,ke,he)}):(function(X,ee,le,ke){ke===void 0&&(ke=le),X[ke]=ee[le]})),ge=U&&U.__setModuleDefault||(Object.create?(function(X,ee){Object.defineProperty(X,"default",{enumerable:!0,value:ee})}):function(X,ee){X.default=ee}),Ce=U&&U.__importStar||function(X){if(X&&X.__esModule)return X;var ee={};if(X!=null)for(var le in X)le!=="default"&&Object.prototype.hasOwnProperty.call(X,le)&&Te(ee,X,le);return ge(ee,X),ee};Object.defineProperty(U,"__esModule",{value:!0}),U.NonRealTimeVAD=U.defaultNonRealTimeVADOptions=void 0;var Ie=Ce(Rc()),be=Ip(),$e=Fn(),K=Gn(),k=Ia(),ie=Cp(),xe=Ap();U.defaultNonRealTimeVADOptions={...K.defaultFrameProcessorOptions,modelURL:be.baseAssetPath+"silero_vad_legacy.onnx",modelFetcher:$e.defaultModelFetcher};var pe=class{static async new(X={}){const ee={...U.defaultNonRealTimeVADOptions,...X};(0,K.validateOptions)(ee),ee.ortConfig!==void 0&&ee.ortConfig(Ie);const le=()=>ee.modelFetcher(ee.modelURL),ke=await ie.SileroLegacy.new(Ie,le),he=new K.FrameProcessor(ke.process,ke.reset_state,{positiveSpeechThreshold:ee.positiveSpeechThreshold,negativeSpeechThreshold:ee.negativeSpeechThreshold,redemptionMs:ee.redemptionMs,preSpeechPadMs:ee.preSpeechPadMs,minSpeechMs:ee.minSpeechMs,submitUserSpeechOnPause:ee.submitUserSpeechOnPause},1536/16);return he.resume(),new this(le,Ie,ee,he)}constructor(X,ee,le,ke){this.modelFetcher=X,this.ort=ee,this.options=le,this.frameProcessor=ke,this.frameSamples=1536}async*run(X,ee){const le={nativeSampleRate:ee,targetSampleRate:16e3,targetFrameSize:this.frameSamples},ke=new xe.Resampler(le);let he=0,Le=0,at=0;for await(const Ee of ke.stream(X)){const ye=[];await this.frameProcessor.process(Ee,oe=>{ye.push(oe)});for(const oe of ye)switch(oe.msg){case k.Message.SpeechStart:he=at*this.frameSamples/16;break;case k.Message.SpeechEnd:Le=(at+1)*this.frameSamples/16,yield{audio:oe.audio,start:he,end:Le};break;default:break}at++}const Ae=[];this.frameProcessor.endSegment(Ee=>{Ae.push(Ee)});for(const Ee of Ae)Ee.msg===k.Message.SpeechEnd&&(yield{audio:Ee.audio,start:he,end:at*this.frameSamples/16})}};U.NonRealTimeVAD=pe})),Uc=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.audioFileToArray=U.encodeWAV=U.arrayBufferToBase64=U.minFramesForTargetMS=void 0;function Te(k,ie,xe=16e3){return Math.ceil(k*xe/1e3/ie)}U.minFramesForTargetMS=Te;function ge(k){const ie=new Uint8Array(k),xe=ie.byteLength,pe=new Array(xe);for(let X=0;X<xe;X++){const ee=ie[X];if(ee===void 0)break;pe[X]=String.fromCharCode(ee)}return btoa(pe.join(""))}U.arrayBufferToBase64=ge;function Ce(k,ie=3,xe=16e3,pe=1,X=32){const ee=X/8,le=pe*ee,ke=new ArrayBuffer(44+k.length*ee),he=new DataView(ke);return $e(he,0,"RIFF"),he.setUint32(4,36+k.length*ee,!0),$e(he,8,"WAVE"),$e(he,12,"fmt "),he.setUint32(16,16,!0),he.setUint16(20,ie,!0),he.setUint16(22,pe,!0),he.setUint32(24,xe,!0),he.setUint32(28,xe*le,!0),he.setUint16(32,le,!0),he.setUint16(34,X,!0),$e(he,36,"data"),he.setUint32(40,k.length*ee,!0),ie===1?be(he,44,k):Ie(he,44,k),ke}U.encodeWAV=Ce;function Ie(k,ie,xe){for(let pe=0;pe<xe.length;pe++,ie+=4)k.setFloat32(ie,xe[pe],!0)}function be(k,ie,xe){for(let pe=0;pe<xe.length;pe++,ie+=2){const X=Math.max(-1,Math.min(1,xe[pe]));k.setInt16(ie,X<0?X*32768:X*32767,!0)}}function $e(k,ie,xe){for(let pe=0;pe<xe.length;pe++)k.setUint8(ie+pe,xe.charCodeAt(pe))}async function K(k){const ie=new OfflineAudioContext(1,1,44100),xe=new FileReader;let pe=null;if(await new Promise(le=>{xe.addEventListener("loadend",()=>{const ke=xe.result;ie.decodeAudioData(ke,he=>{pe=he,ie.startRendering().then(()=>{console.log("Rendering completed successfully"),le()}).catch(Le=>{console.error("Rendering failed: ",Le)})},he=>{console.log("Error with decoding audio data: ",he)})}),xe.readAsArrayBuffer(k)}),pe===null)throw Error("some shit");const X=pe,ee=new Float32Array(X.length);for(let le=0;le<X.length;le++)for(let ke=0;ke<X.numberOfChannels;ke++){const he=X.getChannelData(ke)[le],Le=ee[le];if(he===void 0||Le===void 0)throw new Error("sample or out[i] is undefined");ee[le]=Le+he}return{audio:ee,sampleRate:X.sampleRate}}U.audioFileToArray=K})),Nc=lt(((U,Te)=>{Tp();var ge=(()=>{var Ce=Object.defineProperty,Ie=Object.getOwnPropertyDescriptor,be=Object.getOwnPropertyNames,$e=Object.prototype.hasOwnProperty,K=(c=>typeof vt<"u"?vt:typeof Proxy<"u"?new Proxy(c,{get:(m,b)=>(typeof vt<"u"?vt:m)[b]}):c)(function(c){if(typeof vt<"u")return vt.apply(this,arguments);throw Error('Dynamic require of "'+c+'" is not supported')}),k=(c,m)=>()=>(c&&(m=c(c=0)),m),ie=(c,m)=>{for(var b in m)Ce(c,b,{get:m[b],enumerable:!0})},xe=(c,m,b,T)=>{if(m&&typeof m=="object"||typeof m=="function")for(let S of be(m))!$e.call(c,S)&&S!==b&&Ce(c,S,{get:()=>m[S],enumerable:!(T=Ie(m,S))||T.enumerable});return c},pe=c=>xe(Ce({},"__esModule",{value:!0}),c),X,ee,le,ke,he,Le=k(()=>{"use strict";X=new Map,ee=[],le=(c,m,b)=>{if(m&&typeof m.init=="function"&&typeof m.createInferenceSessionHandler=="function"){let T=X.get(c);if(T===void 0)X.set(c,{backend:m,priority:b});else{if(T.priority>b)return;if(T.priority===b&&T.backend!==m)throw new Error(`cannot register backend "${c}" using priority ${b}`)}if(b>=0){let S=ee.indexOf(c);S!==-1&&ee.splice(S,1);for(let O=0;O<ee.length;O++)if(X.get(ee[O]).priority<=b){ee.splice(O,0,c);return}ee.push(c)}return}throw new TypeError("not a valid backend")},ke=async c=>{let m=X.get(c);if(!m)return"backend not found.";if(m.initialized)return m.backend;if(m.aborted)return m.error;{let b=!!m.initPromise;try{return b||(m.initPromise=m.backend.init(c)),await m.initPromise,m.initialized=!0,m.backend}catch(T){return b||(m.error=`${T}`,m.aborted=!0),m.error}finally{delete m.initPromise}}},he=async c=>{let m=c.executionProviders||[],b=m.map(A=>typeof A=="string"?A:A.name),T=b.length===0?ee:b,S,O=[],z=new Set;for(let A of T){let L=await ke(A);typeof L=="string"?O.push({name:A,err:L}):(S||(S=L),S===L&&z.add(A))}if(!S)throw new Error(`no available backend found. ERR: ${O.map(A=>`[${A.name}] ${A.err}`).join(", ")}`);for(let{name:A,err:L}of O)b.includes(A)&&console.warn(`removing requested execution provider "${A}" from session options because it is not available: ${L}`);let E=m.filter(A=>z.has(typeof A=="string"?A:A.name));return[S,new Proxy(c,{get:(A,L)=>L==="executionProviders"?E:Reflect.get(A,L)})]}}),at=k(()=>{"use strict";Le()}),Ae,Ee=k(()=>{"use strict";Ae="1.24.1"}),ye,oe,Ge=k(()=>{"use strict";Ee(),ye="warning",oe={wasm:{},webgl:{},webgpu:{},versions:{common:Ae},set logLevel(c){if(c!==void 0){if(typeof c!="string"||["verbose","info","warning","error","fatal"].indexOf(c)===-1)throw new Error(`Unsupported logging level: ${c}`);ye=c}},get logLevel(){return ye}},Object.defineProperty(oe,"logLevel",{enumerable:!0})}),te,dt=k(()=>{"use strict";Ge(),te=oe}),We,xt,Mt=k(()=>{"use strict";We=(c,m)=>{let b=typeof document<"u"?document.createElement("canvas"):new OffscreenCanvas(1,1);b.width=c.dims[3],b.height=c.dims[2];let T=b.getContext("2d");if(T!=null){let S,O;m?.tensorLayout!==void 0&&m.tensorLayout==="NHWC"?(S=c.dims[2],O=c.dims[3]):(S=c.dims[3],O=c.dims[2]);let z=m?.format!==void 0?m.format:"RGB",E=m?.norm,A,L;E===void 0||E.mean===void 0?A=[255,255,255,255]:typeof E.mean=="number"?A=[E.mean,E.mean,E.mean,E.mean]:(A=[E.mean[0],E.mean[1],E.mean[2],0],E.mean[3]!==void 0&&(A[3]=E.mean[3])),E===void 0||E.bias===void 0?L=[0,0,0,0]:typeof E.bias=="number"?L=[E.bias,E.bias,E.bias,E.bias]:(L=[E.bias[0],E.bias[1],E.bias[2],0],E.bias[3]!==void 0&&(L[3]=E.bias[3]));let q=O*S,P=0,D=q,Y=q*2,C=-1;z==="RGBA"?(P=0,D=q,Y=q*2,C=q*3):z==="RGB"?(P=0,D=q,Y=q*2):z==="RBG"&&(P=0,Y=q,D=q*2);for(let F=0;F<O;F++)for(let Ve=0;Ve<S;Ve++){let re=(c.data[P++]-L[0])*A[0],Q=(c.data[D++]-L[1])*A[1],Oe=(c.data[Y++]-L[2])*A[2],j=C===-1?255:(c.data[C++]-L[3])*A[3];T.fillStyle="rgba("+re+","+Q+","+Oe+","+j+")",T.fillRect(Ve,F,1,1)}if("toDataURL"in b)return b.toDataURL();throw new Error("toDataURL is not supported")}else throw new Error("Can not access image data")},xt=(c,m)=>{let b=typeof document<"u"?document.createElement("canvas").getContext("2d"):new OffscreenCanvas(1,1).getContext("2d"),T;if(b!=null){let S,O,z;m?.tensorLayout!==void 0&&m.tensorLayout==="NHWC"?(S=c.dims[2],O=c.dims[1],z=c.dims[3]):(S=c.dims[3],O=c.dims[2],z=c.dims[1]);let E=m!==void 0&&m.format!==void 0?m.format:"RGB",A=m?.norm,L,q;A===void 0||A.mean===void 0?L=[255,255,255,255]:typeof A.mean=="number"?L=[A.mean,A.mean,A.mean,A.mean]:(L=[A.mean[0],A.mean[1],A.mean[2],255],A.mean[3]!==void 0&&(L[3]=A.mean[3])),A===void 0||A.bias===void 0?q=[0,0,0,0]:typeof A.bias=="number"?q=[A.bias,A.bias,A.bias,A.bias]:(q=[A.bias[0],A.bias[1],A.bias[2],0],A.bias[3]!==void 0&&(q[3]=A.bias[3]));let P=O*S;if(m!==void 0&&(m.format!==void 0&&z===4&&m.format!=="RGBA"||z===3&&m.format!=="RGB"&&m.format!=="BGR"))throw new Error("Tensor format doesn't match input tensor dims");let D=4,Y=0,C=1,F=2,Ve=3,re=0,Q=P,Oe=P*2,j=-1;E==="RGBA"?(re=0,Q=P,Oe=P*2,j=P*3):E==="RGB"?(re=0,Q=P,Oe=P*2):E==="RBG"&&(re=0,Oe=P,Q=P*2),T=b.createImageData(S,O);for(let Ye=0;Ye<O*S;Y+=D,C+=D,F+=D,Ve+=D,Ye++)T.data[Y]=(c.data[re++]-q[0])*L[0],T.data[C]=(c.data[Q++]-q[1])*L[1],T.data[F]=(c.data[Oe++]-q[2])*L[2],T.data[Ve]=j===-1?255:(c.data[j++]-q[3])*L[3]}else throw new Error("Can not access image data");return T}}),nt,or,ur,lr,Pe,Ft,li=k(()=>{"use strict";pr(),nt=(c,m)=>{if(c===void 0)throw new Error("Image buffer must be defined");if(m.height===void 0||m.width===void 0)throw new Error("Image height and width must be defined");if(m.tensorLayout==="NHWC")throw new Error("NHWC Tensor layout is not supported yet");let{height:b,width:T}=m,S=m.norm??{mean:255,bias:0},O,z;typeof S.mean=="number"?O=[S.mean,S.mean,S.mean,S.mean]:O=[S.mean[0],S.mean[1],S.mean[2],S.mean[3]??255],typeof S.bias=="number"?z=[S.bias,S.bias,S.bias,S.bias]:z=[S.bias[0],S.bias[1],S.bias[2],S.bias[3]??0];let E=m.format!==void 0?m.format:"RGBA",A=m.tensorFormat!==void 0&&m.tensorFormat!==void 0?m.tensorFormat:"RGB",L=b*T,q=A==="RGBA"?new Float32Array(L*4):new Float32Array(L*3),P=4,D=0,Y=1,C=2,F=3,Ve=0,re=L,Q=L*2,Oe=-1;E==="RGB"&&(P=3,D=0,Y=1,C=2,F=-1),A==="RGBA"?Oe=L*3:A==="RBG"?(Ve=0,Q=L,re=L*2):A==="BGR"&&(Q=0,re=L,Ve=L*2);for(let j=0;j<L;j++,D+=P,C+=P,Y+=P,F+=P)q[Ve++]=(c[D]+z[0])/O[0],q[re++]=(c[Y]+z[1])/O[1],q[Q++]=(c[C]+z[2])/O[2],Oe!==-1&&F!==-1&&(q[Oe++]=(c[F]+z[3])/O[3]);return A==="RGBA"?new Ue("float32",q,[1,4,b,T]):new Ue("float32",q,[1,3,b,T])},or=async(c,m)=>{let b=typeof HTMLImageElement<"u"&&c instanceof HTMLImageElement,T=typeof ImageData<"u"&&c instanceof ImageData,S=typeof ImageBitmap<"u"&&c instanceof ImageBitmap,O=typeof c=="string",z,E=m??{},A=()=>{if(typeof document<"u")return document.createElement("canvas");if(typeof OffscreenCanvas<"u")return new OffscreenCanvas(1,1);throw new Error("Canvas is not supported")},L=q=>typeof HTMLCanvasElement<"u"&&q instanceof HTMLCanvasElement||q instanceof OffscreenCanvas?q.getContext("2d"):null;if(b){let q=A();q.width=c.width,q.height=c.height;let P=L(q);if(P!=null){let D=c.height,Y=c.width;if(m!==void 0&&m.resizedHeight!==void 0&&m.resizedWidth!==void 0&&(D=m.resizedHeight,Y=m.resizedWidth),m!==void 0){if(E=m,m.tensorFormat!==void 0)throw new Error("Image input config format must be RGBA for HTMLImageElement");E.tensorFormat="RGBA",E.height=D,E.width=Y}else E.tensorFormat="RGBA",E.height=D,E.width=Y;P.drawImage(c,0,0),z=P.getImageData(0,0,Y,D).data}else throw new Error("Can not access image data")}else if(T){let q,P;if(m!==void 0&&m.resizedWidth!==void 0&&m.resizedHeight!==void 0?(q=m.resizedHeight,P=m.resizedWidth):(q=c.height,P=c.width),m!==void 0&&(E=m),E.format="RGBA",E.height=q,E.width=P,m!==void 0){let D=A();D.width=P,D.height=q;let Y=L(D);if(Y!=null)Y.putImageData(c,0,0),z=Y.getImageData(0,0,P,q).data;else throw new Error("Can not access image data")}else z=c.data}else if(S){if(m===void 0)throw new Error("Please provide image config with format for Imagebitmap");let q=A();q.width=c.width,q.height=c.height;let P=L(q);if(P!=null){let D=c.height,Y=c.width;return P.drawImage(c,0,0,Y,D),z=P.getImageData(0,0,Y,D).data,E.height=D,E.width=Y,nt(z,E)}else throw new Error("Can not access image data")}else{if(O)return new Promise((q,P)=>{let D=A(),Y=L(D);if(!c||!Y)return P();let C=new Image;C.crossOrigin="Anonymous",C.src=c,C.onload=()=>{D.width=C.width,D.height=C.height,Y.drawImage(C,0,0,D.width,D.height);let F=Y.getImageData(0,0,D.width,D.height);E.height=D.height,E.width=D.width,q(nt(F.data,E))}});throw new Error("Input data provided is not supported - aborted tensor creation")}if(z!==void 0)return nt(z,E);throw new Error("Input data provided is not supported - aborted tensor creation")},ur=(c,m)=>{let{width:b,height:T,download:S,dispose:O}=m;return new Ue({location:"texture",type:"float32",texture:c,dims:[1,T,b,4],download:S,dispose:O})},lr=(c,m)=>{let{dataType:b,dims:T,download:S,dispose:O}=m;return new Ue({location:"gpu-buffer",type:b??"float32",gpuBuffer:c,dims:T,download:S,dispose:O})},Pe=(c,m)=>{let{dataType:b,dims:T,download:S,dispose:O}=m;return new Ue({location:"ml-tensor",type:b??"float32",mlTensor:c,dims:T,download:S,dispose:O})},Ft=(c,m,b)=>new Ue({location:"cpu-pinned",type:c,data:m,dims:b??[m.length]})}),tt,St,dr,di,ka=k(()=>{"use strict";tt=new Map([["float32",Float32Array],["uint8",Uint8Array],["int8",Int8Array],["uint16",Uint16Array],["int16",Int16Array],["int32",Int32Array],["bool",Uint8Array],["float64",Float64Array],["uint32",Uint32Array],["int4",Uint8Array],["uint4",Uint8Array]]),St=new Map([[Float32Array,"float32"],[Uint8Array,"uint8"],[Int8Array,"int8"],[Uint16Array,"uint16"],[Int16Array,"int16"],[Int32Array,"int32"],[Float64Array,"float64"],[Uint32Array,"uint32"]]),dr=!1,di=()=>{if(!dr){dr=!0;let c=typeof BigInt64Array<"u"&&BigInt64Array.from,m=typeof BigUint64Array<"u"&&BigUint64Array.from,b=globalThis.Float16Array,T=typeof b<"u"&&b.from;c&&(tt.set("int64",BigInt64Array),St.set(BigInt64Array,"int64")),m&&(tt.set("uint64",BigUint64Array),St.set(BigUint64Array,"uint64")),T?(tt.set("float16",b),St.set(b,"float16")):tt.set("float16",Uint16Array)}}}),pi,ci,za=k(()=>{"use strict";pr(),pi=c=>{let m=1;for(let b=0;b<c.length;b++){let T=c[b];if(typeof T!="number"||!Number.isSafeInteger(T))throw new TypeError(`dims[${b}] must be an integer, got: ${T}`);if(T<0)throw new RangeError(`dims[${b}] must be a non-negative integer, got: ${T}`);m*=T}return m},ci=(c,m)=>{switch(c.location){case"cpu":return new Ue(c.type,c.data,m);case"cpu-pinned":return new Ue({location:"cpu-pinned",data:c.data,type:c.type,dims:m});case"texture":return new Ue({location:"texture",texture:c.texture,type:c.type,dims:m});case"gpu-buffer":return new Ue({location:"gpu-buffer",gpuBuffer:c.gpuBuffer,type:c.type,dims:m});case"ml-tensor":return new Ue({location:"ml-tensor",mlTensor:c.mlTensor,type:c.type,dims:m});default:throw new Error(`tensorReshape: tensor location ${c.location} is not supported`)}}}),Ue,pr=k(()=>{"use strict";Mt(),li(),ka(),za(),Ue=class{constructor(c,m,b){di();let T,S;if(typeof c=="object"&&"location"in c)switch(this.dataLocation=c.location,T=c.type,S=c.dims,c.location){case"cpu-pinned":{let z=tt.get(T);if(!z)throw new TypeError(`unsupported type "${T}" to create tensor from pinned buffer`);if(!(c.data instanceof z))throw new TypeError(`buffer should be of type ${z.name}`);this.cpuData=c.data;break}case"texture":if(T!=="float32")throw new TypeError(`unsupported type "${T}" to create tensor from texture`);this.gpuTextureData=c.texture,this.downloader=c.download,this.disposer=c.dispose;break;case"gpu-buffer":if(T!=="float32"&&T!=="float16"&&T!=="int32"&&T!=="int64"&&T!=="uint32"&&T!=="uint8"&&T!=="bool"&&T!=="uint4"&&T!=="int4")throw new TypeError(`unsupported type "${T}" to create tensor from gpu buffer`);this.gpuBufferData=c.gpuBuffer,this.downloader=c.download,this.disposer=c.dispose;break;case"ml-tensor":if(T!=="float32"&&T!=="float16"&&T!=="int32"&&T!=="int64"&&T!=="uint32"&&T!=="uint64"&&T!=="int8"&&T!=="uint8"&&T!=="bool"&&T!=="uint4"&&T!=="int4")throw new TypeError(`unsupported type "${T}" to create tensor from MLTensor`);this.mlTensorData=c.mlTensor,this.downloader=c.download,this.disposer=c.dispose;break;default:throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`)}else{let z,E;if(typeof c=="string")if(T=c,E=b,c==="string"){if(!Array.isArray(m))throw new TypeError("A string tensor's data must be a string array.");z=m}else{let A=tt.get(c);if(A===void 0)throw new TypeError(`Unsupported tensor type: ${c}.`);if(Array.isArray(m)){if(c==="float16"&&A===Uint16Array||c==="uint4"||c==="int4")throw new TypeError(`Creating a ${c} tensor from number array is not supported. Please use ${A.name} as data.`);c==="uint64"||c==="int64"?z=A.from(m,BigInt):z=A.from(m)}else if(m instanceof A)z=m;else if(m instanceof Uint8ClampedArray)if(c==="uint8")z=Uint8Array.from(m);else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");else if(c==="float16"&&m instanceof Uint16Array&&A!==Uint16Array)z=new globalThis.Float16Array(m.buffer,m.byteOffset,m.length);else throw new TypeError(`A ${T} tensor's data must be type of ${A}`)}else if(E=m,Array.isArray(c)){if(c.length===0)throw new TypeError("Tensor type cannot be inferred from an empty array.");let A=typeof c[0];if(A==="string")T="string",z=c;else if(A==="boolean")T="bool",z=Uint8Array.from(c);else throw new TypeError(`Invalid element type of data array: ${A}.`)}else if(c instanceof Uint8ClampedArray)T="uint8",z=Uint8Array.from(c);else{let A=St.get(c.constructor);if(A===void 0)throw new TypeError(`Unsupported type for tensor data: ${c.constructor}.`);T=A,z=c}if(E===void 0)E=[z.length];else if(!Array.isArray(E))throw new TypeError("A tensor's dims must be a number array");S=E,this.cpuData=z,this.dataLocation="cpu"}let O=pi(S);if(this.cpuData&&O!==this.cpuData.length&&!((T==="uint4"||T==="int4")&&Math.ceil(O/2)===this.cpuData.length))throw new Error(`Tensor's size(${O}) does not match data length(${this.cpuData.length}).`);this.type=T,this.dims=S,this.size=O}static async fromImage(c,m){return or(c,m)}static fromTexture(c,m){return ur(c,m)}static fromGpuBuffer(c,m){return lr(c,m)}static fromMLTensor(c,m){return Pe(c,m)}static fromPinnedBuffer(c,m,b){return Ft(c,m,b)}toDataURL(c){return We(this,c)}toImageData(c){return xt(this,c)}get data(){if(this.ensureValid(),!this.cpuData)throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");return this.cpuData}get location(){return this.dataLocation}get texture(){if(this.ensureValid(),!this.gpuTextureData)throw new Error("The data is not stored as a WebGL texture.");return this.gpuTextureData}get gpuBuffer(){if(this.ensureValid(),!this.gpuBufferData)throw new Error("The data is not stored as a WebGPU buffer.");return this.gpuBufferData}get mlTensor(){if(this.ensureValid(),!this.mlTensorData)throw new Error("The data is not stored as a WebNN MLTensor.");return this.mlTensorData}async getData(c){switch(this.ensureValid(),this.dataLocation){case"cpu":case"cpu-pinned":return this.data;case"texture":case"gpu-buffer":case"ml-tensor":if(!this.downloader)throw new Error("The current tensor is not created with a specified data downloader.");if(this.isDownloading)throw new Error("The current tensor is being downloaded.");try{this.isDownloading=!0;let m=await this.downloader();return this.downloader=void 0,this.dataLocation="cpu",this.cpuData=m,c&&this.disposer&&(this.disposer(),this.disposer=void 0),m}finally{this.isDownloading=!1}default:throw new Error(`cannot get data from location: ${this.dataLocation}`)}}dispose(){if(this.isDownloading)throw new Error("The current tensor is being downloaded.");this.disposer&&(this.disposer(),this.disposer=void 0),this.cpuData=void 0,this.gpuTextureData=void 0,this.gpuBufferData=void 0,this.mlTensorData=void 0,this.downloader=void 0,this.isDownloading=void 0,this.dataLocation="none"}ensureValid(){if(this.dataLocation==="none")throw new Error("The tensor is disposed.")}reshape(c){if(this.ensureValid(),this.downloader||this.disposer)throw new Error("Cannot reshape a tensor that owns GPU resource.");return ci(this,c)}}}),He,hi=k(()=>{"use strict";pr(),He=Ue}),Dt,cr,et,Qe,st,ot,fi=k(()=>{"use strict";Ge(),Dt=(c,m)=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||console.timeStamp(`${c}::ORT::${m}`)},cr=(c,m)=>{let b=new Error().stack?.split(/\r\n|\r|\n/g)||[],T=!1;for(let S=0;S<b.length;S++){if(T&&!b[S].includes("TRACE_FUNC")){let O=`FUNC_${c}::${b[S].trim().split(" ")[1]}`;m&&(O+=`::${m}`),Dt("CPU",O);return}b[S].includes("TRACE_FUNC")&&(T=!0)}},et=c=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||cr("BEGIN",c)},Qe=c=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||cr("END",c)},st=c=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||console.time(`ORT::${c}`)},ot=c=>{(typeof oe.trace>"u"?!oe.wasm.trace:!oe.trace)||console.timeEnd(`ORT::${c}`)}}),mi,Ca=k(()=>{"use strict";Le(),hi(),fi(),mi=class Op{constructor(m){this.handler=m}async run(m,b,T){et(),st("InferenceSession.run");let S={},O={};if(typeof m!="object"||m===null||m instanceof He||Array.isArray(m))throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");let z=!0;if(typeof b=="object"){if(b===null)throw new TypeError("Unexpected argument[1]: cannot be null.");if(b instanceof He)throw new TypeError("'fetches' cannot be a Tensor");if(Array.isArray(b)){if(b.length===0)throw new TypeError("'fetches' cannot be an empty array.");z=!1;for(let L of b){if(typeof L!="string")throw new TypeError("'fetches' must be a string array or an object.");if(this.outputNames.indexOf(L)===-1)throw new RangeError(`'fetches' contains invalid output name: ${L}.`);S[L]=null}if(typeof T=="object"&&T!==null)O=T;else if(typeof T<"u")throw new TypeError("'options' must be an object.")}else{let L=!1,q=Object.getOwnPropertyNames(b);for(let P of this.outputNames)if(q.indexOf(P)!==-1){let D=b[P];(D===null||D instanceof He)&&(L=!0,z=!1,S[P]=D)}if(L){if(typeof T=="object"&&T!==null)O=T;else if(typeof T<"u")throw new TypeError("'options' must be an object.")}else O=b}}else if(typeof b<"u")throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");for(let L of this.inputNames)if(typeof m[L]>"u")throw new Error(`input '${L}' is missing in 'feeds'.`);if(z)for(let L of this.outputNames)S[L]=null;let E=await this.handler.run(m,S,O),A={};for(let L in E)if(Object.hasOwnProperty.call(E,L)){let q=E[L];q instanceof He?A[L]=q:A[L]=new He(q.type,q.data,q.dims)}return ot("InferenceSession.run"),Qe(),A}async release(){return this.handler.dispose()}static async create(m,b,T,S){et(),st("InferenceSession.create");let O,z={};if(typeof m=="string"){if(O=m,typeof b=="object"&&b!==null)z=b;else if(typeof b<"u")throw new TypeError("'options' must be an object.")}else if(m instanceof Uint8Array){if(O=m,typeof b=="object"&&b!==null)z=b;else if(typeof b<"u")throw new TypeError("'options' must be an object.")}else if(m instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&m instanceof SharedArrayBuffer){let q=m,P=0,D=m.byteLength;if(typeof b=="object"&&b!==null)z=b;else if(typeof b=="number"){if(P=b,!Number.isSafeInteger(P))throw new RangeError("'byteOffset' must be an integer.");if(P<0||P>=q.byteLength)throw new RangeError(`'byteOffset' is out of range [0, ${q.byteLength}).`);if(D=m.byteLength-P,typeof T=="number"){if(D=T,!Number.isSafeInteger(D))throw new RangeError("'byteLength' must be an integer.");if(D<=0||P+D>q.byteLength)throw new RangeError(`'byteLength' is out of range (0, ${q.byteLength-P}].`);if(typeof S=="object"&&S!==null)z=S;else if(typeof S<"u")throw new TypeError("'options' must be an object.")}else if(typeof T<"u")throw new TypeError("'byteLength' must be a number.")}else if(typeof b<"u")throw new TypeError("'options' must be an object.");O=new Uint8Array(q,P,D)}else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");let[E,A]=await he(z),L=await E.createInferenceSessionHandler(O,A);return ot("InferenceSession.create"),Qe(),new Op(L)}startProfiling(){this.handler.startProfiling()}endProfiling(){this.handler.endProfiling()}get inputNames(){return this.handler.inputNames}get outputNames(){return this.handler.outputNames}get inputMetadata(){return this.handler.inputMetadata}get outputMetadata(){return this.handler.outputMetadata}}}),hr,Aa=k(()=>{"use strict";Ca(),hr=mi}),Oa=k(()=>{"use strict"}),Ra=k(()=>{"use strict"}),Ba=k(()=>{"use strict"}),Ma=k(()=>{"use strict"}),gi={};ie(gi,{InferenceSession:()=>hr,TRACE:()=>Dt,TRACE_EVENT_BEGIN:()=>st,TRACE_EVENT_END:()=>ot,TRACE_FUNC_BEGIN:()=>et,TRACE_FUNC_END:()=>Qe,Tensor:()=>He,env:()=>te,registerBackend:()=>le});var Xe=k(()=>{"use strict";at(),dt(),Aa(),hi(),Oa(),Ra(),fi(),Ba(),Ma()}),fr=k(()=>{"use strict"}),yi={};ie(yi,{default:()=>wi});var mr,gr,wi,Da=k(()=>{"use strict";Pi(),ht(),$r(),mr="ort-wasm-proxy-worker",gr=globalThis.self?.name===mr,gr&&(self.onmessage=c=>{let{type:m,in:b}=c.data;try{switch(m){case"init-wasm":Sr(b.wasm).then(()=>{Wr(b).then(()=>{postMessage({type:m})},T=>{postMessage({type:m,err:T})})},T=>{postMessage({type:m,err:T})});break;case"init-ep":{let{epName:T,env:S}=b;Hr(S,T).then(()=>{postMessage({type:m})},O=>{postMessage({type:m,err:O})});break}case"copy-from":{let{buffer:T}=b,S=ze(T);postMessage({type:m,out:S});break}case"create":{let{model:T,options:S}=b;yt(T,S).then(O=>{postMessage({type:m,out:O})},O=>{postMessage({type:m,err:O})});break}case"release":Zr(b),postMessage({type:m});break;case"run":{let{sessionId:T,inputIndices:S,inputs:O,outputIndices:z,options:E}=b;M(T,S,O,z,new Array(z.length).fill(null),E).then(A=>{A.some(L=>L[3]!=="cpu")?postMessage({type:m,err:"Proxy does not support non-cpu tensor location."}):postMessage({type:m,out:A},Qr([...O,...A]))},A=>{postMessage({type:m,err:A})});break}case"end-profiling":Qt(b),postMessage({type:m});break;default:}}catch(T){postMessage({type:m,err:T})}}),wi=gr?null:c=>new Worker(c??Ne,{type:"classic",name:mr})}),_i,bi,Ne,yr,Gt,$i,vi,wr,xi,_r,Si,br,Ti,$r=k(()=>{"use strict";fr(),_i=typeof location>"u"?void 0:location.origin,bi=()=>typeof document<"u"?document.currentScript?.src:typeof self<"u"?self.location?.href:void 0,Ne=bi(),yr=()=>{if(Ne&&!Ne.startsWith("blob:"))return Ne.substring(0,Ne.lastIndexOf("/")+1)},Gt=(c,m)=>{try{let b=m??Ne;return(b?new URL(c,b):new URL(c)).origin===_i}catch{return!1}},$i=(c,m)=>{let b=m??Ne;try{return(b?new URL(c,b):new URL(c)).href}catch{return}},vi=(c,m)=>`${m??"./"}${c}`,wr=async c=>{let m=await(await fetch(c,{credentials:"same-origin"})).blob();return URL.createObjectURL(m)},xi=async c=>(await Ep(async()=>{const{default:m}=await import(c);return{default:m}},[])).default,_r=(Da(),pe(yi)).default,Si=async()=>{if(!Ne)throw new Error("Failed to load proxy worker: cannot determine the script source URL.");if(Gt(Ne))return[void 0,_r()];let c=await wr(Ne);return[c,_r(c)]},br=void 0,Ti=async(c,m,b,T)=>{let S=br&&!(c||m);if(S)if(Ne)S=Gt(Ne);else if(T&&!b)S=!0;else throw new Error("cannot determine the script source URL.");if(S)return[void 0,br];{let O="ort-wasm-simd-threaded.mjs",z=c??$i(O,m),E=b&&z&&!Gt(z,m),A=E?await wr(z):z??vi(O,m);return[E?A:void 0,await xi(A)]}}}),vr,Wt,Tt,xr,Ei,Ii,ki,Sr,de,ht=k(()=>{"use strict";$r(),Wt=!1,Tt=!1,xr=!1,Ei=()=>{if(typeof SharedArrayBuffer>"u")return!1;try{return typeof MessageChannel<"u"&&new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)),WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,4,1,3,1,1,10,11,1,9,0,65,0,254,16,2,0,26,11]))}catch{return!1}},Ii=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,30,1,28,0,65,0,253,15,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,186,1,26,11]))}catch{return!1}},ki=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,19,1,17,0,65,1,253,15,65,2,253,15,65,3,253,15,253,147,2,11]))}catch{return!1}},Sr=async c=>{if(Wt)return Promise.resolve();if(Tt)throw new Error("multiple calls to 'initializeWebAssembly()' detected.");if(xr)throw new Error("previous call to 'initializeWebAssembly()' failed.");Tt=!0;let m=c.initTimeout,b=c.numThreads;if(c.simd!==!1){if(c.simd==="relaxed"){if(!ki())throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.")}else if(!Ii())throw new Error("WebAssembly SIMD is not supported in the current environment.")}let T=Ei();b>1&&!T&&(typeof self<"u"&&!self.crossOriginIsolated&&console.warn("env.wasm.numThreads is set to "+b+", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."),console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."),c.numThreads=b=1);let S=c.wasmPaths,O=typeof S=="string"?S:void 0,z=S?.mjs,E=z?.href??z,A=S?.wasm,L=A?.href??A,q=c.wasmBinary,[P,D]=await Ti(E,O,b>1,!!q||!!L),Y=!1,C=[];if(m>0&&C.push(new Promise(F=>{setTimeout(()=>{Y=!0,F()},m)})),C.push(new Promise((F,Ve)=>{let re={numThreads:b};if(q)re.wasmBinary=q;else if(L||O)re.locateFile=Q=>L??O+Q;else if(E&&E.indexOf("blob:")!==0)re.locateFile=Q=>new URL(Q,E).href;else if(P){let Q=yr();Q&&(re.locateFile=Oe=>Q+Oe)}D(re).then(Q=>{Tt=!1,Wt=!0,vr=Q,F(),P&&URL.revokeObjectURL(P)},Q=>{Tt=!1,xr=!0,Ve(Q)})})),await Promise.race(C),Y)throw new Error(`WebAssembly backend initializing failed due to timeout: ${m}ms`)},de=()=>{if(Wt&&vr)return vr;throw new Error("WebAssembly is not initialized yet.")}}),je,Ht,ae,Tr=k(()=>{"use strict";ht(),je=(c,m)=>{let b=de(),T=b.lengthBytesUTF8(c)+1,S=b._malloc(T);return b.stringToUTF8(c,S,T),m.push(S),S},Ht=(c,m,b,T)=>{if(typeof c=="object"&&c!==null){if(b.has(c))throw new Error("Circular reference in options");b.add(c)}Object.entries(c).forEach(([S,O])=>{let z=m?m+S:S;if(typeof O=="object")Ht(O,z+".",b,T);else if(typeof O=="string"||typeof O=="number")T(z,O.toString());else if(typeof O=="boolean")T(z,O?"1":"0");else throw new Error(`Can't handle extra config type: ${typeof O}`)})},ae=c=>{let m=de(),b=m.stackSave();try{let T=m.PTR_SIZE,S=m.stackAlloc(2*T);m._OrtGetLastError(S,S+T);let O=Number(m.getValue(S,T===4?"i32":"i64")),z=m.getValue(S+T,"*"),E=z?m.UTF8ToString(z):"";throw new Error(`${c} ERROR_CODE: ${O}, ERROR_MESSAGE: ${E}`)}finally{m.stackRestore(b)}}}),zi,Pa=k(()=>{"use strict";ht(),Tr(),zi=c=>{let m=de(),b=0,T=[],S=c||{};try{if(c?.logSeverityLevel===void 0)S.logSeverityLevel=2;else if(typeof c.logSeverityLevel!="number"||!Number.isInteger(c.logSeverityLevel)||c.logSeverityLevel<0||c.logSeverityLevel>4)throw new Error(`log severity level is not valid: ${c.logSeverityLevel}`);if(c?.logVerbosityLevel===void 0)S.logVerbosityLevel=0;else if(typeof c.logVerbosityLevel!="number"||!Number.isInteger(c.logVerbosityLevel))throw new Error(`log verbosity level is not valid: ${c.logVerbosityLevel}`);c?.terminate===void 0&&(S.terminate=!1);let O=0;return c?.tag!==void 0&&(O=je(c.tag,T)),b=m._OrtCreateRunOptions(S.logSeverityLevel,S.logVerbosityLevel,!!S.terminate,O),b===0&&ae("Can't create run options."),c?.extra!==void 0&&Ht(c.extra,"",new WeakSet,(z,E)=>{let A=je(z,T),L=je(E,T);m._OrtAddRunConfigEntry(b,A,L)!==0&&ae(`Can't set a run config entry: ${z} - ${E}.`)}),[b,T]}catch(O){throw b!==0&&m._OrtReleaseRunOptions(b),T.forEach(z=>m._free(z)),O}}}),Ci,Ai,Oi,Et,Ri,Bi,Ua=k(()=>{"use strict";ht(),Tr(),Ci=c=>{switch(c){case"disabled":return 0;case"basic":return 1;case"extended":return 2;case"layout":return 3;case"all":return 99;default:throw new Error(`unsupported graph optimization level: ${c}`)}},Ai=c=>{switch(c){case"sequential":return 0;case"parallel":return 1;default:throw new Error(`unsupported execution mode: ${c}`)}},Oi=c=>{c.extra||(c.extra={}),c.extra.session||(c.extra.session={});let m=c.extra.session;m.use_ort_model_bytes_directly||(m.use_ort_model_bytes_directly="1"),c.executionProviders&&c.executionProviders.some(b=>(typeof b=="string"?b:b.name)==="webgpu")&&(c.enableMemPattern=!1)},Et=(c,m,b,T)=>{let S=je(m,T),O=je(b,T);de()._OrtAddSessionConfigEntry(c,S,O)!==0&&ae(`Can't set a session config entry: ${m} - ${b}.`)},Ri=async(c,m,b)=>{let T=m.executionProviders;for(let S of T){let O=typeof S=="string"?S:S.name,z=[];switch(O){case"webnn":if(O="WEBNN",typeof S!="string"){let P=S?.deviceType;P&&Et(c,"deviceType",P,b)}break;case"webgpu":if(O="JS",typeof S!="string"){let P=S;if(P?.preferredLayout){if(P.preferredLayout!=="NCHW"&&P.preferredLayout!=="NHWC")throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${P.preferredLayout}`);Et(c,"preferredLayout",P.preferredLayout,b)}}break;case"wasm":case"cpu":continue;default:throw new Error(`not supported execution provider: ${O}`)}let E=je(O,b),A=z.length,L=0,q=0;if(A>0){L=de()._malloc(A*de().PTR_SIZE),b.push(L),q=de()._malloc(A*de().PTR_SIZE),b.push(q);for(let P=0;P<A;P++)de().setValue(L+P*de().PTR_SIZE,z[P][0],"*"),de().setValue(q+P*de().PTR_SIZE,z[P][1],"*")}await de()._OrtAppendExecutionProvider(c,E,L,q,A)!==0&&ae(`Can't append execution provider: ${O}.`)}},Bi=async c=>{let m=de(),b=0,T=[],S=c||{};Oi(S);try{let O=Ci(S.graphOptimizationLevel??"all"),z=Ai(S.executionMode??"sequential"),E=typeof S.logId=="string"?je(S.logId,T):0,A=S.logSeverityLevel??2;if(!Number.isInteger(A)||A<0||A>4)throw new Error(`log severity level is not valid: ${A}`);let L=S.logVerbosityLevel??0;if(!Number.isInteger(L)||L<0||L>4)throw new Error(`log verbosity level is not valid: ${L}`);let q=typeof S.optimizedModelFilePath=="string"?je(S.optimizedModelFilePath,T):0;if(b=m._OrtCreateSessionOptions(O,!!S.enableCpuMemArena,!!S.enableMemPattern,z,!!S.enableProfiling,0,E,A,L,q),b===0&&ae("Can't create session options."),S.executionProviders&&await Ri(b,S,T),S.enableGraphCapture!==void 0){if(typeof S.enableGraphCapture!="boolean")throw new Error(`enableGraphCapture must be a boolean value: ${S.enableGraphCapture}`);Et(b,"enableGraphCapture",S.enableGraphCapture.toString(),T)}if(S.freeDimensionOverrides)for(let[P,D]of Object.entries(S.freeDimensionOverrides)){if(typeof P!="string")throw new Error(`free dimension override name must be a string: ${P}`);if(typeof D!="number"||!Number.isInteger(D)||D<0)throw new Error(`free dimension override value must be a non-negative integer: ${D}`);let Y=je(P,T);m._OrtAddFreeDimensionOverride(b,Y,D)!==0&&ae(`Can't set a free dimension override: ${P} - ${D}.`)}return S.extra!==void 0&&Ht(S.extra,"",new WeakSet,(P,D)=>{Et(b,P,D,T)}),[b,T]}catch(O){throw b!==0&&m._OrtReleaseSessionOptions(b)!==0&&ae("Can't release session options."),T.forEach(z=>m._free(z)),O}}}),ft,mt,gt,Er,Ir,kr,zr,Gr,ue=k(()=>{"use strict";ft=c=>{switch(c){case"int8":return 3;case"uint8":return 2;case"bool":return 9;case"int16":return 5;case"uint16":return 4;case"int32":return 6;case"uint32":return 12;case"float16":return 10;case"float32":return 1;case"float64":return 11;case"string":return 8;case"int64":return 7;case"uint64":return 13;case"int4":return 22;case"uint4":return 21;default:throw new Error(`unsupported data type: ${c}`)}},mt=c=>{switch(c){case 3:return"int8";case 2:return"uint8";case 9:return"bool";case 5:return"int16";case 4:return"uint16";case 6:return"int32";case 12:return"uint32";case 10:return"float16";case 1:return"float32";case 11:return"float64";case 8:return"string";case 7:return"int64";case 13:return"uint64";case 22:return"int4";case 21:return"uint4";default:throw new Error(`unsupported data type: ${c}`)}},gt=(c,m)=>{let b=[-1,4,1,1,2,2,4,8,-1,1,2,8,4,8,-1,-1,-1,-1,-1,-1,-1,.5,.5][c],T=typeof m=="number"?m:m.reduce((S,O)=>S*O,1);return b>0?Math.ceil(T*b):void 0},Er=c=>{switch(c){case"float16":return typeof Float16Array<"u"&&Float16Array.from?Float16Array:Uint16Array;case"float32":return Float32Array;case"uint8":return Uint8Array;case"int8":return Int8Array;case"uint16":return Uint16Array;case"int16":return Int16Array;case"int32":return Int32Array;case"bool":return Uint8Array;case"float64":return Float64Array;case"uint32":return Uint32Array;case"int64":return BigInt64Array;case"uint64":return BigUint64Array;default:throw new Error(`unsupported type: ${c}`)}},Ir=c=>{switch(c){case"verbose":return 0;case"info":return 1;case"warning":return 2;case"error":return 3;case"fatal":return 4;default:throw new Error(`unsupported logging level: ${c}`)}},kr=c=>c==="float32"||c==="float16"||c==="int32"||c==="int64"||c==="uint32"||c==="uint8"||c==="bool"||c==="uint4"||c==="int4",zr=c=>c==="float32"||c==="float16"||c==="int32"||c==="int64"||c==="uint32"||c==="uint64"||c==="int8"||c==="uint8"||c==="bool"||c==="uint4"||c==="int4",Gr=c=>{switch(c){case"none":return 0;case"cpu":return 1;case"cpu-pinned":return 2;case"texture":return 3;case"gpu-buffer":return 4;case"ml-tensor":return 5;default:throw new Error(`unsupported data location: ${c}`)}}}),Cr,Mi=k(()=>{"use strict";fr(),Cr=async c=>{if(typeof c=="string"){let m=await fetch(c);if(!m.ok)throw new Error(`failed to load external data file: ${c}`);let b=m.headers.get("Content-Length"),T=b?parseInt(b,10):0;if(T<1073741824)return new Uint8Array(await m.arrayBuffer());{if(!m.body)throw new Error(`failed to load external data file: ${c}, no response body.`);let S=m.body.getReader(),O;try{O=new ArrayBuffer(T)}catch(E){if(E instanceof RangeError){let A=Math.ceil(T/65536);O=new WebAssembly.Memory({initial:A,maximum:A}).buffer}else throw E}let z=0;for(;;){let{done:E,value:A}=await S.read();if(E)break;let L=A.byteLength;new Uint8Array(O,z,L).set(A),z+=L}return new Uint8Array(O,0,T)}}else return c instanceof Blob?new Uint8Array(await c.arrayBuffer()):c instanceof Uint8Array?c:new Uint8Array(c)}}),Di,Wr,Hr,Pt,jr,Kr,ze,yt,Zr,Ut,M,Qt,Qr,Pi=k(()=>{"use strict";Xe(),Pa(),Ua(),ue(),ht(),Tr(),Mi(),Di=(c,m)=>{de()._OrtInit(c,m)!==0&&ae("Can't initialize onnxruntime.")},Wr=async c=>{Di(c.wasm.numThreads,Ir(c.logLevel))},Hr=async(c,m)=>{de().asyncInit?.();let b=c.webgpu.adapter;if(m==="webgpu"){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not supported in current environment");if(b){if(typeof b.limits!="object"||typeof b.features!="object"||typeof b.requestDevice!="function")throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.")}else{let T=c.webgpu.powerPreference;if(T!==void 0&&T!=="low-power"&&T!=="high-performance")throw new Error(`Invalid powerPreference setting: "${T}"`);let S=c.webgpu.forceFallbackAdapter;if(S!==void 0&&typeof S!="boolean")throw new Error(`Invalid forceFallbackAdapter setting: "${S}"`);if(b=await navigator.gpu.requestAdapter({powerPreference:T,forceFallbackAdapter:S}),!b)throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.')}}if(m==="webnn"&&(typeof navigator>"u"||!navigator.ml))throw new Error("WebNN is not supported in current environment")},Pt=new Map,jr=c=>{let m=de(),b=m.stackSave();try{let T=m.PTR_SIZE,S=m.stackAlloc(2*T);m._OrtGetInputOutputCount(c,S,S+T)!==0&&ae("Can't get session input/output count.");let O=T===4?"i32":"i64";return[Number(m.getValue(S,O)),Number(m.getValue(S+T,O))]}finally{m.stackRestore(b)}},Kr=(c,m)=>{let b=de(),T=b.stackSave(),S=0;try{let O=b.PTR_SIZE,z=b.stackAlloc(2*O);b._OrtGetInputOutputMetadata(c,m,z,z+O)!==0&&ae("Can't get session input/output metadata.");let E=Number(b.getValue(z,"*"));S=Number(b.getValue(z+O,"*"));let A=b.HEAP32[S/4];if(A===0)return[E,0];let L=b.HEAPU32[S/4+1],q=[];for(let P=0;P<L;P++){let D=Number(b.getValue(S+8+P*O,"*"));q.push(D!==0?b.UTF8ToString(D):Number(b.getValue(S+8+(P+L)*O,"*")))}return[E,A,q]}finally{b.stackRestore(T),S!==0&&b._OrtFree(S)}},ze=c=>{let m=de(),b=m._malloc(c.byteLength);if(b===0)throw new Error(`Can't create a session. failed to allocate a buffer of size ${c.byteLength}.`);return m.HEAPU8.set(c,b),[b,c.byteLength]},yt=async(c,m)=>{let b,T,S=de();Array.isArray(c)?[b,T]=c:c.buffer===S.HEAPU8.buffer?[b,T]=[c.byteOffset,c.byteLength]:[b,T]=ze(c);let O=0,z=0,E=[],A=[],L=[];try{if([z,E]=await Bi(m),m?.externalData&&S.mountExternalData){let re=[];for(let Q of m.externalData){let Oe=typeof Q=="string"?Q:Q.path;re.push(Cr(typeof Q=="string"?Q:Q.data).then(j=>{S.mountExternalData(Oe,j)}))}await Promise.all(re)}for(let re of m?.executionProviders??[])if((typeof re=="string"?re:re.name)==="webnn"){if(S.shouldTransferToMLTensor=!1,typeof re!="string"){let Q=re,Oe=Q?.context,j=Q?.gpuDevice,Ye=Q?.deviceType,Vt=Q?.powerPreference;Oe?S.currentContext=Oe:j?S.currentContext=await S.webnnCreateMLContext(j):S.currentContext=await S.webnnCreateMLContext({deviceType:Ye,powerPreference:Vt})}else S.currentContext=await S.webnnCreateMLContext();break}O=await S._OrtCreateSession(b,T,z),S.webgpuOnCreateSession?.(O),O===0&&ae("Can't create a session."),S.jsepOnCreateSession?.(),S.currentContext&&(S.webnnRegisterMLContext(O,S.currentContext),S.currentContext=void 0,S.shouldTransferToMLTensor=!0);let[q,P]=jr(O),D=!!m?.enableGraphCapture,Y=[],C=[],F=[],Ve=[];for(let re=0;re<q;re++){let[Q,Oe,j]=Kr(O,re);Q===0&&ae("Can't get an input name."),A.push(Q);let Ye=S.UTF8ToString(Q);Y.push(Ye),F.push(Oe===0?{name:Ye,isTensor:!1}:{name:Ye,isTensor:!0,type:mt(Oe),shape:j})}for(let re=0;re<P;re++){let[Q,Oe,j]=Kr(O,re+q);Q===0&&ae("Can't get an output name."),L.push(Q);let Ye=S.UTF8ToString(Q);C.push(Ye),Ve.push(Oe===0?{name:Ye,isTensor:!1}:{name:Ye,isTensor:!0,type:mt(Oe),shape:j})}return Pt.set(O,[O,A,L,null,D,!1]),[O,Y,C,F,Ve]}catch(q){throw A.forEach(P=>S._OrtFree(P)),L.forEach(P=>S._OrtFree(P)),O!==0&&S._OrtReleaseSession(O)!==0&&ae("Can't release session."),q}finally{S._free(b),z!==0&&S._OrtReleaseSessionOptions(z)!==0&&ae("Can't release session options."),E.forEach(q=>S._free(q)),S.unmountExternalData?.()}},Zr=c=>{let m=de(),b=Pt.get(c);if(!b)throw new Error(`cannot release session. invalid session id: ${c}`);let[T,S,O,z,E]=b;z&&(E&&m._OrtClearBoundOutputs(z.handle)!==0&&ae("Can't clear bound outputs."),m._OrtReleaseBinding(z.handle)!==0&&ae("Can't release IO binding.")),m.jsepOnReleaseSession?.(c),m.webnnOnReleaseSession?.(c),m.webgpuOnReleaseSession?.(c),S.forEach(A=>m._OrtFree(A)),O.forEach(A=>m._OrtFree(A)),m._OrtReleaseSession(T)!==0&&ae("Can't release session."),Pt.delete(c)},Ut=async(c,m,b,T,S,O,z=!1)=>{if(!c){m.push(0);return}let E=de(),A=E.PTR_SIZE,L=c[0],q=c[1],P=c[3],D=P,Y,C;if(L==="string"&&(P==="gpu-buffer"||P==="ml-tensor"))throw new Error("String tensor is not supported on GPU.");if(z&&P!=="gpu-buffer")throw new Error(`External buffer must be provided for input/output index ${O} when enableGraphCapture is true.`);if(P==="gpu-buffer"){let re=c[2].gpuBuffer;C=gt(ft(L),q);{let Q=E.jsepRegisterBuffer;if(!Q)throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');Y=Q(T,O,re,C)}}else if(P==="ml-tensor"){let re=c[2].mlTensor;C=gt(ft(L),q);let Q=E.webnnRegisterMLTensor;if(!Q)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');Y=Q(T,re,ft(L),q)}else{let re=c[2];if(Array.isArray(re)){C=A*re.length,Y=E._malloc(C),b.push(Y);for(let Q=0;Q<re.length;Q++){if(typeof re[Q]!="string")throw new TypeError(`tensor data at index ${Q} is not a string`);E.setValue(Y+Q*A,je(re[Q],b),"*")}}else{let Q=E.webnnIsGraphInput,Oe=E.webnnIsGraphOutput;if(L!=="string"&&Q&&Oe){let j=E.UTF8ToString(S);if(Q(T,j)||Oe(T,j)){let Ye=ft(L);C=gt(Ye,q),D="ml-tensor";let Vt=E.webnnCreateTemporaryTensor,er=E.webnnUploadTensor;if(!Vt||!er)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');let tr=await Vt(T,Ye,q);er(tr,new Uint8Array(re.buffer,re.byteOffset,re.byteLength)),Y=tr}else C=re.byteLength,Y=E._malloc(C),b.push(Y),E.HEAPU8.set(new Uint8Array(re.buffer,re.byteOffset,C),Y)}else C=re.byteLength,Y=E._malloc(C),b.push(Y),E.HEAPU8.set(new Uint8Array(re.buffer,re.byteOffset,C),Y)}}let F=E.stackSave(),Ve=E.stackAlloc(4*q.length);try{q.forEach((Q,Oe)=>E.setValue(Ve+Oe*A,Q,A===4?"i32":"i64"));let re=E._OrtCreateTensor(ft(L),Y,C,Ve,q.length,Gr(D));re===0&&ae(`Can't create tensor for input/output. session=${T}, index=${O}.`),m.push(re)}finally{E.stackRestore(F)}},M=async(c,m,b,T,S,O)=>{let z=de(),E=z.PTR_SIZE,A=Pt.get(c);if(!A)throw new Error(`cannot run inference. invalid session id: ${c}`);let L=A[0],q=A[1],P=A[2],D=A[3],Y=A[4];A[5];let C=m.length,F=T.length,Ve=0,re=[],Q=[],Oe=[],j=[],Ye=[],Vt=z.stackSave(),er=z.stackAlloc(C*E),tr=z.stackAlloc(C*E),si=z.stackAlloc(F*E),Wi=z.stackAlloc(F*E);try{[Ve,re]=zi(O),st("wasm prepareInputOutputTensor");for(let we=0;we<C;we++)await Ut(b[we],Q,j,c,q[m[we]],m[we],Y);for(let we=0;we<F;we++)await Ut(S[we],Oe,j,c,P[T[we]],C+T[we],Y);ot("wasm prepareInputOutputTensor");for(let we=0;we<C;we++)z.setValue(er+we*E,Q[we],"*"),z.setValue(tr+we*E,q[m[we]],"*");for(let we=0;we<F;we++)z.setValue(si+we*E,Oe[we],"*"),z.setValue(Wi+we*E,P[T[we]],"*");z.jsepOnRunStart?.(L),z.webnnOnRunStart?.(L);let Fe;Fe=await z._OrtRun(L,tr,er,C,Wi,F,si,Ve),Fe!==0&&ae("failed to call OrtRun().");let _t=[],Hi=[];st("wasm ProcessOutputTensor");for(let we=0;we<F;we++){let wt=Number(z.getValue(si+we*E,"*"));if(wt===Oe[we]||Ye.includes(Oe[we])){_t.push(S[we]),wt!==Oe[we]&&z._OrtReleaseTensor(wt)!==0&&ae("Can't release tensor.");continue}let da=z.stackSave(),zt=z.stackAlloc(4*E),Br=!1,Ze,ut=0;try{z._OrtGetTensorData(wt,zt,zt+E,zt+2*E,zt+3*E)!==0&&ae(`Can't access output tensor data on index ${we}.`);let oi=E===4?"i32":"i64",Mr=Number(z.getValue(zt,oi));ut=z.getValue(zt+E,"*");let ji=z.getValue(zt+E*2,"*"),pa=Number(z.getValue(zt+E*3,oi)),Je=[];for(let qe=0;qe<pa;qe++)Je.push(Number(z.getValue(ji+qe*E,oi)));z._OrtFree(ji)!==0&&ae("Can't free memory for tensor dims.");let Ct=Je.reduce((qe,rt)=>qe*rt,1);Ze=mt(Mr);let rr=D?.outputPreferredLocations[T[we]];if(Ze==="string"){if(rr==="gpu-buffer"||rr==="ml-tensor")throw new Error("String tensor is not supported on GPU.");let qe=[];for(let rt=0;rt<Ct;rt++){let bt=z.getValue(ut+rt*E,"*"),ca=z.getValue(ut+(rt+1)*E,"*"),ha=rt===Ct-1?void 0:ca-bt;qe.push(z.UTF8ToString(bt,ha))}_t.push([Ze,Je,qe,"cpu"])}else if(rr==="gpu-buffer"&&Ct>0){let qe=z.jsepGetBuffer;if(!qe)throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');let rt=qe(ut),bt=gt(Mr,Ct);if(bt===void 0||!kr(Ze))throw new Error(`Unsupported data type: ${Ze}`);Br=!0,_t.push([Ze,Je,{gpuBuffer:rt,download:z.jsepCreateDownloader(rt,bt,Ze),dispose:()=>{z._OrtReleaseTensor(wt)!==0&&ae("Can't release tensor.")}},"gpu-buffer"])}else if(rr==="ml-tensor"&&Ct>0){let qe=z.webnnEnsureTensor,rt=z.webnnIsGraphInputOutputTypeSupported;if(!qe||!rt)throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');if(gt(Mr,Ct)===void 0||!zr(Ze))throw new Error(`Unsupported data type: ${Ze}`);if(!rt(c,Ze,!1))throw new Error(`preferredLocation "ml-tensor" for ${Ze} output is not supported by current WebNN Context.`);let bt=await qe(c,ut,Mr,Je,!1);Br=!0,_t.push([Ze,Je,{mlTensor:bt,download:z.webnnCreateMLTensorDownloader(ut,Ze),dispose:()=>{z.webnnReleaseTensorId(ut),z._OrtReleaseTensor(wt)}},"ml-tensor"])}else if(rr==="ml-tensor-cpu-output"&&Ct>0){let qe=z.webnnCreateMLTensorDownloader(ut,Ze)(),rt=_t.length;Br=!0,Hi.push((async()=>{let bt=[rt,await qe];return z.webnnReleaseTensorId(ut),z._OrtReleaseTensor(wt),bt})()),_t.push([Ze,Je,[],"cpu"])}else{let qe=new(Er(Ze))(Ct);new Uint8Array(qe.buffer,qe.byteOffset,qe.byteLength).set(z.HEAPU8.subarray(ut,ut+qe.byteLength)),_t.push([Ze,Je,qe,"cpu"])}}finally{z.stackRestore(da),Ze==="string"&&ut&&z._free(ut),Br||z._OrtReleaseTensor(wt)}}D&&!Y&&(z._OrtClearBoundOutputs(D.handle)!==0&&ae("Can't clear bound outputs."),Pt.set(c,[L,q,P,D,Y,!1]));for(let[we,wt]of await Promise.all(Hi))_t[we][2]=wt;return ot("wasm ProcessOutputTensor"),_t}finally{z.webnnOnRunEnd?.(L),z.stackRestore(Vt),Q.forEach(Fe=>z._OrtReleaseTensor(Fe)),Oe.forEach(Fe=>z._OrtReleaseTensor(Fe)),j.forEach(Fe=>z._free(Fe)),Ve!==0&&z._OrtReleaseRunOptions(Ve),re.forEach(Fe=>z._free(Fe))}},Qt=c=>{let m=de(),b=Pt.get(c);if(!b)throw new Error("invalid session id");let T=b[0],S=m._OrtEndProfiling(T);S===0&&ae("Can't get an profile file name."),m._OrtFree(S)},Qr=c=>{let m=[];for(let b of c){let T=b[2];!Array.isArray(T)&&"buffer"in T&&m.push(T.buffer)}return m}}),It,ne,Nt,Xt,jt,Yt,Ar,Or,kt,Lt,Xr,Yr,Jr,Ui,Ni,ua,Jt,Li,Vi=k(()=>{"use strict";Xe(),Pi(),ht(),$r(),It=()=>!!te.wasm.proxy&&typeof document<"u",Nt=!1,Xt=!1,jt=!1,Or=new Map,kt=(c,m)=>{let b=Or.get(c);b?b.push(m):Or.set(c,[m])},Lt=()=>{if(Nt||!Xt||jt||!ne)throw new Error("worker not ready")},Xr=c=>{switch(c.data.type){case"init-wasm":Nt=!1,c.data.err?(jt=!0,Ar[1](c.data.err)):(Xt=!0,Ar[0]()),Yt&&(URL.revokeObjectURL(Yt),Yt=void 0);break;case"init-ep":case"copy-from":case"create":case"release":case"run":case"end-profiling":{let m=Or.get(c.data.type);c.data.err?m.shift()[1](c.data.err):m.shift()[0](c.data.out);break}default:}},Yr=async()=>{if(!Xt){if(Nt)throw new Error("multiple calls to 'initWasm()' detected.");if(jt)throw new Error("previous call to 'initWasm()' failed.");if(Nt=!0,It())return new Promise((c,m)=>{ne?.terminate(),Si().then(([b,T])=>{try{ne=T,ne.onerror=O=>m(O),ne.onmessage=Xr,Ar=[c,m];let S={type:"init-wasm",in:te};if(!S.in.wasm.wasmPaths&&b){let O=yr();O&&(S.in.wasm.wasmPaths=O)}ne.postMessage(S),Yt=b}catch(S){m(S)}},m)});try{await Sr(te.wasm),await Wr(te),Xt=!0}catch(c){throw jt=!0,c}finally{Nt=!1}}},Jr=async c=>{if(It())return Lt(),new Promise((m,b)=>{kt("init-ep",[m,b]);let T={type:"init-ep",in:{epName:c,env:te}};ne.postMessage(T)});await Hr(te,c)},Ui=async c=>It()?(Lt(),new Promise((m,b)=>{kt("copy-from",[m,b]);let T={type:"copy-from",in:{buffer:c}};ne.postMessage(T,[c.buffer])})):ze(c),Ni=async(c,m)=>{if(It()){if(m?.preferredOutputLocation)throw new Error('session option "preferredOutputLocation" is not supported for proxy.');return Lt(),new Promise((b,T)=>{kt("create",[b,T]);let S={type:"create",in:{model:c,options:{...m}}},O=[];c instanceof Uint8Array&&O.push(c.buffer),ne.postMessage(S,O)})}else return yt(c,m)},ua=async c=>{if(It())return Lt(),new Promise((m,b)=>{kt("release",[m,b]);let T={type:"release",in:c};ne.postMessage(T)});Zr(c)},Jt=async(c,m,b,T,S,O)=>{if(It()){if(b.some(z=>z[3]!=="cpu"))throw new Error("input tensor on GPU is not supported for proxy.");if(S.some(z=>z))throw new Error("pre-allocated output tensor is not supported for proxy.");return Lt(),new Promise((z,E)=>{kt("run",[z,E]);let A=b,L={type:"run",in:{sessionId:c,inputIndices:m,inputs:A,outputIndices:T,options:O}};ne.postMessage(L,Qr(A))})}else return M(c,m,b,T,S,O)},Li=async c=>{if(It())return Lt(),new Promise((m,b)=>{kt("end-profiling",[m,b]);let T={type:"end-profiling",in:c};ne.postMessage(T)});Qt(c)}}),qi,ei,ti,ri=k(()=>{"use strict";Xe(),Vi(),ue(),fr(),Mi(),qi=(c,m)=>{switch(c.location){case"cpu":return[c.type,c.dims,c.data,"cpu"];case"gpu-buffer":return[c.type,c.dims,{gpuBuffer:c.gpuBuffer},"gpu-buffer"];case"ml-tensor":return[c.type,c.dims,{mlTensor:c.mlTensor},"ml-tensor"];default:throw new Error(`invalid data location: ${c.location} for ${m()}`)}},ei=c=>{switch(c[3]){case"cpu":return new He(c[0],c[2],c[1]);case"gpu-buffer":{let m=c[0];if(!kr(m))throw new Error(`not supported data type: ${m} for deserializing GPU tensor`);let{gpuBuffer:b,download:T,dispose:S}=c[2];return He.fromGpuBuffer(b,{dataType:m,dims:c[1],download:T,dispose:S})}case"ml-tensor":{let m=c[0];if(!zr(m))throw new Error(`not supported data type: ${m} for deserializing MLTensor tensor`);let{mlTensor:b,download:T,dispose:S}=c[2];return He.fromMLTensor(b,{dataType:m,dims:c[1],download:T,dispose:S})}default:throw new Error(`invalid data location: ${c[3]}`)}},ti=class{async fetchModelAndCopyToWasmMemory(c){return Ui(await Cr(c))}async loadModel(c,m){et();let b;typeof c=="string"?b=await this.fetchModelAndCopyToWasmMemory(c):b=c,[this.sessionId,this.inputNames,this.outputNames,this.inputMetadata,this.outputMetadata]=await Ni(b,m),Qe()}async dispose(){return ua(this.sessionId)}async run(c,m,b){et();let T=[],S=[];Object.entries(c).forEach(P=>{let D=P[0],Y=P[1],C=this.inputNames.indexOf(D);if(C===-1)throw new Error(`invalid input '${D}'`);T.push(Y),S.push(C)});let O=[],z=[];Object.entries(m).forEach(P=>{let D=P[0],Y=P[1],C=this.outputNames.indexOf(D);if(C===-1)throw new Error(`invalid output '${D}'`);O.push(Y),z.push(C)});let E=T.map((P,D)=>qi(P,()=>`input "${this.inputNames[S[D]]}"`)),A=O.map((P,D)=>P?qi(P,()=>`output "${this.outputNames[z[D]]}"`):null),L=await Jt(this.sessionId,S,E,z,A,b),q={};for(let P=0;P<L.length;P++)q[this.outputNames[z[P]]]=O[P]??ei(L[P]);return Qe(),q}startProfiling(){}endProfiling(){Li(this.sessionId)}}}),Rr={};ie(Rr,{OnnxruntimeWebAssemblyBackend:()=>ai,initializeFlags:()=>ii,wasmBackend:()=>ni});var ii,ai,ni,Fi=k(()=>{"use strict";Xe(),Vi(),ri(),ii=()=>{(typeof te.wasm.initTimeout!="number"||te.wasm.initTimeout<0)&&(te.wasm.initTimeout=0);let c=te.wasm.simd;if(typeof c!="boolean"&&c!==void 0&&c!=="fixed"&&c!=="relaxed"&&(console.warn(`Property "env.wasm.simd" is set to unknown value "${c}". Reset it to \`false\` and ignore SIMD feature checking.`),te.wasm.simd=!1),typeof te.wasm.proxy!="boolean"&&(te.wasm.proxy=!1),typeof te.wasm.trace!="boolean"&&(te.wasm.trace=!1),typeof te.wasm.numThreads!="number"||!Number.isInteger(te.wasm.numThreads)||te.wasm.numThreads<=0)if(typeof self<"u"&&!self.crossOriginIsolated)te.wasm.numThreads=1;else{let m=typeof navigator>"u"?K("node:os").cpus().length:navigator.hardwareConcurrency;te.wasm.numThreads=Math.min(4,Math.ceil((m||1)/2))}},ai=class{async init(c){ii(),await Yr(),await Jr(c)}async createInferenceSessionHandler(c,m){let b=new ti;return await b.loadModel(c,m),b}},ni=new ai}),Gi={};ie(Gi,{InferenceSession:()=>hr,TRACE:()=>Dt,TRACE_EVENT_BEGIN:()=>st,TRACE_EVENT_END:()=>ot,TRACE_FUNC_BEGIN:()=>et,TRACE_FUNC_END:()=>Qe,Tensor:()=>He,default:()=>Na,env:()=>te,registerBackend:()=>le}),Xe(),Xe(),Xe();var la="1.24.1",Na=gi;{let c=(Fi(),pe(Rr)).wasmBackend;le("cpu",c,10),le("wasm",c,10)}return Object.defineProperty(te.versions,"web",{value:la,enumerable:!0}),pe(Gi)})();typeof U=="object"&&typeof Te=="object"&&(Te.exports=ge)})),Lc=lt((U=>{var Te=U&&U.__createBinding||(Object.create?(function(Ae,Ee,ye,oe){oe===void 0&&(oe=ye);var Ge=Object.getOwnPropertyDescriptor(Ee,ye);(!Ge||("get"in Ge?!Ee.__esModule:Ge.writable||Ge.configurable))&&(Ge={enumerable:!0,get:function(){return Ee[ye]}}),Object.defineProperty(Ae,oe,Ge)}):(function(Ae,Ee,ye,oe){oe===void 0&&(oe=ye),Ae[oe]=Ee[ye]})),ge=U&&U.__setModuleDefault||(Object.create?(function(Ae,Ee){Object.defineProperty(Ae,"default",{enumerable:!0,value:Ee})}):function(Ae,Ee){Ae.default=Ee}),Ce=U&&U.__importStar||function(Ae){if(Ae&&Ae.__esModule)return Ae;var Ee={};if(Ae!=null)for(var ye in Ae)ye!=="default"&&Object.prototype.hasOwnProperty.call(Ae,ye)&&Te(Ee,Ae,ye);return ge(Ee,Ae),Ee};Object.defineProperty(U,"__esModule",{value:!0}),U.MicVAD=U.getDefaultRealTimeVADOptions=U.ort=U.DEFAULT_MODEL=void 0;var Ie=Ce(Nc()),be=Fn(),$e=Gn(),K=oa(),k=Ia(),ie=Cp(),xe=Ap();U.DEFAULT_MODEL="legacy",U.ort=Ie;var pe="vad.worklet.bundle.min.js",X="silero_vad_v5.onnx",ee="silero_vad_legacy.onnx",le=Ae=>({...$e.defaultFrameProcessorOptions,onFrameProcessed:()=>{},onVADMisfire:()=>{K.log.debug("VAD misfire")},onSpeechStart:()=>{K.log.debug("Detected speech start")},onSpeechEnd:()=>{K.log.debug("Detected speech end")},onSpeechRealStart:()=>{K.log.debug("Detected real speech start")},baseAssetPath:"./",onnxWASMBasePath:"./",model:Ae,workletOptions:{},getStream:async()=>await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:!0,autoGainControl:!0,noiseSuppression:!0}}),pauseStream:async Ee=>{Ee.getTracks().forEach(ye=>{ye.stop()})},resumeStream:async()=>await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:!0,autoGainControl:!0,noiseSuppression:!0}}),ortConfig:Ee=>{Ee.env.logLevel="error"},startOnLoad:!0,processorType:"auto"});U.getDefaultRealTimeVADOptions=le;var ke=Ae=>"audioWorklet"in Ae&&typeof AudioWorkletNode=="function"?"AudioWorklet":"ScriptProcessor";async function he(Ae,Ee,ye,oe,Ge){await ye.audioWorklet.addModule(Ae),Ee.processorOptions={...Ee.processorOptions??{},frameSamples:oe};const te=new AudioWorkletNode(ye,"vad-helper-worklet",Ee);return te.port.onmessage=async dt=>{const We=dt.data;if(!(typeof We=="object"&&We&&"message"in We)){console.error("Invalid message event",We);return}switch(We.message){case k.Message.AudioFrame:if(!("data"in We&&We.data instanceof ArrayBuffer)){console.log("Audio frame message has no data");return}await Ge(new Float32Array(We.data));break}},te}async function Le(Ae,Ee,ye){const oe=new xe.Resampler({nativeSampleRate:Ae.sampleRate,targetSampleRate:16e3,targetFrameSize:Ee});K.log.debug("using script processor");const Ge=Ae.createScriptProcessor(4096,1,1);let te=!1;return Ge.onaudioprocess=async dt=>{if(!te){te=!0;try{const We=dt.inputBuffer.getChannelData(0);dt.outputBuffer.getChannelData(0).fill(0);const xt=oe.process(We);for(const Mt of xt)await ye(Mt)}catch(We){console.error("Error processing audio:",We)}finally{te=!1}}},Ge.connect(Ae.destination),Ge}var at=class Rp{constructor(Ee,ye,oe,Ge,te=!1,dt=null,We=null,xt=null,Mt=null,nt=null,or=null,ur="uninitialized",lr=!1){this.options=Ee,this.frameProcessor=ye,this.model=oe,this.frameSamples=Ge,this.listening=te,this.errored=dt,this._stream=We,this._audioContext=xt,this._vadNode=Mt,this._mediaStreamAudioSourceNode=nt,this._audioProcessorAdapterType=or,this.initializationState=ur,this.ownsAudioContext=lr,this.getAudioInstances=()=>{if(this._stream===null||this._audioContext===null||this._vadNode==null||this._mediaStreamAudioSourceNode==null)throw new Error("MicVAD has null stream, audio context, or processor adapter");return{stream:this._stream,audioContext:this._audioContext,vadNode:this._vadNode,mediaStreamAudioSourceNode:this._mediaStreamAudioSourceNode}},this.setErrored=Pe=>{this.initializationState="errored",this.errored=Pe},this.start=async()=>{switch(this.initializationState){case"uninitialized":K.log.debug("initializing micVAD"),this.initializationState="initializing",this.frameProcessor.resume();try{this._stream=await this.options.getStream()}catch(Pe){throw Pe instanceof Error?this.setErrored(Pe.message):this.setErrored(String(Pe)),Pe}if(this.options.audioContext?(console.log("using custom audio context"),this._audioContext=this.options.audioContext):(console.log("using default audio context"),this._audioContext=new AudioContext,this.ownsAudioContext=!0),!this._audioContext)throw this.setErrored("Audio context is null"),Error("Audio context is null");switch(this._audioProcessorAdapterType=this.options.processorType=="auto"?ke(this._audioContext):this.options.processorType,this._audioProcessorAdapterType){case"AudioWorklet":this._vadNode=await he(this.options.baseAssetPath+pe,this.options.workletOptions,this._audioContext,this.frameSamples,this.processFrame);break;case"ScriptProcessor":this._vadNode=await Le(this._audioContext,this.frameSamples,this.processFrame);break;default:throw new Error(`Unsupported audio processor adapter type: ${this._audioProcessorAdapterType}`)}this._mediaStreamAudioSourceNode=new MediaStreamAudioSourceNode(this._audioContext,{mediaStream:this._stream}),this._mediaStreamAudioSourceNode.connect(this._vadNode),K.log.debug("started micVAD"),this.listening=!0,this.initializationState="initialized";break;case"initializing":K.log.warn("start called while initializing");break;case"initialized":{if(this.listening)return;this.listening=!0,this.frameProcessor.resume();const{stream:Pe,audioContext:Ft,vadNode:li}=this.getAudioInstances();this._stream=await this.options.resumeStream(Pe);const tt=new MediaStreamAudioSourceNode(Ft,{mediaStream:this._stream});this._mediaStreamAudioSourceNode=tt,tt.connect(li);break}case"destroyed":K.log.warn("start called after destroyed");break;case"errored":K.log.error("start called after errored");break;default:K.log.warn("weird initialization state");break}},this.pause=async()=>{if(!this.listening)return;this.listening=!1;const{stream:Pe,mediaStreamAudioSourceNode:Ft}=this.getAudioInstances();await this.options.pauseStream(Pe),Ft.disconnect(),this.frameProcessor.pause(this.handleFrameProcessorEvent)},this.destroy=async()=>{K.log.debug("destroy called"),this.initializationState="destroyed";const{vadNode:Pe}=this.getAudioInstances();Pe instanceof AudioWorkletNode&&Pe.port.postMessage(k.Message.SpeechStop),this.listening&&await this.pause(),await this.model.release(),this.ownsAudioContext&&await this._audioContext?.close()},this.setOptions=Pe=>{this.frameProcessor.setOptions(Pe)},this.processFrame=async Pe=>{await this.frameProcessor.process(Pe,this.handleFrameProcessorEvent)},this.handleFrameProcessorEvent=Pe=>{switch(Pe.msg){case k.Message.FrameProcessed:this.options.onFrameProcessed(Pe.probs,Pe.frame);break;case k.Message.SpeechStart:this.options.onSpeechStart();break;case k.Message.SpeechRealStart:this.options.onSpeechRealStart();break;case k.Message.VADMisfire:this.options.onVADMisfire();break;case k.Message.SpeechEnd:this.options.onSpeechEnd(Pe.audio);break}}}static async new(Ee={}){const ye={...(0,U.getDefaultRealTimeVADOptions)(Ee.model??U.DEFAULT_MODEL),...Ee};(0,$e.validateOptions)(ye),U.ort.env.wasm.wasmPaths=ye.onnxWASMBasePath,ye.ortConfig!==void 0&&ye.ortConfig(U.ort);const oe=ye.model==="v5"?X:ee,Ge=ye.baseAssetPath+oe,te=ye.model==="v5"?ie.SileroV5.new:ie.SileroLegacy.new;let dt;try{dt=await te(U.ort,()=>(0,be.defaultModelFetcher)(Ge))}catch(nt){throw console.error(`Encountered an error while loading model file ${Ge}`),nt}const We=ye.model==="v5"?512:1536,xt=We/16,Mt=new Rp(ye,new $e.FrameProcessor(dt.process,dt.reset_state,{positiveSpeechThreshold:ye.positiveSpeechThreshold,negativeSpeechThreshold:ye.negativeSpeechThreshold,redemptionMs:ye.redemptionMs,preSpeechPadMs:ye.preSpeechPadMs,minSpeechMs:ye.minSpeechMs,submitUserSpeechOnPause:ye.submitUserSpeechOnPause},xt),dt,We);if(ye.startOnLoad)try{await Mt.start()}catch(nt){throw console.error("Error starting micVad",nt),nt}return Mt}};U.MicVAD=at})),Vc=lt((U=>{Object.defineProperty(U,"__esModule",{value:!0}),U.getDefaultRealTimeVADOptions=U.MicVAD=U.DEFAULT_MODEL=U.utils=U.NonRealTimeVAD=U.Message=U.FrameProcessor=U.defaultModelFetcher=U.baseAssetPath=void 0;var Te=Ip();Object.defineProperty(U,"baseAssetPath",{enumerable:!0,get:function(){return Te.baseAssetPath}});var ge=Fn();Object.defineProperty(U,"defaultModelFetcher",{enumerable:!0,get:function(){return ge.defaultModelFetcher}});var Ce=Gn();Object.defineProperty(U,"FrameProcessor",{enumerable:!0,get:function(){return Ce.FrameProcessor}});var Ie=Ia();Object.defineProperty(U,"Message",{enumerable:!0,get:function(){return Ie.Message}});var be=Pc();Object.defineProperty(U,"NonRealTimeVAD",{enumerable:!0,get:function(){return be.NonRealTimeVAD}});var $e=Uc();U.utils={audioFileToArray:$e.audioFileToArray,minFramesForTargetMS:$e.minFramesForTargetMS,arrayBufferToBase64:$e.arrayBufferToBase64,encodeWAV:$e.encodeWAV};var K=Lc();Object.defineProperty(U,"DEFAULT_MODEL",{enumerable:!0,get:function(){return K.DEFAULT_MODEL}}),Object.defineProperty(U,"MicVAD",{enumerable:!0,get:function(){return K.MicVAD}}),Object.defineProperty(U,"getDefaultRealTimeVADOptions",{enumerable:!0,get:function(){return K.getDefaultRealTimeVADOptions}})})),qc=Vc();async function Hc(U,Te){if(typeof window>"u")throw new Error("not in browser");if(!navigator.mediaDevices?.getUserMedia)throw new Error("getUserMedia unavailable");const ge=await qc.MicVAD.new({model:"v5",baseAssetPath:"/",onnxWASMBasePath:"/vad-runtime/",positiveSpeechThreshold:.6,negativeSpeechThreshold:.35,minSpeechFrames:4,redemptionFrames:8,onSpeechEnd:async Ce=>{try{const Ie=Ac(Ce);if(Ie.size<5e3)return;const be=(await Oc(U,Ie)).trim();be.length>1&&Te.onFinal(be)}catch{}},onVADMisfire:()=>{}});return await ge.start(),{stop(){try{ge.pause()}catch{}try{ge.destroy()}catch{}}}}export{Hc as startWhisperCapture};
