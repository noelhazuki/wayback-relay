const VERSION = 'description-2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'Retry-After','Cache-Control':'no-store'};
function json(data,status=200,extra={}){return Response.json({version:VERSION,...data},{status,headers:{...cors,...extra}})}
function validate(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||value.length>2000||value.includes('*'))throw Error('有効な公開ページURLを指定してください');u.hash='';return u}
async function upstream(url){for(let n=0;n<4;n++){const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(40000)});if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw Error('転送先がありません');const next=new URL(loc,url);if(next.protocol!=='https:'||next.hostname!=='web.archive.org'||!next.pathname.startsWith('/web/'))throw Error('保存ページ以外への転送は停止しました');await r.body?.cancel();url=next.href;continue}return r}throw Error('転送回数が多いため停止しました')}
export default {async fetch(request){
 if(request.method==='OPTIONS')return new Response(null,{headers:cors});
 if(request.method!=='GET')return json({error:'GETのみ利用できます'},405);
 const q=new URL(request.url);
 if(!['/api/description','/api/cdx'].includes(q.pathname))return json({message:'Wayback Finder description relay is ready.',endpoints:['/api/description','/api/cdx']});
 let target;try{target=validate(q.searchParams.get('url')||'')}catch(e){return json({error:e.message},400)}
 let archiveUrl;
 if(q.pathname==='/api/description'){
 const ts=q.searchParams.get('timestamp')||'';if(!/^\d{14}$/.test(ts))return json({error:'保存日時が不正です'},400);
 archiveUrl=`https://web.archive.org/web/${ts}id_/${target.href}`;
 }else{
 const u=new URL('https://web.archive.org/cdx/search/cdx');
 u.search=new URLSearchParams({url:target.host+target.pathname.replace(/\/$/,'')+'/*',output:'json',fl:'timestamp,original,statuscode,mimetype,digest',filter:'statuscode:200',showResumeKey:'true',limit:'1000'}).toString();
 for(const key of ['from','to']){const v=q.searchParams.get(key);if(v&&/^\d{4}(\d{2}){0,2}$/.test(v))u.searchParams.set(key,v)}
 const resume=q.searchParams.get('resumeKey');if(resume&&resume.length<4000)u.searchParams.set('resumeKey',resume);archiveUrl=u.href;
 }
 try{
 const r=await upstream(archiveUrl);
 if(r.status===429){await r.body?.cancel();const after=r.headers.get('retry-after')||'60';return json({error:'Waybackの取得制限です。取得を停止して、時間をおいて再開してください。',upstreamStatus:429,retryAfter:after},429,{'Retry-After':after})}
 if(!r.ok){const body=await r.text();return json({error:`Wayback側の応答：HTTP ${r.status}`,upstreamStatus:r.status,detail:body.slice(0,600)},502)}
 if(q.pathname==='/api/cdx'){const body=await r.text();if(!body.trim().startsWith('['))return json({error:'一覧形式以外の応答です'},502);return new Response(body,{headers:{...cors,'Content-Type':'text/plain; charset=utf-8'}})}
 if(!/html/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();return json({error:'HTML以外の保存データです'},415)}
 let description='',title='',twitterDescription='';
 const transformed=new HTMLRewriter().on('title',{text(c){title+=c.text}}).on('meta',{element(el){const key=(el.getAttribute('property')||el.getAttribute('name')||'').toLowerCase(),val=el.getAttribute('content')||'';if(key==='og:description')description=val;if(key==='twitter:description')twitterDescription=val}}).transform(r);
 // Drain the transformed stream without retaining the complete HTML.
 const reader=transformed.body.getReader();let bytes=0;while(true){const x=await reader.read();if(x.done)break;bytes+=x.value.byteLength;if(bytes>8*1024*1024){await reader.cancel();return json({error:'保存HTMLが大きすぎるため停止しました'},413)}}
 return json({description:(description||twitterDescription).slice(0,20000),title:title.slice(0,2000),archiveUrl,original:target.href,timestamp:q.searchParams.get('timestamp'),retrievedAt:new Date().toISOString()});
 }catch(e){return json({error:'保存データの取得に失敗しました。',detail:String(e.message||e)},502)}
}};
