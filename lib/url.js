function canonicalize(input) {
 if(typeof input!=='string'||input.length>2048)throw new Error('Invalid URL');
 const u=new URL(input.trim()),host=u.hostname.toLowerCase();
 if(!['https:'].includes(u.protocol)||u.username||u.password||u.port||/%|\\/.test(u.pathname))throw new Error('Unsupported URL');
 if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(host)){
  const id=host==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1];
  if(!/^[\w-]{11}$/.test(id||''))throw new Error('Use an individual video');
  return {platform:'youtube',url:`https://www.youtube.com/watch?v=${id}`};
 }
 if(['soundcloud.com','www.soundcloud.com','m.soundcloud.com'].includes(host)&&/^\/[\w-]+\/[\w-]+\/?$/.test(u.pathname)&&!/^\/(?:discover|search|you|charts|stations)\//.test(u.pathname)&&!/^\/[^/]+\/(?:sets|tracks|albums|reposts|likes)\/?$/.test(u.pathname))return {platform:'soundcloud',url:`https://soundcloud.com${u.pathname.replace(/\/$/,'')}`};
 if(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.bandcamp\.com$/.test(host)&&/^\/track\/[\w-]+\/?$/.test(u.pathname))return {platform:'bandcamp',url:`https://${host}${u.pathname.replace(/\/$/,'')}`};
 throw new Error('Unsupported track URL');
}
module.exports={canonicalize};

