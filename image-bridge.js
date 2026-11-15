/** Front-end bridge. Only rewrites Catbox image links in this browser tab. */
const CATBOX_HOSTS=new Set(['files.catbox.moe','litter.catbox.moe']);
const IMAGE_PATH=/^\/[a-zA-Z0-9_-]{1,100}\.(?:png|jpe?g|gif|webp|avif|bmp)$/i;
export function isCatboxImage(value){
    if(typeof value!=='string')return false;
    try{const u=new URL(value);return u.protocol==='https:'&&CATBOX_HOSTS.has(u.hostname)&&!u.port&&!u.search&&!u.hash&&!u.username&&!u.password&&IMAGE_PATH.test(u.pathname);}
    catch{return false;}
}
export function createImageBridge({api,onError=()=>{}}){
    let enabled=false,observer=null,timer=null,generation=0;
    const signed=new Map();
    const PROXY_PREFIX='/api/plugins/proxy-dock/images/proxy?';
    const originals=[['src','pdOrigSrc'],['srcset','pdOrigSrcset'],['href','pdOrigHref']];
    function isProxied(v){return typeof v==='string'&&v.startsWith(PROXY_PREFIX);}
    function candidatesForSrcset(srcset){
        const urls=[];
        for(const chunk of srcset.split(',')){
            const value=chunk.trim().split(/\s+/)[0];
            if(isCatboxImage(value))urls.push(value);
        }
        return urls;
    }
    function replaceSrcset(value,links){
        return value.split(',').map(segment=>segment.replace(/^(\s*)(\S+)/,(whole,space,url)=>links.get(url)?space+links.get(url):whole)).join(',');
    }
    function restore(){
        for(const [attr,key] of originals){
            document.querySelectorAll('[data-'+key.replace(/[A-Z]/g,x=>'-'+x.toLowerCase())+']').forEach(node=>{
                node.setAttribute(attr,node.dataset[key]);delete node.dataset[key];
            });
        }
        document.querySelectorAll('[data-pd-orig-bg]').forEach(node=>{
            node.style.backgroundImage=node.dataset.pdOrigBg;delete node.dataset.pdOrigBg;
        });
    }
    function schedule(){if(!enabled||timer!==null)return;timer=setTimeout(()=>{timer=null;scan().catch(onError);},140);}
    async function scan(force=false){
        if(!enabled)return;
        if(force)signed.clear();
        const batch=[];const need=new Set();
        const remember=(url)=>{
            if(!isCatboxImage(url))return;
            const prior=signed.get(url);
            if(!prior||prior.expiresAt<Date.now()+30000)need.add(url);
        };
        const nodes=document.querySelectorAll('img[src],img[srcset],source[srcset],a[href], [style*="catbox.moe"], [data-pd-orig-bg]');
        for(const node of nodes){
            if(node.closest('#pd-root'))continue;
            for(const [attr,key] of originals){
                if(attr==='src'&&node.tagName!=='IMG')continue;
                if(attr==='srcset'&&node.tagName!=='IMG'&&node.tagName!=='SOURCE')continue;
                if(attr==='href'&&node.tagName!=='A')continue;
                const before=node.getAttribute(attr);
                if(!before)continue;
                const source=force && (isProxied(before)||before.includes(PROXY_PREFIX)) && node.dataset[key] ? node.dataset[key] : before;
                if(!source || (!force&&(isProxied(source)||source.includes(PROXY_PREFIX))))continue;
                const urls=attr==='srcset'?candidatesForSrcset(source):(isCatboxImage(source)?[source]:[]);
                if(!urls.length)continue;
                urls.forEach(remember);
                batch.push({node,attr,key,before,source,urls});
            }
            const bg=node.style?.backgroundImage;
            const bgSource=force&&bg?.includes(PROXY_PREFIX)&&node.dataset.pdOrigBg?node.dataset.pdOrigBg:bg;
            if(bgSource&&bgSource.includes('catbox.moe')&&(force||!bgSource.includes(PROXY_PREFIX))){
                const urls=[];bgSource.replace(/url\(\s*(['"]?)(https:\/\/[^'"()]+)\1\s*\)/g,(_whole,_quote,url)=>{if(isCatboxImage(url))urls.push(url);return _whole;});
                if(urls.length){urls.forEach(remember);batch.push({node,attr:'backgroundImage',key:'pdOrigBg',before:bg,source:bgSource,urls});}
            }
        }
        if(!batch.length)return;
        const current=generation;
        const requests=[...need];
        for(let i=0;i<requests.length;i+=60){
            const data=await api('/images/sign',{urls:requests.slice(i,i+60)});
            if(!enabled||generation!==current)return;
            for(const item of data.images||[])signed.set(item.original,{url:item.url,expiresAt:item.expiresAt});
        }
        if(!enabled||generation!==current)return;
        for(const item of batch){
            if(!item.node.isConnected)continue;
            const {node,attr,key,before,source,urls}=item;
            const links=new Map(urls.map(url=>[url,signed.get(url)?.url]).filter(pair=>!!pair[1]));
            if(links.size!==urls.length)continue;
            if(attr==='backgroundImage'){
                if(node.style.backgroundImage!==before)continue;
                node.dataset[key]=source;
                node.style.backgroundImage=source.replace(/url\(\s*(['"]?)(https:\/\/[^'"()]+)\1\s*\)/g,(full,_quote,url)=>links.has(url)?'url("'+links.get(url)+'")':full);
            }else{
                if(node.getAttribute(attr)!==before)continue;
                node.dataset[key]=source;
                node.setAttribute(attr,attr==='srcset'?replaceSrcset(source,links):links.get(source));
            }
        }
    }
    function setEnabled(value){
        const next=Boolean(value);
        if(next===enabled){if(enabled)schedule();return;}
        enabled=next;generation++;signed.clear();
        if(enabled){
            observer=new MutationObserver(records=>{
                if(records.some(r=>r.type==='childList'||r.type==='attributes'))schedule();
            });
            observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','style','href']});
            schedule();
        }else{
            observer?.disconnect();observer=null;
            if(timer!==null){clearTimeout(timer);timer=null;}
            restore();
        }
    }
    return {setEnabled,scan,isEnabled:()=>enabled};
}
