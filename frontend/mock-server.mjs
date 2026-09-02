import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const artists = ['Beyond','S.H.E','G.E.M.邓紫棋','周杰伦','孙燕姿','五月天','林俊杰','张学友','梁静茹','蔡依林','王菲','田馥甄'].map((title,index)=>({ratingKey:String(index+1),type:'artist',title,summary:`${title}，华语乐坛绕不开的名字。从早期作品到近年的转向，旋律始终是他们最强的辨识度。`,tags:{genre:index%2?['华语流行']:['摇滚']},thumb:index%4?'mock':'',thumbUrl:index%4?`/mock-cover/${encodeURIComponent(title)}.svg`:'',art:index%3?'mock-bg':'',artUrl:index%3?`/mock-cover/bg-${encodeURIComponent(title)}.svg`:''}))
const albums = ['女生宿舍','范特西','七里香','我要我们在一起','寓言','叶惠美','逆光','勇气','十一月的萧邦','盖世英雄','神的孩子都在跳舞','八度空间'].map((title,index)=>({ratingKey:String(index+30),type:'album',title,parentTitle:artists[index%artists.length].title,parentRatingKey:artists[index%artists.length].ratingKey,year:2000+index,thumb:index%5?'mock':'',thumbUrl:index%5?`/mock-cover/${encodeURIComponent(title)}.svg`:'',artUrl:`/mock-cover/bg-${encodeURIComponent(title)}.svg`}))
const tracks = Array.from({length:30},(_,index)=>({ratingKey:String(100+index),title:['恋人未满','晴天','勇气','海阔天空','光年之外'][index%5],grandparentTitle:artists[index%artists.length].title,parentTitle:albums[index%albums.length].title,thumbUrl:`/mock-cover/${encodeURIComponent(albums[index%albums.length].title)}.svg`,duration:215000+index*1400}))
const jobs = [
  {id:8,kind:'scrape_artists',title:'更新歌手海报、背景与中文简介',status:'running',progress:68,message:'正在处理 梁静茹 (72/105)',created_at:new Date(Date.now()-180000).toISOString()},
  {id:7,kind:'fill_lyrics',title:'补齐缺失时间轴歌词',status:'completed',progress:100,message:'完成',created_at:new Date(Date.now()-3600000).toISOString()},
  {id:6,kind:'fill_album_covers',title:'补齐缺失专辑封面',status:'completed',progress:100,message:'完成',created_at:new Date(Date.now()-7200000).toISOString()},
  {id:5,kind:'download',title:'下载 周杰伦 - 晴天',status:'waiting_confirm',progress:95,message:'等待确认入库',result:{preview:{incomingPath:'/music/_incoming/周杰伦-晴天.mp3',targetPath:'/music/周杰伦/叶惠美/03 - 晴天.mp3',title:'晴天',artist:'周杰伦',album:'叶惠美',quality:'320k',conflictAdjusted:false}},created_at:new Date(Date.now()-9000000).toISOString()},
]
const source={id:'demo-source',name:'[独家音源]',displayName:'[独家音源]',sourceType:'file',status:'resolve_ok',enabled:true,accessGranted:true,catalogReady:true,downloadCapable:true,searchOk:true,resolveOk:true,detectedFormat:'lx-event',compatibility:'full',successRate:100,supportedPlatforms:['kw','kg','tx','wy','mg','local'],supportedQualities:['128k','320k','flac','flac24bit'],lastTestAt:new Date(Date.now()-900000).toISOString(),lastErrorMessage:null,metadata:{author:'洛雪科技',version:'4'}}
const searchResults=tracks.slice(0,8).map((t,i)=>({sourceId:source.id,sourceName:source.displayName,platform:'tx',trackId:String(i),id:String(i),title:t.title,artist:t.grandparentTitle,album:t.parentTitle,duration:240+i*3,coverUrl:'',cover:'',qualities:['128k','320k','flac'],musicInfo:{source:'tx',id:`tx_${i}`,meta:{songId:String(i)}}}))
const localFiles=tracks.slice(0,14).map((t,i)=>({id:`file-${i}`,path:`/music/${t.grandparentTitle}/${t.parentTitle}/${String(i+1).padStart(2,'0')} - ${t.title}.flac`,filename:`${String(i+1).padStart(2,'0')} - ${t.title}.flac`,title:t.title,artist:i%3===1?'':t.grandparentTitle,album:i%5===2?'':t.parentTitle,album_artist:i%3===1?'':t.grandparentTitle,year:'2003',track_number:String(i+1),disc_number:'1',genre:'华语流行',format:'FLAC',size:32_000_000,has_cover:i%3!==0,has_lrc:i%4!==0,plex_matched:i%5!==0,path_rule_ok:i%4!==1}))
const pendingDownloads=[{jobId:5,title:'晴天',artist:'周杰伦',album:'叶惠美',quality:'320k',source:'[独家音源]',downloadPath:'/music/_incoming/周杰伦-晴天.mp3',targetPath:'/music/周杰伦/叶惠美/03 - 晴天.mp3',tagStatus:'已写入',coverStatus:'已保存',lyricStatus:'已保存',conflict:false,preview:jobs[3].result.preview}]
const plexSettings={enabled:true,name:'极空间 Plex',serverUrl:'http://127.0.0.1:32400',externalUrl:'http://127.0.0.1:32400',token:'',hasToken:true,selectedLibraryKeys:'all',lastConnectedAt:new Date(Date.now()-600000).toISOString(),lastSyncAt:new Date(Date.now()-1200000).toISOString(),libraries:[{key:'26',title:'音乐',type:'artist',enabled:true},{key:'27',title:'演唱会音乐',type:'artist',enabled:true}],syncedLibraryCount:2}
const users=[{id:'admin',username:'admin',displayName:'管理员',role:'admin',enabled:true,createdAt:new Date(Date.now()-86400000).toISOString(),updatedAt:new Date().toISOString(),lastLoginAt:new Date(Date.now()-300000).toISOString()}]
/**
 * 生成一张无品牌、无文字的渐变封面。
 *
 * 之前 mock 把 /visuals/fallback-cover-vinyl.svg（印着 "SONGLIB AMP /
 * NO COVER ART" 金色水印的兜底图）当成真封面塞进 thumbUrl，
 * 于是开发预览里整屏都是重复的品牌水印 —— 那不是产品的真实样子，
 * 反而误导了对界面观感的判断。
 *
 * 现在按 seed 生成稳定的双色渐变，代表"这条数据有封面"。
 * 真正缺封面的条目 thumbUrl 留空，由前端 Cover 组件给出首字占位。
 */
const mockCover = (seed) => {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  const hue2 = (hue + 38) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 42% 32%)"/>
    <stop offset="1" stop-color="hsl(${hue2} 38% 14%)"/>
  </linearGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <circle cx="420" cy="170" r="200" fill="hsl(${hue} 55% 46%)" opacity=".18"/>
  <circle cx="150" cy="470" r="240" fill="hsl(${hue2} 50% 20%)" opacity=".35"/>
</svg>`
}

const json = (res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))}
/** 读完请求体再交给 handler。mock 里多处 POST 需要看 payload。 */
const withJson=(req,res,handler)=>{let raw='';req.on('data',c=>{raw+=c});req.on('end',()=>{let payload={};try{payload=JSON.parse(raw||'{}')}catch{}handler(payload)})}

const port = Number(process.env.PORT || 4174)
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost')
  if(url.pathname.startsWith('/mock-cover/')){res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','cache-control':'public,max-age=3600'});return res.end(mockCover(decodeURIComponent(url.pathname.slice(12))))}
  if(url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/auth/status')return json(res,{authenticated:!String(req.headers.referer||'').includes('login=1'),user:users[0]})
    if(url.pathname==='/api/auth/login')return json(res,{ok:true})
    if(url.pathname==='/api/users'&&req.method==='POST')return json(res,{...users[0],id:'demo-user',username:'demo'})
    if(url.pathname==='/api/users')return json(res,{items:users})
    if(/^\/api\/users\/[^/]+\/password$/.test(url.pathname))return json(res,{ok:true})
    if(/^\/api\/users\/[^/]+$/.test(url.pathname)&&['PATCH','DELETE'].includes(req.method))return json(res,req.method==='DELETE'?{ok:true}:users[0])
    if(url.pathname==='/api/dashboard')return json(res,{artists:105,artistPosters:104,artistBackgrounds:35,chineseBios:102,albums:302,albumCovers:299,tracks:1439,localLyrics:1427,missingLyrics:12,musicRoot:'/music',plexConnected:true,heroImages:[{type:'plex_artist_background',title:'S.H.E',subtitle:'Plex 歌手背景',imageUrl:'/mock-cover/bg-S.H.E.svg',coverUrl:'/mock-cover/%E9%80%86%E5%85%89.svg'},{type:'local_artist_background',title:'周杰伦',subtitle:'本地 artist-background',imageUrl:'/mock-cover/bg-jay.svg',coverUrl:'/mock-cover/qingtian.svg'}]})
    if(url.pathname==='/api/jobs')return json(res,jobs)
    if(/^\/api\/jobs\/\d+$/.test(url.pathname)){const job=jobs.find(item=>String(item.id)===url.pathname.split('/').pop())||jobs[0];return json(res,{...job,logs:[{id:'1',level:'info',message:'任务开始执行。',created_at:job.created_at},{id:'2',level:job.status==='waiting_confirm'?'info':'success',message:job.status==='waiting_confirm'?'下载完成，等待用户确认入库预览。':'任务全部步骤执行完成。',created_at:new Date().toISOString()}]})}
    if(url.pathname==='/api/sources')return json(res,[source])
    if(url.pathname===`/api/sources/${source.id}/test-search`)return json(res,{ok:true,source_id:source.id,platform:'tx',count:searchResults.length,results:searchResults})
    if(url.pathname===`/api/sources/${source.id}/test-resolve`)return json(res,{ok:true,message:'下载地址解析可用。',source})
    if(url.pathname===`/api/sources/${source.id}/inspect`)return json(res,{ok:true,source_id:source.id,detected_format:'lx-event',top_level_keys:['lx.EVENT_NAMES','lx.on','lx.send','lx.request'],methods:{search:false,resolve:true,lyric:true,cover:true},compatibility:'full',catalog_search_adapter:true,supported_platforms:source.supportedPlatforms,supported_qualities:source.supportedQualities,message:'已识别为洛雪事件协议源；搜索由音屿目录适配器提供，下载地址由该源解析。'})
    if(url.pathname===`/api/sources/${source.id}/logs`)return json(res,[{id:'s1',level:'success',action:'validate',message:'隔离加载校验通过；请继续测试搜索和下载地址解析。',created_at:new Date(Date.now()-1800000).toISOString()},{id:'s2',level:'success',action:'test_resolve',message:'320k 下载地址解析与音频探测成功。',created_at:new Date(Date.now()-900000).toISOString()}])
    if(url.pathname==='/api/downloads/pending')return json(res,{items:pendingDownloads,total:pendingDownloads.length})
    if(url.pathname==='/api/downloads/device-token')return json(res,{ok:true,filename:'周杰伦 - 晴天.mp3',downloadUrl:'/api/mock-audio/download',contentType:'audio/mpeg'})
    if(url.pathname==='/api/downloads/batch-confirm'||url.pathname==='/api/downloads/batch-cancel')return json(res,{items:[]})
    if(url.pathname.startsWith('/api/player/local/')&&!url.pathname.endsWith('/stream')&&!url.pathname.endsWith('/lyrics')&&!url.pathname.endsWith('/cover')){const id=url.pathname.split('/').pop();const item=localFiles.find(file=>file.id===id)||localFiles[0];return json(res,{source:'local_file',id:item.id,title:item.title,artist:item.artist,album:item.album,file:item.path,streamUrl:`/api/player/local/${item.id}/stream`,lyricsUrl:`/api/player/local/${item.id}/lyrics`,qualities:['original']})}
    if(url.pathname.endsWith('/lyrics'))return json(res,{lyrics:'[00:00.00]暂无歌词\\n[00:10.00]让散落的音乐回到自己的岛屿',format:'lrc'})
    if(url.pathname.startsWith('/api/local/files/')&&url.pathname.endsWith('/lyrics'))return json(res,{lyrics:'[00:00.00]暂无歌词\\n[00:10.00]让散落的音乐回到自己的岛屿',format:'lrc'})
    if(url.pathname.startsWith('/api/local/files/')&&url.pathname.endsWith('/cover')){res.writeHead(302,{location:'/icons/icon-192.png'});return res.end()}
    if(url.pathname.startsWith('/api/local/files/')&&url.pathname.endsWith('/stream')){res.writeHead(204,{'accept-ranges':'bytes'});return res.end()}
    if(url.pathname.startsWith('/api/player/plex/')&&!url.pathname.endsWith('/stream')){const key=url.pathname.split('/')[4];const item=tracks.find(track=>track.ratingKey===key)||tracks[0];return json(res,{source:'plex_item',ratingKey:key,title:item.title,artist:item.grandparentTitle,album:item.parentTitle,file:`/music/${item.grandparentTitle}/${item.parentTitle}/${item.title}.flac`,streamUrl:`/api/player/plex/${key}/stream`,qualities:['original','320k','256k','192k','128k']})}
    if(url.pathname==='/api/player/source-preview')return json(res,{source:'source_preview',title:'晴天',artist:'周杰伦',album:'叶惠美',streamUrl:'/api/mock-audio/preview',quality:'128k'})
    if(url.pathname==='/api/profile')return json(res,{username:'admin',displayName:'管理员',avatarUrl:'',theme:'dark',defaultSource:'tx',defaultQuality:'320k'})
    if(url.pathname==='/api/profile/avatar')return json(res,{ok:true,profile:{username:'admin',displayName:'管理员',avatarUrl:'/icons/icon-192.png',theme:'dark',defaultSource:'tx',defaultQuality:'320k'}})
    if(url.pathname==='/api/logs/summary')return json(res,{updatedAt:new Date().toISOString(),jobLogs:[{id:'jl1',level:'success',job_title:'扫描本地曲库',message:'扫描完成。',created_at:new Date().toISOString()}],sourceLogs:[{id:'sl1',level:'success',source_name:'[独家音源]',action:'test_resolve',message:'地址解析成功。',created_at:new Date().toISOString()}],operations:[{id:'op1',status:'success',action:'tag_write',target_id:'file-1',created_at:new Date().toISOString()}]})
    if(url.pathname==='/api/settings/plex'&&req.method==='POST')return json(res,{ok:true,settings:plexSettings})
    if(url.pathname==='/api/settings/plex')return json(res,plexSettings)
    if(url.pathname==='/api/plex/test')return json(res,{ok:true,message:'Plex 连接成功，已识别到 2 个音乐资料库。',identity:{friendlyName:'Mock Plex'},libraryCount:2,libraries:plexSettings.libraries,connectedAt:new Date().toISOString()})
    if(url.pathname==='/api/plex/libraries')return json(res,{items:plexSettings.libraries})
    if(url.pathname==='/api/plex/sync')return json(res,{id:11,kind:'plex_sync',title:'同步 Plex 音乐资料库',status:'queued',progress:0,created_at:new Date().toISOString()})
    if(/^\/api\/plex\/items\/[^/]+\/playback$/.test(url.pathname)){const key=url.pathname.split('/')[4];const item=tracks.find(track=>track.ratingKey===key)||tracks[0];return json(res,{ratingKey:key,title:item.title,artist:item.grandparentTitle,album:item.parentTitle,duration:item.duration,coverUrl:`/mock-cover/${encodeURIComponent(item.title)}.svg`,artistBackgroundUrl:`/mock-cover/bg-${encodeURIComponent(item.grandparentTitle)}.svg`,directPlayUrl:`/api/player/plex/${key}/stream?bitrate=original`,transcodeUrls:{original:`/api/player/plex/${key}/stream?bitrate=original`,'320k':`/api/player/plex/${key}/stream?bitrate=320k`},lyrics:'[00:00.00]模拟 Plex 歌词\\n[00:10.00]底部播放器现在会动了',file:`/music/${item.grandparentTitle}/${item.parentTitle}/${item.title}.flac`,openPlexUrl:'http://127.0.0.1:32400/web'})}
    if(/^\/api\/player\/plex\/[^/]+\/stream$/.test(url.pathname)){res.writeHead(204,{'accept-ranges':'bytes'});return res.end()}
    if(url.pathname==='/api/settings')return json(res,{appName:'SongLib Amp｜音屿',version:'1.0.5',plex:plexSettings,plexServerName:plexSettings.name,musicRoot:'/music',plexUrl:plexSettings.serverUrl,externalPlexUrl:plexSettings.externalUrl,plexSection:'26',downloadDir:'_downloads',downloadTempDir:'/music/_downloads',incomingDir:'/music/_incoming',manualDownloadDir:'/downloads',trashDir:'/music/.trash',lyricRule:'同名 .lrc',coverRule:'专辑目录 cover.jpg + 音频内嵌封面',scrapeRules:{defaultMode:'missing',writeCover:true,writeLyrics:true,refreshPlex:true,skipExistingCover:true,skipExistingLyrics:true},namingTemplates:{album:'/{artist}/{album} ({year})/{trackNumber} - {title}.{ext}',multiDisc:'/{artist}/{album} ({year})/{discNumber}{trackNumber} - {title}.{ext}',compilation:'/Various Artists/{album} ({year})/{trackNumber} - {artist} - {title}.{ext}',unknown:'/{artist}/Unknown Album/{title}.{ext}'},excludeDirs:['/music/_incoming','/music/_downloads','/music/.trash','/music/@eaDir','/music/#recycle'],player:{},user:{username:'admin',role:'admin',permissions:['manage_users','manage_library','manage_sources'],fontSize:'standard',defaultSource:'tx',defaultQuality:'320k'},maxDownloadMb:500,sourceMaxSizeMb:2,fnosMusic:{configured:false,serverUrl:'http://127.0.0.1:5666/music',authMode:'password',accountLabel:''}})
    if(/^\/api\/library\/artists\/[^/]+$/.test(url.pathname)){const item=artists.find(value=>value.ratingKey===url.pathname.split('/').at(-1))||artists[0];const related=albums.filter(value=>value.parentRatingKey===item.ratingKey);return json(res,{artist:item,albums:related,popularTracks:tracks.slice(0,8).map(value=>({...value,grandparentTitle:item.title})),trackCount:24,albumCount:related.length})}
    if(/^\/api\/library\/albums\/[^/]+$/.test(url.pathname)){const item=albums.find(value=>value.ratingKey===url.pathname.split('/').at(-1))||albums[0];const artist=artists.find(value=>value.ratingKey===item.parentRatingKey)||artists[0];const related=tracks.slice(0,10).map((value,index)=>({...value,index:index+1,parentTitle:item.title,grandparentTitle:artist.title}));return json(res,{album:item,artist,tracks:related,trackCount:related.length,duration:related.reduce((sum,value)=>sum+value.duration,0)})}
    if(url.pathname==='/api/library/artists'){const q=(url.searchParams.get('search')||'').trim();const items=q?artists.filter(a=>a.title.includes(q)):artists;return json(res,{items,total:items.length,page:1,pageSize:200})}
    if(url.pathname==='/api/library/albums'){const q=(url.searchParams.get('search')||'').trim();const items=q?albums.filter(a=>a.title.includes(q)||(a.parentTitle||'').includes(q)):albums;return json(res,{items,total:items.length,page:1,pageSize:200})}
    if(url.pathname==='/api/library/tracks'){const q=(url.searchParams.get('search')||'').trim();const items=q?tracks.filter(t=>t.title.includes(q)||t.grandparentTitle.includes(q)||t.parentTitle.includes(q)):tracks;return json(res,{items,total:items.length,page:1,pageSize:200})}
    if(url.pathname==='/api/local/files')return json(res,{items:localFiles,total:localFiles.length,stats:{total:1439,missing_cover:14,missing_lyrics:12,missing_artist:2,missing_album:3,bad_path:9,plex_unmatched:6}})
    if(url.pathname==='/api/local/download-inbox')return json(res,{
      downloadRoot:'/downloads',musicRoot:'/music',errors:[],
      summary:{total:4,ready:1,review:1,conflicts:1,duplicates:2},
      items:[
        {sourcePath:'/downloads/Beyond - 海阔天空.mp3',targetPath:'/music/Beyond/乐与怒/03 - 海阔天空.mp3',
         title:'海阔天空',artist:'Beyond',album:'乐与怒',duration:313,bitrate:320,size:12_600_000,
         format:'MP3',conflict:false,metadataSource:'tags',needsReview:false,worseThanExisting:true,
         existing:[{id:'e1',path:'/music/Beyond/乐与怒/03 - 海阔天空.flac',album:'乐与怒',ext:'.flac',bitrate:982,size:44_100_000,duration:313}]},
        {sourcePath:'/downloads/新歌 - 某个歌手.flac',targetPath:'/music/某个歌手/单曲/新歌.flac',
         title:'新歌',artist:'某个歌手',album:'单曲',duration:240,bitrate:960,size:29_000_000,
         format:'FLAC',conflict:false,metadataSource:'tags',needsReview:false,worseThanExisting:false,existing:[]},
        {sourcePath:'/downloads/track07.m4a',targetPath:'/music/Unknown Artist/Unknown Album/track07.m4a',
         title:'track07',artist:'Unknown Artist',album:'Unknown Album',duration:198,bitrate:256,size:6_400_000,
         format:'M4A',conflict:false,metadataSource:'path',needsReview:true,worseThanExisting:false,existing:[]},
        {sourcePath:'/downloads/晴天.flac',targetPath:'/music/周杰伦/叶惠美/03 - 晴天.flac',
         title:'晴天',artist:'周杰伦',album:'叶惠美',duration:269,bitrate:960,size:38_400_000,
         format:'FLAC',conflict:true,metadataSource:'tags',needsReview:false,worseThanExisting:false,
         existing:[{id:'e2',path:'/music/周杰伦/叶惠美/03 - 晴天.flac',album:'叶惠美',ext:'.flac',bitrate:960,size:38_400_000,duration:269}]}
      ]
    })
    if(url.pathname==='/api/local/health')return json(res,{
      total:1439,checkedAt:new Date(Date.now()-45000).toISOString(),score:96,clean:false,
      allChecks:[
        {id:'cover',label:'缺封面',count:14,hint:'「封面与歌词」能一次补齐',page:'scrape',filter:'cover',severity:'info'},
        {id:'lyrics',label:'缺歌词',count:12,hint:'「封面与歌词」能一次补齐',page:'scrape',filter:'lyrics',severity:'info'},
        {id:'artist',label:'没有歌手',count:2,hint:'「文件与标签 → 补标签」可以从路径推断',page:'local',filter:'artist',severity:'warning'},
        {id:'album',label:'没有专辑',count:3,hint:'「文件与标签 → 补标签」可以从路径推断',page:'local',filter:'album',severity:'warning'},
        {id:'path',label:'目录不规范',count:9,hint:'「文件与标签 → 整理目录」按命名规则归位',page:'local',filter:'path',severity:'info'},
        {id:'plex',label:'Plex 没对上',count:6,hint:'同步一次 Plex 对照通常就好了',page:'local',filter:'plex',severity:'info'}
      ],
      checks:[
        {id:'cover',label:'缺封面',count:14,hint:'「封面与歌词」能一次补齐',page:'scrape',filter:'cover',severity:'info'},
        {id:'lyrics',label:'缺歌词',count:12,hint:'「封面与歌词」能一次补齐',page:'scrape',filter:'lyrics',severity:'info'},
        {id:'path',label:'目录不规范',count:9,hint:'「文件与标签 → 整理目录」按命名规则归位',page:'local',filter:'path',severity:'info'},
        {id:'plex',label:'Plex 没对上',count:6,hint:'同步一次 Plex 对照通常就好了',page:'local',filter:'plex',severity:'info'},
        {id:'album',label:'没有专辑',count:3,hint:'「文件与标签 → 补标签」可以从路径推断',page:'local',filter:'album',severity:'warning'},
        {id:'artist',label:'没有歌手',count:2,hint:'「文件与标签 → 补标签」可以从路径推断',page:'local',filter:'artist',severity:'warning'},
        {id:'duplicate',label:'疑似重复',count:3,hint:'同一首歌存了多份，留码率最高的那个就行',page:'local',filter:'',severity:'warning'},
        {id:'orphan',label:'文件已经不在了',count:2,hint:'曲库里还有记录，但磁盘上找不到 —— 重新扫一次会清掉',page:'local',filter:'',severity:'danger'}
      ],
      duplicateTotal:3,
      duplicates:[
        {key:'meta|海阔天空|beyond|104',reason:'曲名、歌手和时长都对得上',title:'海阔天空',artist:'Beyond',items:[
          {id:'d1',path:'/music/Beyond/乐与怒/03 - 海阔天空.flac',ext:'.flac',bitrate:982,size:44_100_000,duration:313,keep:true},
          {id:'d2',path:'/music/_老备份/海阔天空.mp3',ext:'.mp3',bitrate:320,size:12_600_000,duration:314,keep:false}
        ]},
        {key:'hash|9f2c',reason:'文件完全相同',title:'晴天',artist:'周杰伦',items:[
          {id:'d3',path:'/music/周杰伦/叶惠美/03 - 晴天.flac',ext:'.flac',bitrate:960,size:38_400_000,duration:269,keep:true},
          {id:'d4',path:'/music/未整理/晴天 (1).flac',ext:'.flac',bitrate:960,size:38_400_000,duration:269,keep:false}
        ]},
        {key:'meta|勇气|梁静茹|84',reason:'曲名、歌手和时长都对得上',title:'勇气',artist:'梁静茹',items:[
          {id:'d5',path:'/music/梁静茹/勇气/01 - 勇气.flac',ext:'.flac',bitrate:940,size:31_200_000,duration:253,keep:true},
          {id:'d6',path:'/music/梁静茹/精选/05 - 勇气.mp3',ext:'.mp3',bitrate:320,size:10_100_000,duration:254,keep:false},
          {id:'d7',path:'/downloads/勇气.m4a',ext:'.m4a',bitrate:256,size:8_200_000,duration:253,keep:false}
        ]}
      ],
      missingOnDiskTotal:2,
      missingOnDisk:[
        {id:'o1',path:'/music/五月天/后青春的诗/07 - 突然好想你.flac',artist:'五月天',album:'后青春的诗'},
        {id:'o2',path:'/music/未整理/未命名音轨.mp3',artist:'',album:''}
      ]
    })
    if(url.pathname==='/api/local/categories')return json(res,{summary:[{id:'tracks',label:'歌曲',count:1439,note:'首歌曲'},{id:'artists',label:'艺人',count:105,note:'位艺人'},{id:'albums',label:'专辑',count:306,note:'张专辑'},{id:'genres',label:'流派',count:14,note:'种流派'},{id:'folders',label:'文件夹',count:107,note:'个顶层目录'},{id:'lossless',label:'无损',count:720,note:'首高规格'}],groups:{genre:[{id:'华语流行',name:'华语流行',count:880,search:'华语流行'},{id:'摇滚',name:'摇滚',count:120,search:'摇滚'}],artist:artists.slice(0,8).map(a=>({id:a.title,name:a.title,count:12,search:a.title})),album:albums.slice(0,8).map(a=>({id:a.title,name:a.title,count:10,search:a.title})),folder:artists.slice(0,8).map(a=>({id:a.title,name:a.title,count:12,search:a.title})),format:[{id:'FLAC',name:'FLAC',count:900,search:'.flac'},{id:'MP3',name:'MP3',count:539,search:'.mp3'}],quality:[{id:'无损',name:'无损 / Hi-Res',count:900},{id:'标准',name:'标准音质',count:539}],year:[{id:'2003',name:'2003',count:120,search:'2003'}],scene:[{id:'影视原声',name:'影视原声',count:80,search:'原声'}],missing:[{id:'cover',name:'缺封面',count:14,missing:'cover'},{id:'lyrics',name:'缺歌词',count:12,missing:'lyrics'}]}})
    if(url.pathname==='/api/discovery/platforms')return json(res,{items:[
      {id:'netease',name:'网易云音乐',browseOnly:false,siteUrl:'https://music.163.com/',defaultCategory:'热门',note:''},
      {id:'qq',name:'QQ 音乐',browseOnly:false,siteUrl:'https://y.qq.com/',defaultCategory:'10000000',note:''},
      {id:'kugou',name:'酷狗音乐',browseOnly:true,siteUrl:'https://www.kugou.com/',defaultCategory:'',note:'酷狗的歌单接口需要客户端签名，暂时只能跳到官网浏览'}
    ]})
    if(url.pathname==='/api/discovery/playlists'){
      const platform=url.searchParams.get('platform')||'netease'
      if(platform==='kugou')return json(res,{platform,platformName:'酷狗音乐',browseOnly:true,siteUrl:'https://www.kugou.com/',categories:[],playlists:[],selectedCategory:'',errors:['酷狗的歌单接口需要客户端签名，暂时只能跳到官网浏览'],updatedAt:new Date().toISOString()})
      const isQQ=platform==='qq'
      const cats=isQQ
        ? [['全部','10000000','热门'],['华语','167','语种'],['欧美','168','语种'],['粤语','169','语种'],['流行','3','风格'],['摇滚','11','风格'],['开车','116','场景'],['运动','117','场景']]
        : [['热门','热门','分类'],['华语','华语','分类'],['流行','流行','分类'],['粤语','粤语','分类'],['影视原声','影视原声','分类'],['经典','经典','分类'],['摇滚','摇滚','分类'],['民谣','民谣','分类']]
      const selected=url.searchParams.get('category')||cats[0][1]
      const platformName=isQQ?'QQ 音乐':'网易云音乐'
      const names=['甜度爆表 | 旋律说唱狙击少女心','循环了一整个夏天的华语','深夜driving：城市霓虹','那些年我们一起听的粤语','独立民谣：房间里的下午','影视原声：那些哭过的片段','清晨通勤的轻电子','八十年代的港台金曲']
      return json(res,{
        platform,platformName,browseOnly:false,
        siteUrl:isQQ?'https://y.qq.com/':'https://music.163.com/',
        selectedCategory:selected,errors:[],updatedAt:new Date().toISOString(),
        categories:cats.map(([name,value,group],i)=>({id:`${platform}-${i}`,value,name,count:isQQ?0:12000-i*900,group,url:'#'})),
        playlists:names.map((title,i)=>({id:String(7000000000+i),platform,platformName,title,description:'',coverUrl:`/mock-cover/${encodeURIComponent(title.slice(0,4))}.svg`,trackCount:isQQ?0:40+i*13,playCount:(i+1)*8_540_000,creator:['我想要两颗西柚','捡钱的Penny','夜航西飞','小城故事'][i%4],sourceUrl:'#'}))
      })
    }
    if(/^\/api\/discovery\/playlists\/[^/]+$/.test(url.pathname)){
      const platform=url.searchParams.get('platform')||'netease'
      const list=Array.from({length:24},(_,i)=>{
        const t=tracks[i%tracks.length]
        const matched=i%3!==2
        return {platform:platform==='qq'?'tx':'wy',platformTrackId:`p-${i}`,title:t.title,artist:t.grandparentTitle,album:t.parentTitle,duration:Math.round(t.duration/1000),coverUrl:t.thumbUrl,
          matchStatus:matched?'matched':'missing',canDownload:!matched&&i%2===0,
          localTrack:matched?{...t,sourceSummary:i%2?'本地文件':'Plex',sourceTypes:[i%2?'local_file':'plex_item'],resources:[{type:i%2?'local_file':'plex_item',id:t.ratingKey,path:`/music/${t.grandparentTitle}/${t.parentTitle}/${t.title}.flac`}]}:null}
      })
      return json(res,{
        playlist:{id:url.pathname.split('/').pop(),platform,platformName:platform==='qq'?'QQ 音乐':'网易云音乐',title:'循环了一整个夏天的华语',description:'',coverUrl:'/mock-cover/%E5%A4%8F%E5%A4%A9.svg',trackCount:list.length,playCount:85_400_000,creator:'捡钱的Penny',sourceUrl:'#'},
        tracks:list,
        summary:{total:list.length,matched:list.filter(i=>i.matchStatus==='matched').length,downloadable:list.filter(i=>i.canDownload).length,unavailable:list.filter(i=>i.matchStatus!=='matched'&&!i.canDownload).length},
        downloadSource:{id:source.id,name:'[独家音源]'}
      })
    }
    if(url.pathname==='/api/discovery/download-missing')return withJson(req,res,payload=>json(res,{created:(payload.tracks||[]).length,errors:[]}))
    if(url.pathname==='/api/local/tags/preview')return withJson(req,res,payload=>{
      const ids=new Set((payload.fileIds||[]).map(String))
      const picked=ids.size?localFiles.filter(f=>ids.has(f.id)):localFiles
      const items=picked.map((f,index)=>{
        const parts=f.path.split('/').filter(Boolean)
        const fields=[],conflicts=[]
        if(!f.artist)fields.push({field:'artist',oldValue:'',newValue:parts[1]||''})
        if(!f.album)fields.push({field:'album',oldValue:'',newValue:parts[2]||''})
        if(!f.album_artist)fields.push({field:'albumArtist',oldValue:'',newValue:parts[1]||''})
        // 每 4 个里造一个"目录名和标签对不上"的例子。
        // 真后端只在 _norm(现值) != _norm(推断值) 时才算冲突，
        // 所以 mock 也必须造出真的不一样的值，否则界面上会出现
        // "五月天 → 五月天" 这种看着像 bug 的对照。
        if(f.artist&&f.album&&index%4===1){
          conflicts.push({field:'artist',oldValue:f.artist,newValue:`${parts[1]||'未知'} (Live)`})
          if(index%8===1)conflicts.push({field:'album',oldValue:f.album,newValue:`${parts[2]||'未知'} 精选集`})
        }
        return {fileId:f.id,path:f.path,fields,conflicts,
          skipReason:fields.length?'':(conflicts.length?'四个字段都有值，但和目录名对不上':'四个字段都已经有值')}
      })
      json(res,{items,total:items.length,
        changeable:items.filter(i=>i.fields.length).length,
        conflicted:items.filter(i=>i.conflicts.length).length})
    })
    if(url.pathname==='/api/local/organize/preview')return withJson(req,res,payload=>{
      const ids=new Set((payload.fileIds||[]).map(String))
      const picked=localFiles.filter(f=>ids.has(f.id))
      json(res,{dryRun:true,items:picked.map((f,i)=>{
        const artist=f.album_artist||f.artist||'Unknown Artist'
        const album=f.album||'Unknown Album'
        const target=`/music/${artist}/${album} (${f.year})/${f.filename}`
        return {fileId:f.id,sourcePath:f.path,targetPath:f.path_rule_ok?f.path:target,targetDirectory:target.slice(0,target.lastIndexOf('/')),targetFilename:f.filename,lyricPath:target.replace(/\.flac$/,'.lrc'),coverPath:'',conflict:i===1,overwrite:false,safe:true,plexRuleOk:true}
      })})
    })
    if(url.pathname==='/api/local/organize/apply')return json(res,{id:21,kind:'local_organize',title:'确认执行本地曲库整理',status:'queued',progress:0,created_at:new Date().toISOString()})
    if(/^\/api\/local\/operations\/[^/]+\/rollback$/.test(url.pathname))return json(res,{ok:true})
    if(url.pathname==='/api/local/operations'){
      const ago=m=>new Date(Date.now()-m*60000).toISOString()
      const move=(i,from,to,rb=true)=>({id:`mv${i}`,target:to,rollbackable:rb,status:rb?'success':'rolled_back',error:'',
        changes:[{kind:'move',oldValue:from,newValue:to}]})
      return json(res,{total:41,groups:[
        {id:'t1',action:'tag_write',actionLabel:'写入标签',at:ago(18),count:3,failed:0,rolledBack:0,
         rollbackableIds:['t1','t2','t3'],more:0,items:[
          {id:'t1',target:'/music/S.H.E/范特西/02 - 晴天.flac',rollbackable:true,status:'success',error:'',
           changes:[{kind:'field',field:'artist',oldValue:'',newValue:'S.H.E'},{kind:'field',field:'albumArtist',oldValue:'',newValue:'S.H.E'}]},
          {id:'t2',target:'/music/G.E.M.邓紫棋/七里香/03 - 勇气.flac',rollbackable:true,status:'success',error:'',
           changes:[{kind:'field',field:'album',oldValue:'',newValue:'七里香'}]},
          {id:'t3',target:'/music/张学友/勇气/08 - 勇气.flac',rollbackable:true,status:'success',error:'',
           changes:[{kind:'field',field:'artist',oldValue:'未知艺术家',newValue:'张学友'},{kind:'field',field:'album',oldValue:'',newValue:'勇气'},{kind:'field',field:'albumArtist',oldValue:'',newValue:'张学友'}]}
         ]},
        {id:'o1',action:'organize_move',actionLabel:'整理目录',at:ago(96),count:37,failed:1,rolledBack:0,
         rollbackableIds:Array.from({length:36},(_,i)=>`mv${i}`),more:25,
         items:Array.from({length:12},(_,i)=>move(i,`/music/未整理/曲目${i+1}.flac`,`/music/五月天/后青春的诗/${String(i+1).padStart(2,'0')} - 曲目${i+1}.flac`,i!==4))},
        {id:'g1',action:'download_inbox_ingest',actionLabel:'下载目录入库',at:ago(60*26),count:2,failed:0,rolledBack:2,
         rollbackableIds:[],more:0,items:[
          move(90,'/downloads/新歌.flac','/music/某个歌手/单曲/新歌.flac',false),
          move(91,'/downloads/另一首.mp3','/music/某个歌手/单曲/另一首.mp3',false)
         ]}
      ]})
    }
    if(url.pathname==='/api/local/operations/rollback')return withJson(req,res,payload=>{
      const ids=payload.ids||[]
      // 造一个部分失败：第 5 个退不回去
      const failed=ids.length>5?[{id:ids[4],error:'原位置已有文件，无法安全回滚'}]:[]
      json(res,{restored:ids.length-failed.length,failed})
    })
    if(url.pathname==='/api/catalog/search')return json(res,tracks.slice(0,8).map((t,i)=>({platform:'tx',id:String(i),title:t.title,artist:t.grandparentTitle,album:t.parentTitle,duration:240+i*3,cover:'',qualities:['128k','320k','flac'],musicInfo:{}})))
    if(url.pathname==='/api/scrape/preview'&&req.method==='POST'){
      // 真实后端返回的计划结构（见 backend/app/scraper.py build_diff_preview）：
      // { id, createdAt, scope, mode, summary:{create,replace,skip,conflicts}, items:[...] }
      // 每个条目带 oldValue/newValue/candidateSource/confidence/conflict/action，
      // 足以在前端做逐条对比。mock 之前只回 {ok:true}，
      // 导致"封面与歌词"页在开发预览里永远是空的，看起来就只是一个按钮。
      let body=''
      req.on('data',chunk=>{body+=chunk})
      req.on('end',()=>{
        let payload={}
        try{payload=JSON.parse(body||'{}')}catch{}
        const kind=payload.kind||'scrape_plex_metadata'
        const fields=kind==='fill_assets'
          ? [['专辑封面','album_cover'],['歌词','lyrics']]
          : [['歌手海报','artist_poster'],['歌手背景','artist_background'],['中文简介','artist_bio'],['专辑封面','album_cover']]
        const items=[]
        artists.slice(0,6).forEach((artist,ai)=>{
          fields.forEach(([field,fieldKey],fi)=>{
            const exists=(ai+fi)%4===0
            const conflict=(ai+fi)%7===3
            const skip=(ai+fi)%9===5
            items.push({
              id:`plan-${ai}-${fi}`,
              entityType:fieldKey.startsWith('artist')?'artist':'album',
              entityId:artist.ratingKey,
              sectionKey:'26',
              target:fieldKey.startsWith('artist')?artist.title:`${artist.title} · ${albums[ai%albums.length].title}`,
              field,fieldKey,
              oldValue:exists?'已有内容':'缺失',
              newValue:fieldKey==='artist_bio'
                ? `${artist.title} 的中文简介（约 180 字，来自公开资料整理）`
                : fieldKey==='lyrics'
                  ? '含时间轴的 LRC，共 42 行'
                  : `/mock-cover/${encodeURIComponent(artist.title)}.svg`,
              candidateSource:['Plex 官方','MusicBrainz','公开资料','本地文件'][(ai+fi)%4],
              confidence:Number((0.72+((ai*3+fi)%25)/100).toFixed(2)),
              conflict,
              action:skip?'skip':exists?'replace':'create',
              skipReason:skip?'无法唯一识别，已跳过':'',
              execution:null,
            })
          })
        })
        const summary={
          create:items.filter(i=>i.action==='create').length,
          replace:items.filter(i=>i.action==='replace').length,
          skip:items.filter(i=>i.action==='skip').length,
          conflicts:items.filter(i=>i.conflict).length,
        }
        json(res,{id:`preview-${Date.now()}`,kind,createdAt:new Date().toISOString(),scope:payload.scope||'missing',mode:payload.mode||'missing',summary,items})
      })
      return
    }
    if(url.pathname==='/api/scrape/apply'&&req.method==='POST')return json(res,{ok:true,jobId:9,message:'已加入任务队列'})
    return json(res,{ok:true})
  }
  let file=path.join(root,url.pathname==='/'?'index.html':url.pathname)
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html')
  const ext=path.extname(file);const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}
  res.writeHead(200,{'content-type':`${types[ext]||'application/octet-stream'}; charset=utf-8`});fs.createReadStream(file).pipe(res)
}).listen(port,'127.0.0.1',()=>console.log(`mock UI http://127.0.0.1:${port}`))
