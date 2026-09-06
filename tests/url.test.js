const test=require('node:test');const assert=require('node:assert/strict');const {canonicalize}=require('../lib/url');
test('only canonical individual supported tracks accepted',()=>{
 assert.equal(canonicalize('https://youtu.be/dQw4w9WgXcQ?t=3').url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 assert.equal(canonicalize('https://artist.bandcamp.com/track/song?utm=a').platform,'bandcamp');
 for(const url of ['https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ','http://127.0.0.1','https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com:444/watch?v=dQw4w9WgXcQ','https://youtube.com/playlist?list=xx','https://soundcloud.com/a/sets/b','https://artist.bandcamp.com/album/a','file:///x','https://soundcloud.com/a/b%2fc'])assert.throws(()=>canonicalize(url));
});

test('rejects HTTP, custom ports, login URLs, playlist URLs, and private destinations',()=>{
 for (const url of ['http://youtu.be/dQw4w9WgXcQ','https://user@youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com:8443/watch?v=dQw4w9WgXcQ','https://youtube.com/playlist?list=123','https://127.0.0.1/soundcloud.com/track','https://soundcloud.com.evil.example/artist/track']) assert.throws(()=>canonicalize(url));
});
