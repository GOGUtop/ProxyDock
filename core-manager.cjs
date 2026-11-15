'use strict';
// ProxyDock Plus: restricted, local-only Mihomo process manager.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const net = require('node:net');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawn } = require('node:child_process');
const yaml = require('yaml'); // Provided by SillyTavern 1.19's dependencies.

const STORE = path.join(__dirname, 'runtime');
const CORE_DIR = path.join(STORE, 'mihomo');
const CONFIG = path.join(CORE_DIR, 'config.yaml');
const MAX_SUB = 2 * 1024 * 1024;
const LOOPBACK_PROXY_PORT = 17890;
const LOOPBACK_API_PORT = 19097;
let child = null;
let childError = '';

function safePublicIP(ip) {
    const version = net.isIP(ip);
    if (version === 4) {
        const [a,b,c,d] = ip.split('.').map(Number);
        if ([0,10,127].includes(a) || a >= 224 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) ||
            (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
            (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
        return true;
    }
    if (version === 6) {
        const lower = ip.toLowerCase();
        if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') ||
            lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff') ||
            lower.startsWith('2001:db8:')) return false;
        if (lower.startsWith('::ffff:')) return safePublicIP(lower.substring(7));
        return true;
    }
    return false;
}
function safeSubscriptionUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('订阅 URL 无效或过长');
    let u; try {u = new URL(value);} catch {throw new Error('订阅地址不是有效 URL');}
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) throw new Error('订阅必须是标准 HTTPS 链接，不支持用户名、端口或片段');
    if (u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local') ||
        u.hostname.endsWith('.internal') || net.isIP(u.hostname)) throw new Error('订阅不允许访问内网或 IP 地址');
    if (u.hostname.length > 253) throw new Error('订阅域名无效');
    return u.toString();
}
// Node 22+ may request lookup with {all:true}; in that case the callback MUST
// receive an array of {address,family}, not the legacy single IP+family tuple.
// Validate *every* DNS answer before allowing the request to connect.
function publicOnlyLookup(host, options, cb) {
    dns.lookup(host, {all:true}, (err, addresses) => {
        if (err) return cb(err);
        if (!addresses?.length || addresses.some(a => !safePublicIP(a.address)))
            return cb(new Error('订阅 DNS 解析到了非公网地址，已拒绝'));
        if (options?.all) return cb(null, addresses);
        const first = addresses[0];
        cb(null, first.address, first.family);
    });
}
function fetchOnce(url, redirects = 0) {
    const safe = safeSubscriptionUrl(url);
    const u = new URL(safe);
    return new Promise((resolve, reject) => {
        // Validate DNS results on each redirect and also on socket lookup; prevent connecting to private DNS results.
        const request = https.request({hostname:u.hostname, port:443, path:u.pathname+u.search,
            method:'GET', timeout:15000, agent:false,
            headers:{'User-Agent':'Clash-Verge/2.0 ProxyDock/2.0',Accept:'application/yaml,text/yaml,text/plain,application/octet-stream,*/*'},
            lookup:publicOnlyLookup
        }, res => {
            if ([301,302,303,307,308].includes(res.statusCode)) {
                const target=res.headers.location;res.resume();
                if(!target || redirects>=3)return reject(new Error('订阅重定向次数过多'));
                let next;try{next=new URL(target,safe).toString();}catch{return reject(new Error('订阅重定向地址无效'));}
                return resolve(fetchOnce(next, redirects+1));
            }
            if (res.statusCode !== 200) {res.resume();return reject(new Error('订阅服务器响应 HTTP '+res.statusCode));}
            const advertised=Number(res.headers['content-length']);
            if(advertised > MAX_SUB) {res.resume();return reject(new Error('订阅配置超过 2 MiB'));}
            let chunks=[],length=0;
            res.on('data',chunk=>{length+=chunk.length;if(length>MAX_SUB){request.destroy(new Error('订阅配置超过 2 MiB'));return;}chunks.push(chunk);});
            res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error',reject);
        });
        request.on('timeout',()=>request.destroy(new Error('订阅下载超时')));
        request.on('error',reject);
        request.end();
    });
}
function parseSubscription(source,secret) {
    if (typeof source !== 'string' || source.length > MAX_SUB) throw new Error('订阅内容体积超限');
    let parsed;
    try {parsed = yaml.parse(source,{uniqueKeys:true,maxAliasCount:50});}
    catch {throw new Error('订阅不是合法 Clash/Mihomo YAML；不支持直接导入 Base64 或节点 URI 列表，请向服务商获取 Clash 配置订阅');}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('订阅不是 Clash/Mihomo YAML 对象');
    const proxies=Array.isArray(parsed.proxies)?parsed.proxies:[];
    const providers=parsed['proxy-providers'] && typeof parsed['proxy-providers']==='object' && !Array.isArray(parsed['proxy-providers'])?parsed['proxy-providers']:{};
    if(!proxies.length && !Object.keys(providers).length)throw new Error('未找到 proxies 或 proxy-providers；订阅可能不是 Clash/Mihomo 格式');
    const result=structuredClone(parsed);
    // This runs on an Internet-facing Linux server: never let remote subscriptions expose ports, controller, UI, or TUN.
    for(const key of ['port','socks-port','redir-port','tproxy-port','listeners','external-controller','external-controller-tls',
        'external-controller-unix','external-controller-pipe','external-ui','external-ui-url','external-ui-name',
        'bind-address','allow-lan','authentication','skip-auth-prefixes','tun']) delete result[key];
    result['mixed-port']=LOOPBACK_PROXY_PORT;
    result['allow-lan']=false;
    result['bind-address']='127.0.0.1';
    result['external-controller']='127.0.0.1:'+LOOPBACK_API_PORT;
    result.secret=secret;
    result.tun={enable:false};
    result.mode=['rule','global','direct'].includes(result.mode)?result.mode:'rule';
    if (result.dns && typeof result.dns==='object' && !Array.isArray(result.dns)) delete result.dns.listen;
    // Provider paths cannot escape our working directory; provider URLs remain third-party subscription-controlled.
    for (const [name,item] of Object.entries(result['proxy-providers']||{})) {
        if(!item || typeof item!=='object'||Array.isArray(item))throw new Error('订阅代理提供者格式错误');
        if(item.type==='http') item.path = './providers/'+crypto.createHash('sha256').update(name).digest('hex').slice(0,20)+'.yaml';
        else if(item.type==='file')throw new Error('暂不支持订阅使用本地文件型 proxy-provider');
    }
    if(result['rule-providers'] && typeof result['rule-providers']==='object') {
        for(const [name,item] of Object.entries(result['rule-providers'])) {
            if(item && typeof item==='object' && item.type==='http')item.path='./rules/'+crypto.createHash('sha256').update(name).digest('hex').slice(0,20)+'.yaml';
            else if(item && typeof item==='object' && item.type==='file')throw new Error('暂不支持本地文件型 rule-provider');
        }
    }
    if (!Array.isArray(result['proxy-groups']) || !result['proxy-groups'].length) {
        const names=proxies.map(p=>p?.name).filter(v=>typeof v==='string');
        result['proxy-groups']=[{name:'ProxyDock',type:'select',proxies:[...names,'DIRECT'],...(Object.keys(providers).length?{use:Object.keys(providers)}:{})}];
        result.rules=['MATCH,ProxyDock'];
    }
    if (!Array.isArray(result.rules) || !result.rules.length) {
        result.rules=['MATCH,'+result['proxy-groups'][0].name];
    }
    return {text:yaml.stringify(result),nodes:proxies.length,providers:Object.keys(providers).length,groups:result['proxy-groups'].length};
}
function binaryName(raw) {
    if (!raw) return 'mihomo';
    if(typeof raw!=='string'||raw.length>400||/[\0\n\r]/.test(raw)||raw.startsWith('-'))throw new Error('Mihomo 路径无效');
    if (raw.includes('/') && (!path.isAbsolute(raw) || path.normalize(raw)!==raw)) throw new Error('必须输入 mihomo 或绝对路径');
    return raw;
}
function runCommand(bin,args,timeout=12000) {
    return new Promise((resolve,reject)=>{
        let settled=false,stdout='',stderr='';
        let proc;
        try {proc=spawn(bin,args,{cwd:CORE_DIR,env:{...process.env,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:''},stdio:['ignore','pipe','pipe'],windowsHide:true});}
        catch(e){return reject(e);}
        const timer=setTimeout(()=>{proc.kill('SIGKILL');finish(new Error('Mihomo 命令超时'));},timeout);
        const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value);};
        proc.on('error',e=>finish(new Error('无法启动 Mihomo：'+e.message)));
        proc.stdout.on('data',c=>{stdout=(stdout+c).slice(-2000);});
        proc.stderr.on('data',c=>{stderr=(stderr+c).slice(-2000);});
        proc.on('close',code=>code===0?finish(null,(stdout+stderr).slice(-1500)):finish(new Error('Mihomo 验证失败（退出码 '+code+'），请检查订阅格式和系统运行环境')));
    });
}
function setup() {fs.mkdirSync(CORE_DIR,{recursive:true,mode:0o700});}
async function checkBinary(bin) {setup();return runCommand(binaryName(bin),['-v'],4000);}
async function writeConfig(raw,secret){setup();const config=parseSubscription(raw,secret);
    const temp=CONFIG+'.tmp';fs.writeFileSync(temp,config.text,{mode:0o600});fs.renameSync(temp,CONFIG);return config;}
async function start(bin) {
    if (child && child.exitCode===null && !child.killed)throw new Error('Mihomo 已在运行');
    setup();if(!fs.existsSync(CONFIG))throw new Error('请先导入 Clash YAML 订阅');
    const file=binaryName(bin);await runCommand(file,['-t','-d',CORE_DIR,'-f',CONFIG],20000);
    childError='';
    const cp=spawn(file,['-d',CORE_DIR,'-f',CONFIG],{cwd:CORE_DIR,env:{...process.env,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
    child=cp;
    cp.on('error',e=>{childError='核心启动失败：'+e.message;});
    cp.stdout.on('data',()=>{});cp.stderr.on('data',()=>{});
    cp.on('exit',(code)=>{if(child===cp){child=null;childError='核心已退出（'+code+'）';}});
    // Startup readiness via the process still being alive. API readiness is checked by the caller.
    await new Promise(r=>setTimeout(r,500));
    if(child!==cp || cp.exitCode!==null)throw new Error(childError||'核心启动后立即退出');
    return {running:true,pid:cp.pid};
}
async function stop(){
    if(child){
        const cp=child;child=null;
        if(cp.exitCode===null&&!cp.killed){
            await new Promise(resolve=>{
                let done=false;
                const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
                cp.once('exit',finish);
                const timer=setTimeout(()=>{if(cp.exitCode===null)cp.kill('SIGKILL');finish();},3000);
                cp.kill('SIGTERM');
            });
        }
    }
    return {running:false};
}
function status() {return {running:!!child && child.exitCode===null && !child.killed, pid:child?.pid||null,error:childError,
    proxyPort:LOOPBACK_PROXY_PORT,controllerPort:LOOPBACK_API_PORT};}
module.exports={fetchOnce,parseSubscription,safeSubscriptionUrl,safePublicIP,publicOnlyLookup,checkBinary,writeConfig,start,stop,status,CONFIG,LOOPBACK_PROXY_PORT,LOOPBACK_API_PORT};
