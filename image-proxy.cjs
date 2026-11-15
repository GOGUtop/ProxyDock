'use strict';
/** Catbox image relay: fixed-host HTTPS allowlist, signed URLs, MIME validation, bounded cache. */
const crypto=require('node:crypto');
const https=require('node:https');
const {publicOnlyLookup}=require('./core-manager.cjs');

const ALLOWED_HOSTS=new Set(['files.catbox.moe','litter.catbox.moe']);
const EXTENSIONS=/^\/[A-Za-z0-9_-]{1,100}\.(?:png|jpe?g|gif|webp|avif|bmp)$/i;
const MAX_IMAGE_BYTES=12*1024*1024;
const CACHE_BUDGET=32*1024*1024;
const CACHE_TTL=10*60*1000;
const SIGN_TTL=60*60*1000;
const MAX_ACTIVE=5;
const MAX_WAITERS=90;
const ALLOWED_TYPES=new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif','image/bmp']);

function imageUrl(raw){
    if(typeof raw!=='string'||raw.length>500||/\.\.|%2e|%2f|%5c|\\/i.test(raw))throw new Error('Catbox 图片链接格式不正确或过长');
    let url;try{url=new URL(raw);}catch{throw new Error('图片链接不是合法 URL');}
    if(url.protocol!=='https:'||!ALLOWED_HOSTS.has(url.hostname)||url.port||url.username||url.password||url.search||url.hash||!EXTENSIONS.test(url.pathname))
        throw new Error('仅支持 files.catbox.moe / litter.catbox.moe 上的 HTTPS 图片直链（PNG/JPG/GIF/WebP/AVIF/BMP）');
    return url.toString();
}
function mimeFromMagic(bytes){
    if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
    if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
    if(bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
    if(bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
    if(bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp'&&['avif','avis'].includes(bytes.subarray(8,12).toString('ascii')))return 'image/avif';
    if(bytes.length>=2&&bytes.subarray(0,2).toString('ascii')==='BM')return 'image/bmp';
    return null;
}
function httpError(status,message){return Object.assign(new Error(message),{status});}
function createImageProxy({secret, getSettings, getProxyUrl, ProxyAgentClass, directFetch, now=()=>Date.now()}){
    const cache=new Map();const inFlight=new Map();let cacheBytes=0,active=0;const queue=[];
    function signedValue(url,expiry){return crypto.createHmac('sha256',secret()).update(url+'\n'+expiry).digest('hex');}
    function sign(url){
        const clean=imageUrl(url);const exp=now()+SIGN_TTL;
        return {original:clean,url:'/api/plugins/proxy-dock/images/proxy?u='+encodeURIComponent(clean)+'&exp='+exp+'&sig='+signedValue(clean,exp),expiresAt:exp};
    }
    function verify(url,exp,sig){
        if(typeof exp!=='string'||!/^[0-9]{13}$/.test(exp)||typeof sig!=='string'||!/^[a-f0-9]{64}$/.test(sig))throw httpError(403,'图片签名无效');
        const t=Number(exp);if(!Number.isSafeInteger(t)||t<=now()||t>now()+SIGN_TTL+120000)throw httpError(403,'图片链接已过期，请重新打开 ProxyDock');
        const expected=Buffer.from(signedValue(url,t),'hex');
        if(!crypto.timingSafeEqual(Buffer.from(sig,'hex'),expected))throw httpError(403,'图片签名无效');
    }
    function readCache(url){
        const item=cache.get(url);if(!item)return null;
        if(item.expires<=now()){cache.delete(url);cacheBytes-=item.data.length;return null;}
        cache.delete(url);cache.set(url,item);return item;
    }
    function addCache(url,item){
        if(item.data.length>CACHE_BUDGET)return;
        const existing=cache.get(url);if(existing){cache.delete(url);cacheBytes-=existing.data.length;}
        cache.set(url,item);cacheBytes+=item.data.length;
        while(cacheBytes>CACHE_BUDGET||cache.size>100){const first=cache.keys().next().value;const entry=cache.get(first);cacheBytes-=entry.data.length;cache.delete(first);}
    }
    function nextTask(){
        while(active<MAX_ACTIVE&&queue.length){const item=queue.shift();active++;Promise.resolve().then(item.fn).then(item.resolve,item.reject).finally(()=>{active--;nextTask();});}
    }
    function limit(fn){
        if(queue.length>=MAX_WAITERS)throw httpError(429,'图片代理繁忙，请稍后重新加载图片');
        return new Promise((resolve,reject)=>{queue.push({fn,resolve,reject});nextTask();});
    }
    function download(url){
        // The destination hostname is strictly allowlisted. Direct traffic additionally
        // validates DNS resolution and never uses Node's globalAgent.
        const proxyUrl=getProxyUrl();
        if(directFetch)return directFetch(url,proxyUrl);
        const u=new URL(url);
        let agent=null;
        if(proxyUrl){
            if(typeof ProxyAgentClass()!=='function')throw httpError(503,'代理组件未初始化');
            agent=new (ProxyAgentClass())({getProxyForUrl:()=>proxyUrl});
        }
        return new Promise((resolve,reject)=>{
            let done=false;
            const fail=err=>{if(done)return;done=true;reject(err);};
            const req=https.request({hostname:u.hostname,port:443,path:u.pathname,method:'GET',
                agent:agent||false,...(!agent?{lookup:publicOnlyLookup}:{}),timeout:16000,
                headers:{'User-Agent':'ProxyDock-Image/2.1.0','Accept':'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp;q=0.8', 'Accept-Encoding':'identity'}},response=>{
                if(response.statusCode!==200){response.resume();return fail(httpError(502,'Catbox 图片请求返回 HTTP '+response.statusCode));}
                const size=Number(response.headers['content-length']);
                if(Number.isFinite(size)&&size>MAX_IMAGE_BYTES){response.resume();return fail(httpError(413,'图片大于 12 MiB 限制'));}
                const hint=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
                if(hint&&!ALLOWED_TYPES.has(hint)&&hint!=='application/octet-stream'){response.resume();return fail(httpError(415,'Catbox 返回的不是受支持的图片类型'));}
                let bytes=0;const parts=[];
                response.on('data',part=>{bytes+=part.length;if(bytes>MAX_IMAGE_BYTES){req.destroy(httpError(413,'图片大于 12 MiB 限制'));return;}parts.push(part);});
                response.on('error',fail);
                response.on('end',()=>{
                    if(done)return;
                    const data=Buffer.concat(parts);const mime=mimeFromMagic(data);
                    if(!mime){return fail(httpError(415,'图片格式校验失败（不允许 HTML/SVG）'));}
                    done=true;resolve({data,mime,expires:now()+CACHE_TTL});
                });
            });
            req.on('timeout',()=>req.destroy(httpError(504,'Catbox 图片下载超时')));
            req.on('error',fail);req.end();
        }).finally(()=>{agent?.destroy?.();});
    }
    async function getImage(url){
        const clean=imageUrl(url);const existing=readCache(clean);if(existing)return {...existing,cacheHit:true};
        if(inFlight.has(clean))return inFlight.get(clean);
        const task=limit(async()=>{
            const item=await download(clean);addCache(clean,item);return {...item,cacheHit:false};
        });
        inFlight.set(clean,task);
        try{return await task;}finally{inFlight.delete(clean);}
    }
    function stats(){return {cacheCount:cache.size,cacheBytes,maxImageBytes:MAX_IMAGE_BYTES,hosts:[...ALLOWED_HOSTS],activeRequests:active,pendingRequests:queue.length};}
    async function serve(req,res){
        try{
            if(!getSettings().enabled)throw httpError(403,'Catbox 图片代理尚未启用');
            const url=imageUrl(req.query?.u);verify(url,String(req.query?.exp||''),req.query?.sig);
            const image=await getImage(url);
            res.set({'Content-Type':image.mime,'Content-Length':String(image.data.length),
                'Cache-Control':'private, max-age=600','X-Content-Type-Options':'nosniff',
                'Content-Security-Policy':"default-src 'none'; sandbox",'X-ProxyDock-Cache':image.cacheHit?'HIT':'MISS'});
            res.status(200).end(image.data);
        }catch(error){res.status(error.status||502).json({error:error.message||'图片加载失败'});}
    }
    return {imageUrl,sign,verify,getImage,serve,stats,clearCache(){cache.clear();cacheBytes=0;}};
}
module.exports={createImageProxy,imageUrl,mimeFromMagic,MAX_IMAGE_BYTES};
