'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const originalLoad=Module._load;
Module._load=function(id,parent,main){
    if(id==='yaml')return {parse:JSON.parse,stringify:JSON.stringify};
    return originalLoad.call(this,id,parent,main);
};
const {createImageProxy,imageUrl,mimeFromMagic}=require('../image-proxy.cjs');
Module._load=originalLoad;
assert.equal(imageUrl('https://files.catbox.moe/Ab123-_4.png'),'https://files.catbox.moe/Ab123-_4.png');
for(const wrong of ['http://files.catbox.moe/test.jpg','https://catbox.moe/test.jpg','https://files.catbox.moe.evil.com/a.jpg',
    'https://127.0.0.1/a.jpg','https://files.catbox.moe/a.svg','https://files.catbox.moe/a.mp4',
    'https://files.catbox.moe/a.png?u=evil','https://files.catbox.moe:1234/a.png','https://files.catbox.moe/a.png#x',
    'https://files.catbox.moe/../../admin.png','https://files.catbox.moe@localhost/a.png']){
    assert.throws(()=>imageUrl(wrong),undefined,wrong);
}
assert.equal(mimeFromMagic(Buffer.from('89504e470d0a1a0a','hex')),'image/png');
assert.equal(mimeFromMagic(Buffer.from('<svg xmlns=','utf8')),null);
assert.equal(mimeFromMagic(Buffer.from('474946383961','hex')),'image/gif');
(async()=>{
    let clock=Date.now(),count=0,lastProxy='';const state={enabled:true};
    const valid='https://files.catbox.moe/ab123.png';
    const relay=createImageProxy({secret:()=> 'secret-one',getSettings:()=>state,getProxyUrl:()=> 'http://127.0.0.1:17890',
        ProxyAgentClass:()=>null,now:()=>clock,
        directFetch:async(url,proxy)=>{count++;lastProxy=proxy;assert.equal(url,valid);return {data:Buffer.from('89504e470d0a1a0a','hex'),mime:'image/png',expires:clock+600000};}});
    const signed=relay.sign(valid);
    assert.equal(signed.original,valid);
    const q=new URL('http://localhost'+signed.url).searchParams;
    assert.doesNotThrow(()=>relay.verify(q.get('u'),q.get('exp'),q.get('sig')));
    assert.throws(()=>relay.verify('https://files.catbox.moe/wrong.png',q.get('exp'),q.get('sig')),/签名无效/);
    assert.throws(()=>relay.verify(valid,q.get('exp'),'0'.repeat(64)),/签名无效/);
    let result=await relay.getImage(valid);assert.equal(result.mime,'image/png');assert.equal(result.cacheHit,false);
    result=await relay.getImage(valid);assert.equal(result.cacheHit,true);assert.equal(count,1);
    assert.equal(lastProxy,'http://127.0.0.1:17890');
    function makeRes(){return {statusCode:200,headers:{},status(n){this.statusCode=n;return this;},set(v){this.headers=v;return this;},end(v){this.bytes=v;return this;},json(v){this.jsonBody=v;return this;}};}
    let res=makeRes();await relay.serve({query:Object.fromEntries(q.entries())},res);
    assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/png');assert.equal(res.headers['X-ProxyDock-Cache'],'HIT');
    res=makeRes();await relay.serve({query:{u:valid,exp:q.get('exp'),sig:'f'.repeat(64)}},res);
    assert.equal(res.statusCode,403);assert.equal(count,1);
    state.enabled=false;
    res=makeRes();await relay.serve({query:Object.fromEntries(q.entries())},res);
    assert.equal(res.statusCode,403);
    state.enabled=true;clock+=3600001;
    assert.throws(()=>relay.verify(q.get('u'),q.get('exp'),q.get('sig')),/过期/);

    // Simulate an HTTPS origin response through the selected outbound HTTP proxy.
    const https=require('node:https');
    const EventEmitter=require('node:events');
    const originalRequest=https.request;
    let proxyDestroyed=false;
    class MockAgent{constructor(options){this.options=options;}destroy(){proxyDestroyed=true;}}
    https.request=function(options,callback){
        assert.equal(options.hostname,'files.catbox.moe');
        assert.equal(options.path,'/ab123.png');
        assert.equal(options.agent.options.getProxyForUrl(),'http://127.0.0.1:17890');
        const req=new EventEmitter();
        req.end=()=>process.nextTick(()=>{
            const result=new EventEmitter();result.statusCode=200;result.headers={'content-type':'image/png'};
            callback(result);result.emit('data',Buffer.from('89504e470d0a1a0a','hex'));result.emit('end');
        });
        req.destroy=error=>req.emit('error',error);
        return req;
    };
    try{
        const networkRelay=createImageProxy({secret:()=> 'secret-two',getSettings:()=>({enabled:true}),
            getProxyUrl:()=> 'http://127.0.0.1:17890',ProxyAgentClass:()=>MockAgent});
        const image=await networkRelay.getImage(valid);
        assert.equal(image.mime,'image/png');
        assert.equal(proxyDestroyed,true);
    }finally{https.request=originalRequest;}

    // Browser bridge: sign only valid Catbox images, rewrite and restore on disable.
    const nodes=[];
    class FakeNode {
        constructor(tag,props){this.tagName=tag;this.attrs={...props};this.dataset={};this.style={backgroundImage:''};this.isConnected=true;nodes.push(this);}
        getAttribute(k){return this.attrs[k]??null;}
        setAttribute(k,v){this.attrs[k]=v;}
        closest(){return null;}
    }
    const img=new FakeNode('IMG',{src:valid});
    const unrelated=new FakeNode('IMG',{src:'https://example.com/image.png'});
    const bad=new FakeNode('IMG',{src:'https://files.catbox.moe/malicious.svg'});
    const previousDoc=globalThis.document,previousObserver=globalThis.MutationObserver;
    globalThis.document={body:{},querySelectorAll(selector){
        const k=selector.match(/^\[data-(pd-orig-(?:src|srcset|href|bg))\]$/)?.[1];
        if(k){const datasetKey=k.replace(/-([a-z])/g,(_,x)=>x.toUpperCase());return nodes.filter(n=>n.dataset[datasetKey]!==undefined);}
        return nodes;
    }};
    globalThis.MutationObserver=class{observe(){}disconnect(){}};
    try{
        const {createImageBridge,isCatboxImage}=await import(pathToFileURL(path.join(__dirname,'../image-bridge.js')).href);
        assert.equal(isCatboxImage(valid),true);assert.equal(isCatboxImage('https://evil.example/a.png'),false);
        let signCalls=0;
        const bridge=createImageBridge({api:async(route,body)=>{
            assert.equal(route,'/images/sign');signCalls++;
            return {images:body.urls.map(u=>({original:u,url:'/api/plugins/proxy-dock/images/proxy?mock='+encodeURIComponent(u),expiresAt:Date.now()+900000}))};
        }});
        bridge.setEnabled(true);await bridge.scan();
        assert.match(img.getAttribute('src'),/^\/api\/plugins\/proxy-dock\/images\/proxy\?/);
        assert.equal(img.dataset.pdOrigSrc,valid);
        assert.equal(unrelated.getAttribute('src'),'https://example.com/image.png');
        assert.equal(bad.getAttribute('src'),'https://files.catbox.moe/malicious.svg');
        assert.equal(signCalls,1);
        await bridge.scan(true);
        assert.equal(signCalls,2,'force rescan must sign the original URL again');
        assert.equal(img.dataset.pdOrigSrc,valid);
        bridge.setEnabled(false);
        assert.equal(img.getAttribute('src'),valid);
        assert.equal(img.dataset.pdOrigSrc,undefined);
    }finally{globalThis.document=previousDoc;globalThis.MutationObserver=previousObserver;}
    console.log('Image bridge tests passed: SSRF allowlist, signatures, MIME, cache, endpoint, DOM rewrite/restore.');
})().catch(e=>{console.error(e);process.exitCode=1;});
