import { getRequestHeaders } from '../../../../script.js';

// All DOM IDs are private to ProxyDock; no user-controlled HTML is interpolated.
const API = '/api/plugins/proxy-dock';
let token = '';
let status = null;
let groups = [];
const $ = selector => document.querySelector(selector);
const el = (tag, text, className='') => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; };

function notify(message, kind='info') {
    const n=$('#pd-message');if(!n)return;
    n.textContent=String(message);n.dataset.kind=kind;
}
async function api(route, payload=null) {
    const method=payload===null?'GET':'POST';
    const response=await fetch(API+route, {method,cache:'no-store',credentials:'same-origin',
        headers:{...getRequestHeaders(), 'X-ProxyDock-Token':token}, ...(payload===null?{}:{body:JSON.stringify(payload)})});
    const raw=await response.text();
    let data={};try{data=raw?JSON.parse(raw):{};}catch{throw new Error('服务端不是 JSON 响应；请确认后端插件已启用');}
    if(!response.ok)throw new Error(data.error||('HTTP '+response.status));
    return data;
}
async function exec(fn, success='') { try {await fn();if(success)notify(success,'ok');}catch(e){notify(e.message||String(e),'error');} }
function setStatus(data) {status=data;render();}
async function refresh() {setStatus(await api('/status'));}
function render() {
    $('#pd-locked').hidden=true;$('#pd-body').hidden=false;
    $('#pd-state').textContent=status.enabled?'运行中 · 酒馆服务器代理已启用':'已关闭 · 恢复原有网络设置';
    $('#pd-state').classList.toggle('pd-on',status.enabled);
    $('#pd-enable').checked=status.enabled;
    const dropdown=$('#pd-profiles');dropdown.replaceChildren();
    if(!status.profiles.length){dropdown.add(new Option('请先添加代理配置',''));}
    for(const p of status.profiles){const opt=new Option(p.name+' — '+p.url,p.id);dropdown.add(opt);}
    dropdown.value=status.activeId||'';
    $('#pd-delete').disabled=!status.activeId;
    $('#pd-test').disabled=!status.activeId;
    $('#pd-enable').disabled=!status.profiles.length;
    $('#pd-bypass').value=status.bypass.join(', ');
    $('#pd-controller-port').value=status.controller.port;
    $('#pd-has-secret').textContent=status.controller.hasSecret?'已保存控制器密钥':'未保存控制器密钥（无密钥时留空）';
}
function fillGroups() {
    const names=$('#pd-groups');names.replaceChildren();
    if(!groups.length){names.add(new Option('未找到节点分组',''));}
    for(const item of groups){names.add(new Option(item.name+(item.now?' → '+item.now:''),item.name));}
    fillNodes();
}
function fillNodes() {
    const group=groups.find(x=>x.name===$('#pd-groups').value);
    const nodes=$('#pd-nodes');nodes.replaceChildren();
    if(!group){nodes.add(new Option('无节点',''));return;}
    for(const name of group.all){nodes.add(new Option(name,name));}
    if(group.now && group.all.includes(group.now)) nodes.value=group.now;
}
async function syncGroups() {
    const data=await api('/controller/groups');groups=data.groups||[];fillGroups();
    notify('已读取 '+groups.length+' 个代理分组','ok');
}
function openPanel(){$('#pd-overlay').hidden=false;}
function closePanel(){$('#pd-overlay').hidden=true;}
function init() {
    if($('#pd-overlay'))return;
    const markup=`
    <button id="pd-launch" type="button" title="打开酒馆代理管理器">🌐 <span>代理</span></button>
    <div id="pd-overlay" hidden><div id="pd-shade"></div>
    <section id="pd-window" role="dialog" aria-modal="true" aria-label="ProxyDock 代理管理器">
      <header><div><div class="pd-title">🌐 ProxyDock</div><div class="pd-subtitle">SillyTavern 网络代理管理器</div></div><button id="pd-close" type="button" title="关闭">×</button></header>
      <div class="pd-scroll">
        <div id="pd-message" role="status">请输入管理员令牌以连接服务端</div>
        <div id="pd-locked" class="pd-section"><label>管理员令牌（见服务端插件目录下 auth-token.txt）
          <input id="pd-token" type="password" autocomplete="off" placeholder="粘贴 64 位管理员令牌"/></label>
          <button id="pd-connect" type="button" class="pd-primary">连接插件</button>
          <p class="pd-help">这是服务器级代理管理，管理员令牌不要分享给其他用户；令牌只存于本页内存，刷新页面后需重新输入。</p>
        </div>
        <div id="pd-body" hidden>
          <div class="pd-section"><div class="pd-line"><h3>代理状态</h3><label class="pd-toggle"><input type="checkbox" id="pd-enable"><span>启用</span></label></div>
            <div id="pd-state" class="pd-state">尚未连接</div>
            <label>代理配置<select id="pd-profiles"></select></label>
            <div class="pd-actions"><button id="pd-test" type="button">测试代理 / 出口 IP</button><button id="pd-delete" type="button" class="pd-danger">删除此配置</button><button id="pd-refresh" type="button">刷新</button></div>
          </div>
          <div class="pd-section"><h3>添加代理</h3>
            <label>配置名称<input id="pd-new-name" maxlength="60" placeholder="例如：Clash Verge · 本机" /></label>
            <label>代理地址<input id="pd-new-url" autocomplete="off" placeholder="http://127.0.0.1:7890" /></label>
            <button id="pd-add" type="button" class="pd-primary">添加配置</button>
            <p class="pd-help">支持 http://、https://、socks5:// 等；这里填的是代理入口地址，不是订阅链接。若运行在 Docker 内，请使用容器能访问的代理地址。</p>
          </div>
          <div class="pd-section"><h3>直连 / 绕过代理的地址</h3>
            <label>主机列表（英文逗号分隔）<input id="pd-bypass" placeholder="localhost, 127.0.0.1, ::1" /></label>
            <button id="pd-save-bypass" type="button">保存绕过列表</button>
          </div>
          <div class="pd-section"><h3>Clash / Mihomo 节点管理（可选）</h3>
            <p class="pd-help">连接运行在<strong>酒馆服务器本机</strong>的 Mihomo External Controller，只连接 127.0.0.1。Clash Verge 的 API 控制器端口与混合代理端口不同。</p>
            <div class="pd-line pd-input-line"><label>控制端口<input id="pd-controller-port" type="number" min="1" max="65535" value="9097"/></label><label>控制密钥<input id="pd-controller-secret" type="password" autocomplete="off" placeholder="不修改则留空"/></label></div>
            <div id="pd-has-secret" class="pd-help"></div>
            <label class="pd-inline"><input id="pd-clear-secret" type="checkbox"/>清除已有密钥</label>
            <div class="pd-actions"><button id="pd-save-controller" type="button">保存控制器设置</button><button id="pd-load-groups" type="button">读取节点列表</button></div>
            <label>代理分组<select id="pd-groups"></select></label>
            <label>节点<select id="pd-nodes"></select></label>
            <div class="pd-actions"><button id="pd-switch-node" type="button" class="pd-primary">切换节点</button><button id="pd-node-delay" type="button">测试节点延迟</button></div>
          </div>
          <p class="pd-foot">作用于酒馆的 Node.js 出站 HTTP/HTTPS 全局代理及部分遵守代理环境变量的库；不会代理浏览器、操作系统全局流量，某些 fetch / 独立代理客户端不受影响。切换前请先完成正在进行的生成请求。</p>
        </div>
      </div>
    </section></div>`;
    const host=document.createElement('div');host.id='pd-root';host.innerHTML=markup;document.body.append(host);
    // Add normal extension menu entry as well as a quick floating entry.
    const sidebar=document.querySelector('#extensions_settings');
    if(sidebar){const settings=el('div',undefined,'pd-settings-entry');const b=el('button','🌐 ProxyDock · 网络代理','menu_button');b.type='button';b.addEventListener('click',openPanel);settings.append(b);sidebar.append(settings);}
    $('#pd-launch').addEventListener('click',openPanel);
    $('#pd-close').addEventListener('click',closePanel);
    $('#pd-shade').addEventListener('click',closePanel);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#pd-overlay').hidden)closePanel();});
    $('#pd-connect').addEventListener('click',()=>exec(async()=>{
        token=$('#pd-token').value.trim();if(!token)throw new Error('请输入管理员令牌');
        await refresh();$('#pd-token').value='';notify('管理器已连接','ok');
    }));
    $('#pd-refresh').addEventListener('click',()=>exec(refresh,'已更新'));
    $('#pd-enable').addEventListener('change',()=>exec(async()=>setStatus(await api('/activate',{id:$('#pd-profiles').value,enabled:$('#pd-enable').checked})),'代理状态已更新'));
    $('#pd-profiles').addEventListener('change',()=>exec(async()=>setStatus(await api('/activate',{id:$('#pd-profiles').value,enabled:status.enabled})),'已切换配置'));
    $('#pd-add').addEventListener('click',()=>exec(async()=>{
        const name=$('#pd-new-name').value.trim(),url=$('#pd-new-url').value.trim();
        setStatus(await api('/profiles',{name,url}));$('#pd-new-name').value='';$('#pd-new-url').value='';
    },'代理配置已添加'));
    $('#pd-delete').addEventListener('click',()=>exec(async()=>{
        if(!window.confirm('删除所选代理配置？'))return;
        setStatus(await api('/profiles/delete',{id:$('#pd-profiles').value}));
    },'删除操作完成'));
    $('#pd-test').addEventListener('click',()=>exec(async()=>{
        notify('正在通过所选代理测试连接…');
        const r=await api('/test',{id:$('#pd-profiles').value});
        notify('代理连通！出口 IP：'+r.ip+'；响应：'+r.ms+' ms','ok');
    }));
    $('#pd-save-bypass').addEventListener('click',()=>exec(async()=>{
        const bypass=$('#pd-bypass').value.split(',').map(x=>x.trim()).filter(Boolean);
        setStatus(await api('/bypass',{bypass}));
    },'绕过列表已保存'));
    $('#pd-save-controller').addEventListener('click',()=>exec(async()=>{
        const secret=$('#pd-controller-secret').value;
        const body={port:Number($('#pd-controller-port').value),clearSecret:$('#pd-clear-secret').checked};
        if(secret)body.secret=secret;
        setStatus(await api('/controller/settings',body));
        $('#pd-controller-secret').value='';$('#pd-clear-secret').checked=false;
    },'控制器设置已保存'));
    $('#pd-load-groups').addEventListener('click',()=>exec(syncGroups));
    $('#pd-groups').addEventListener('change',fillNodes);
    $('#pd-switch-node').addEventListener('click',()=>exec(async()=>{
        await api('/controller/select',{group:$('#pd-groups').value,name:$('#pd-nodes').value});
        await syncGroups();
    },'节点已切换（由 Mihomo 核心执行）'));
    $('#pd-node-delay').addEventListener('click',()=>exec(async()=>{
        const result=await api('/controller/delay',{name:$('#pd-nodes').value});
        notify('节点延迟：'+(result.delay===undefined?'未知':result.delay+' ms'),'ok');
    }));
    api('/health').then(()=>notify('代理后端已运行，请输入管理员令牌')).catch(()=>notify('无法连接服务端：检查 enableServerPlugins: true，并重启 SillyTavern','error'));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
