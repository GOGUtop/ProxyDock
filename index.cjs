'use strict';
/** ProxyDock Plus v2.0.1. Runs INSIDE the SillyTavern Node.js process. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const core = require('./core-manager.cjs');

const HOME = __dirname;
const STATE_FILE = path.join(HOME, 'state.json');
const TOKEN_FILE = path.join(HOME, 'auth-token.txt');
const ENDPOINT = 'https://api.ipify.org?format=json';
const initialAgents = { http: http.globalAgent, https: https.globalAgent };
const envNames = ['all_proxy','ALL_PROXY','http_proxy','HTTP_PROXY','https_proxy','HTTPS_PROXY','no_proxy','NO_PROXY'];
const initialEnv = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
const DEFAULT = () => ({enabled:false, profiles:[], activeId:null, bypass:['localhost','127.0.0.1','::1'], controller:{port:9097,secret:''}, subscriptions:[], activeSubscriptionId:null, binary:'mihomo', managedSecret:''});
let state = DEFAULT();
let authToken = '';
let currentAgent = null;
let ProxyAgentClass = null;

function validUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('代理地址格式或长度不正确');
    const value = raw.trim();
    let u;
    try { u = new URL(value); } catch { throw new Error('代理 URL 不合法'); }
    if (!['http:','https:','socks:','socks4:','socks4a:','socks5:','socks5h:'].includes(u.protocol)) throw new Error('仅支持 HTTP(S)/SOCKS4/5 代理');
    if (!u.hostname || !u.port || Number(u.port) < 1 || Number(u.port) > 65535 || u.hash || u.search || (u.pathname && u.pathname !== '/')) throw new Error('代理 URL 应包含地址和端口，不包含路径或查询参数');
    return value;
}
function redact(raw) {
    try { const u = new URL(raw); if (u.username) u.username = '***'; if (u.password) u.password = '***'; return u.toString(); }
    catch { return '无效 URL'; }
}
function cleanBypass(value) {
    if (!Array.isArray(value) || value.length > 60) throw new Error('绕过列表不合法');
    return value.map(v => { if (typeof v !== 'string' || v.length > 128 || !/^[a-zA-Z0-9.*:[\]_-]+$/.test(v)) throw new Error('绕过列表包含不允许的字符'); return v.trim(); }).filter(Boolean);
}
function save() {
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state,null,2), { mode:0o600 });
    fs.renameSync(tmp, STATE_FILE);
}
function load() {
    try {
        const read = JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
        const cleaned = DEFAULT();
        cleaned.profiles = Array.isArray(read.profiles) ? read.profiles.slice(0,100).filter(p=>typeof p.name==='string' && typeof p.id==='string').map(p=>({id:p.id,name:p.name.slice(0,60),url:validUrl(p.url)})) : [];
        cleaned.activeId = cleaned.profiles.some(p=>p.id===read.activeId) ? read.activeId : null;
        cleaned.enabled = Boolean(read.enabled && cleaned.activeId);
        cleaned.bypass = cleanBypass(read.bypass || cleaned.bypass);
        if (Number.isInteger(read.controller?.port) && read.controller.port >=1 && read.controller.port <=65535) cleaned.controller.port=read.controller.port;
        if (typeof read.controller?.secret === 'string') cleaned.controller.secret=read.controller.secret.slice(0,512);
        cleaned.subscriptions = Array.isArray(read.subscriptions) ? read.subscriptions.slice(0,30).filter(s => typeof s.id==='string' && /^[a-f0-9-]{36}$/.test(s.id) && typeof s.name==='string' && typeof s.url==='string').map(s=>({id:s.id,name:s.name.slice(0,80),url:core.safeSubscriptionUrl(s.url),updatedAt:typeof s.updatedAt==='string'?s.updatedAt:null})) : [];
        cleaned.activeSubscriptionId=cleaned.subscriptions.some(s=>s.id===read.activeSubscriptionId)?read.activeSubscriptionId:null;
        cleaned.binary=typeof read.binary==='string'?read.binary.slice(0,300):'mihomo';
        cleaned.managedSecret=typeof read.managedSecret==='string'&&/^[a-f0-9]{64}$/.test(read.managedSecret)?read.managedSecret:crypto.randomBytes(32).toString('hex');
        state=cleaned;
    } catch (error) { if (error.code !== 'ENOENT') console.error('[ProxyDock] 配置读取失败:', error.message); }
    if (!state.managedSecret) {state.managedSecret=crypto.randomBytes(32).toString('hex');save();}
    if (fs.existsSync(TOKEN_FILE)) authToken = fs.readFileSync(TOKEN_FILE,'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(authToken)) {
        authToken = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(TOKEN_FILE,authToken+'\n',{mode:0o600,flag:'w'});
    }
}
function bypassHost(host, rules) {
    const h=host.toLowerCase().replace(/^\[|\]$/g,'');
    return rules.some(raw=>{
        const rule=raw.toLowerCase().replace(/^\[|\]$/g,'');
        if (rule==='*') return true;
        if (rule.startsWith('*.')) return h.endsWith(rule.slice(1));
        if (rule.startsWith('.')) return h===rule.slice(1) || h.endsWith(rule);
        return h === rule;
    });
}
function proxyForUrl(dest, proxy, bypass) {
    try { return bypassHost(new URL(dest).hostname,bypass) ? '' : proxy; }
    catch { return ''; }
}
function replaceEnvironment(enabled, url='') {
    // RESTORE env first so accidental stale HTTP_PROXY never overrides all_proxy.
    envNames.forEach(k=> { if (initialEnv[k] === undefined) delete process.env[k]; else process.env[k] = initialEnv[k]; });
    if (!enabled) return;
    // Matching upper/lower variants ensures proxy-from-env based clients honor it.
    for (const k of ['all_proxy','ALL_PROXY','http_proxy','HTTP_PROXY','https_proxy','HTTPS_PROXY']) process.env[k]=url;
    const no = state.bypass.join(',');
    process.env.no_proxy=no;
    process.env.NO_PROXY=no;
}
function apply() {
    if (currentAgent) { http.globalAgent=initialAgents.http; https.globalAgent=initialAgents.https; currentAgent.destroy(); currentAgent=null; }
    if (!state.enabled) { replaceEnvironment(false); return; }
    const selected=state.profiles.find(p=>p.id===state.activeId);
    if (!selected) { state.enabled=false; replaceEnvironment(false); return; }
    // Identical global-agent mechanism to the built-in ST requestProxy, but hot-switchable.
    const agent=new ProxyAgentClass({
        httpAgent:initialAgents.http,
        httpsAgent:initialAgents.https,
        getProxyForUrl: destination => proxyForUrl(destination,selected.url,state.bypass),
    });
    replaceEnvironment(true,selected.url);
    http.globalAgent=agent;
    https.globalAgent=agent;
    currentAgent=agent;
}
function visible() {
    return {enabled:state.enabled, activeId:state.activeId, profiles:state.profiles.map(p=>({id:p.id,name:p.name,url:redact(p.url)})), bypass:state.bypass, controller:{port:state.controller.port,hasSecret:!!state.controller.secret},
       core:core.status(),binary:state.binary,activeSubscriptionId:state.activeSubscriptionId,
       subscriptions:state.subscriptions.map(s=>({id:s.id,name:s.name,updatedAt:s.updatedAt,host:new URL(s.url).host})),
       scope:'Node global HTTP/HTTPS agents and env only; Undici/fetch and other independent networking paths may not be proxied'};
}
function checkToken(req,res,next) {
    const given=req.get('X-ProxyDock-Token')||'';
    const got=Buffer.from(given); const want=Buffer.from(authToken);
    if (got.length !== want.length || !crypto.timingSafeEqual(got,want)) return res.status(401).json({error:'管理员令牌无效，请查看 plugins/<仓库目录名>/auth-token.txt'});
    next();
}
function wrap(fn) {return (req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(error=>res.status(error.status||400).json({error:error.message||'请求失败'}));}
function needProfile(id) {const p=state.profiles.find(p=>p.id===id); if(!p)throw new Error('没有找到此代理配置');return p;}
function probe(proxy) {
    const agent=new ProxyAgentClass({httpAgent:initialAgents.http,httpsAgent:initialAgents.https,getProxyForUrl:()=>proxy});
    const start=Date.now();
    return new Promise((resolve,reject)=>{
        const req=https.get(ENDPOINT,{agent,timeout:9000,headers:{'User-Agent':'ProxyDock/1.0'}},res=>{
            let data='';
            if (res.statusCode!==200) { res.resume();return reject(new Error('网络检测返回 HTTP '+res.statusCode)); }
            res.setEncoding('utf8'); res.on('data',part=>{ data+=part; if(data.length>500){req.destroy(new Error('响应过大'));}});
            res.on('end',()=> { try { const ip=JSON.parse(data).ip; if(!ip)throw new Error('没有返回出口 IP'); resolve({ok:true,ip,ms:Date.now()-start}); } catch(e){reject(e);} });
        });
        req.on('timeout',()=>req.destroy(new Error('连接超时（9 秒）')));
        req.on('error',reject);
    }).finally(()=>agent.destroy());
}
function mihomo(method, route, payload=null) {
    return new Promise((resolve,reject)=>{
        const json=payload===null ? null : JSON.stringify(payload);
        const headers={'Accept':'application/json'};
        const ctrlSecret=core.status().running?state.managedSecret:state.controller.secret;
        if(ctrlSecret)headers.Authorization=`Bearer ${ctrlSecret}`;
        if(json){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(json);}
        const req=http.request({hostname:'127.0.0.1',port:core.status().running?core.LOOPBACK_API_PORT:state.controller.port,method,path:route,headers,timeout:5000,agent:initialAgents.http},res=>{
            let body=''; res.setEncoding('utf8');
            res.on('data',c=>{body+=c; if(body.length>1048576)req.destroy(new Error('控制器响应过大'));});
            res.on('end',()=> {let obj={};try{obj=body?JSON.parse(body):{};}catch{obj={message:body.slice(0,120)};}
                if(res.statusCode<200||res.statusCode>=300)return reject(new Error('Mihomo API '+res.statusCode+': '+(obj.message||'请求失败')));
                resolve(obj);});
        });
        req.on('timeout',()=>req.destroy(new Error('控制器连接超时')));
        req.on('error',err=>reject(new Error('本机 Mihomo 控制器不可用：'+err.message)));
        if(json)req.write(json);req.end();
    });
}
async function init(router) {
    // ST release already depends on proxy-agent; no extra npm install.
    const pkg=require('proxy-agent'); ProxyAgentClass=pkg.ProxyAgent;
    if (typeof ProxyAgentClass!=='function')throw new Error('proxy-agent 不可用');
    load();
    if(state.enabled)apply();
    router.use(require('express').json({limit:'16kb'}));
    router.get('/health',(_,res)=>res.json({ok:true,name:'ProxyDock',version:'2.0.1'}));
    router.use(checkToken);
    router.get('/status',wrap((_,res)=>res.json(visible())));
    router.post('/profiles',wrap((req,res)=>{
        const {name,url}=req.body||{};
        if(typeof name!=='string'||!name.trim()||name.length>60)throw new Error('名称为 1–60 字');
        if(state.profiles.length>=100)throw new Error('配置最多 100 个');
        const id=crypto.randomUUID(); state.profiles.push({id,name:name.trim(),url:validUrl(url)});
        if(!state.activeId)state.activeId=id;
        save();res.json(visible());
    }));
    router.post('/profiles/delete',wrap((req,res)=>{
        const id=req.body?.id;needProfile(id);
        state.profiles=state.profiles.filter(p=>p.id!==id);
        if(state.activeId===id){state.activeId=state.profiles[0]?.id||null; if(!state.activeId)state.enabled=false;}
        apply();save();res.json(visible());
    }));
    router.post('/activate',wrap((req,res)=>{
        const enabled=req.body?.enabled;
        if(typeof enabled!=='boolean')throw new Error('enabled 必须为布尔值');
        if(req.body?.id){needProfile(req.body.id);state.activeId=req.body.id;}
        if(enabled&&!state.activeId)throw new Error('请先添加代理配置');
        state.enabled=enabled;apply();save();res.json(visible());
    }));
    router.post('/bypass',wrap((req,res)=>{
        state.bypass=cleanBypass(req.body?.bypass);apply();save();res.json(visible());
    }));
    router.post('/test',wrap(async(req,res)=>{
        const p=needProfile(req.body?.id||state.activeId);
        const result=await probe(p.url);res.json(result);
    }));
    router.post('/controller/settings',wrap((req,res)=>{
        const port=Number(req.body?.port);
        if(!Number.isInteger(port)||port<1||port>65535)throw new Error('控制端口必须在 1–65535 之间');
        const secret=req.body?.secret;
        if(secret!==undefined&&(typeof secret!=='string'||secret.length>512))throw new Error('密钥格式不正确');
        state.controller.port=port;
        if(secret!==undefined&&secret!=='')state.controller.secret=secret;
        if(req.body?.clearSecret===true)state.controller.secret='';
        save();res.json(visible());
    }));
    router.get('/controller/groups',wrap(async(_,res)=>{
        const body=await mihomo('GET','/proxies');
        const groups=Object.entries(body.proxies||{}).filter(([,v])=>Array.isArray(v.all)).slice(0,50).map(([name,v])=>({name,now:v.now||'',type:v.type||'',all:v.all.slice(0,200)}));
        res.json({groups});
    }));
    router.post('/controller/select',wrap(async(req,res)=>{
        const {group,name}=req.body||{};
        if(typeof group!=='string'||typeof name!=='string'||!group||!name||group.length>200||name.length>200)throw new Error('节点或分组名不合法');
        // Verify user-supplied names actually exist in controller group.
        const proxyList=await mihomo('GET','/proxies');
        if(!proxyList.proxies?.[group]?.all?.includes(name))throw new Error('该分组不存在所选节点');
        await mihomo('PUT','/proxies/'+encodeURIComponent(group),{name});
        res.json({ok:true,group,name});
    }));
    router.post('/controller/delay',wrap(async(req,res)=>{
        const {name}=req.body||{};
        if(typeof name!=='string'||name.length>200||!name)throw new Error('请先选择一个节点');
        const nodes=await mihomo('GET','/proxies');
        if(!Object.hasOwn(nodes.proxies||{},name))throw new Error('节点不存在');
        const route='/proxies/'+encodeURIComponent(name)+'/delay?url='+encodeURIComponent('https://www.gstatic.com/generate_204')+'&timeout=8000';
        res.json(await mihomo('GET',route));
    }));

    // SUBSCRIPTIONS: download only over HTTPS with strict public-DNS checks.
    const subsDir=path.join(HOME,'runtime','subscriptions');
    const subFile=id=>path.join(subsDir,id+'.yaml');
    const subById=id=>{const sub=state.subscriptions.find(s=>s.id===id);if(!sub)throw new Error('订阅不存在');return sub;};
    const fetchAndStore=async (sub)=>{
        const content=await core.fetchOnce(sub.url);
        const summary=core.parseSubscription(content,state.managedSecret);
        fs.mkdirSync(subsDir,{recursive:true,mode:0o700});
        fs.writeFileSync(subFile(sub.id),content,{mode:0o600});
        sub.updatedAt=new Date().toISOString();
        save();return summary;
    };
    router.post('/subscriptions',wrap(async(req,res)=>{
        const name=req.body?.name,raw=req.body?.url;
        if(typeof name!=='string'||!name.trim()||name.length>80)throw new Error('订阅名称长度需为 1–80');
        if(state.subscriptions.length>=30)throw new Error('最多 30 个订阅');
        const url=core.safeSubscriptionUrl(raw);
        const sub={id:crypto.randomUUID(),name:name.trim(),url,updatedAt:null};
        const summary=await fetchAndStore(sub);
        state.subscriptions.push(sub);
        if(!state.activeSubscriptionId)state.activeSubscriptionId=sub.id;
        save();res.json({...visible(),summary});
    }));
    router.post('/subscriptions/refresh',wrap(async(req,res)=>{
        const sub=subById(req.body?.id);const summary=await fetchAndStore(sub);
        const needsRestart=core.status().running && sub.id===state.activeSubscriptionId;
        if(needsRestart){await core.stop();await core.writeConfig(fs.readFileSync(subFile(sub.id),'utf8'),state.managedSecret);await core.start(state.binary);}
        res.json({...visible(),summary});
    }));
    router.post('/subscriptions/select',wrap(async(req,res)=>{
        const sub=subById(req.body?.id);
        if(core.status().running){
            await core.stop();await core.writeConfig(fs.readFileSync(subFile(sub.id),'utf8'),state.managedSecret);
            await core.start(state.binary);
        }
        state.activeSubscriptionId=sub.id;save();res.json(visible());
    }));
    router.post('/subscriptions/delete',wrap((req,res)=>{
        const sub=subById(req.body?.id);
        if(core.status().running && sub.id===state.activeSubscriptionId)throw new Error('请先停止 Mihomo 再删除当前订阅');
        state.subscriptions=state.subscriptions.filter(s=>s.id!==sub.id);
        if(state.activeSubscriptionId===sub.id)state.activeSubscriptionId=state.subscriptions[0]?.id||null;
        try{fs.unlinkSync(subFile(sub.id));}catch{}
        save();res.json(visible());
    }));
    router.post('/core/binary',wrap(async(req,res)=>{
        const name=req.body?.binary;
        if(typeof name!=='string'||!name.trim()||name.length>300)throw new Error('Mihomo 路径无效');
        if(core.status().running)throw new Error('请先停止核心再更改可执行文件');
        const version=await core.checkBinary(name.trim());
        state.binary=name.trim();save();res.json({...visible(),version});
    }));
    router.post('/core/check',wrap(async(_,res)=>{
        const version=await core.checkBinary(state.binary);
        res.json({ok:true,version});
    }));
    router.post('/core/start',wrap(async(_,res)=>{
        if(!state.activeSubscriptionId)throw new Error('请先导入并选择订阅');
        const sub=subById(state.activeSubscriptionId);
        const raw=fs.readFileSync(subFile(sub.id),'utf8');
        const summary=await core.writeConfig(raw,state.managedSecret);
        await core.start(state.binary);
        const internalUrl='http://127.0.0.1:'+core.LOOPBACK_PROXY_PORT;
        if(!state.profiles.some(p=>p.id==='managed-core'))state.profiles.push({id:'managed-core',name:'内置 Mihomo（ProxyDock）',url:internalUrl});
        // Do not silently turn on proxy; user must test and explicitly enable.
        save();res.json({...visible(),summary});
    }));
    router.post('/core/stop',wrap(async(_,res)=>{
        if(state.activeId==='managed-core' && state.enabled){state.enabled=false;apply();}
        await core.stop();save();res.json(visible());
    }));
    router.post('/core/mode',wrap(async(req,res)=>{
        if(!core.status().running)throw new Error('请先启动 Mihomo');
        const mode=req.body?.mode;
        if(!['rule','global','direct'].includes(mode))throw new Error('无效的代理模式');
        await mihomo('PATCH','/configs',{mode});res.json({ok:true,mode});
    }));
    router.get('/core/config',wrap(async(_,res)=>{
        if(!core.status().running)return res.json({mode:null});
        const conf=await mihomo('GET','/configs');res.json({mode:conf.mode||null});
    }));
    console.log('[ProxyDock] 已加载 | 管理密钥文件：' + TOKEN_FILE);
}
async function exit() { state.enabled=false;apply();await core.stop(); }
module.exports={init,exit,info:{id:'proxy-dock',name:'ProxyDock',description:'SillyTavern 代理/订阅管理与本地 Mihomo 核心控制'},
  // Exposed only for automated, non-network unit tests.
  __testing:{validUrl,redact,bypassHost,proxyForUrl,cleanBypass}};
