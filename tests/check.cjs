'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
const http=require('node:http');
const https=require('node:https');
const originAgents=[http.globalAgent,https.globalAgent];
const backupEnv={all_proxy:process.env.all_proxy,ALL_PROXY:process.env.ALL_PROXY,HTTP_PROXY:process.env.HTTP_PROXY,NO_PROXY:process.env.NO_PROXY};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pd-test-'));
fs.copyFileSync(path.join(__dirname,'../index.cjs'),path.join(tmp,'index.cjs'));
const originalLoad=Module._load;
class FakeAgent {constructor(opts){this.opts=opts;this.destroyed=false;}destroy(){this.destroyed=true;}}
Module._load=function(name,parent,main){
    if(name==='express')return {json:()=>function mockedJson(){}};
    if(name==='proxy-agent')return {ProxyAgent:FakeAgent};
    return originalLoad.call(this,name,parent,main);
};
const plugin=require(path.join(tmp,'index.cjs'));
Module._load=originalLoad;
const {validUrl,redact,bypassHost,proxyForUrl,cleanBypass}=plugin.__testing;
assert.equal(validUrl('socks5://127.0.0.1:7891'),'socks5://127.0.0.1:7891');
assert.match(redact('http://alice:secret@host.local:8080'),/\*\*\*/);
assert(!redact('http://alice:secret@host.local:8080').includes('secret'));
assert.throws(()=>validUrl('file:///tmp/x'));
assert.throws(()=>validUrl('http://a.test/noport'));
assert(bypassHost('api.example.com',['*.example.com']));
assert(!bypassHost('evil-example.com',['example.com']));
assert.equal(proxyForUrl('http://localhost:8000','http://my.proxy:7890',['localhost']),'');
assert.equal(proxyForUrl('https://example.com','http://my.proxy:7890',['localhost']),'http://my.proxy:7890');
assert.deepEqual(cleanBypass(['127.0.0.1','localhost']),['127.0.0.1','localhost']);
const routes=new Map();const middleware=[];
const router={get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h),use:h=>middleware.push(h)};
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
async function call(method,route,body={},token=''){
    const req={body,get(name){return name==='X-ProxyDock-Token'?token:'';}};
    const res=response();
    if(route!=='/health'){
        let allowed=false; middleware[1](req,res,()=>{allowed=true;});
        if(!allowed)return res;
    }
    await routes.get(method+' '+route)(req,res);
    return res;
}
(async()=>{
    // mock dependencies for init which are loaded lazily
    Module._load=function(name,parent,main){
        if(name==='express')return {json:()=>function mockedJson(){}};
        if(name==='proxy-agent')return {ProxyAgent:FakeAgent};
        return originalLoad.call(this,name,parent,main);
    };
    await plugin.init(router);Module._load=originalLoad;
    assert.equal(routes.has('GET /health'),true);
    assert.equal((await call('GET','/health')).body.ok,true);
    assert.equal((await call('GET','/status')).code,401);
    const token=fs.readFileSync(path.join(tmp,'auth-token.txt'),'utf8').trim();
    let r=await call('POST','/profiles',{name:'Local Clash',url:'http://127.0.0.1:7890'},token);
    assert.equal(r.body.profiles.length,1);
    const id=r.body.profiles[0].id;
    r=await call('POST','/activate',{enabled:true,id},token);
    assert.equal(r.body.enabled,true);
    assert.equal(http.globalAgent instanceof FakeAgent,true);
    assert.equal(http.globalAgent.opts.getProxyForUrl('https://api.test'), 'http://127.0.0.1:7890');
    assert.equal(http.globalAgent.opts.getProxyForUrl('http://localhost:1234'),'');
    r=await call('POST','/activate',{enabled:false},token);
    assert.equal(r.body.enabled,false);
    assert.equal(http.globalAgent,originAgents[0]);assert.equal(https.globalAgent,originAgents[1]);
    r=await call('POST','/profiles',{name:'Unsupported',url:'ftp://a:1234'},token);
    assert.equal(r.code,400);
    await plugin.exit();
    for(const [key,val]of Object.entries(backupEnv)){if(val===undefined)delete process.env[key];else process.env[key]=val;}
    fs.rmSync(tmp,{recursive:true,force:true});
    console.log('ProxyDock tests passed: 18 checks (validation, auth, add, switch, disable, env).');
})().catch(e=>{Module._load=originalLoad;http.globalAgent=originAgents[0];https.globalAgent=originAgents[1];console.error(e);process.exitCode=1;});
