const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const ACTIVE=['fetching','downloading','converting'],TERMINAL=['ready','failed','cancelled'];
const MESSAGES={queued:'Waiting for a worker.',fetching:'Checking track information.',downloading:'Downloading audio.',converting:'Converting to MP3.',ready:'Your MP3 is ready.',cancelled:'Conversion cancelled.',failed:'Conversion failed.'};
const ERRORS={duration_limit:'This track exceeds the 15 minute limit.',unknown_duration:'The track duration could not be verified.',playlist_not_allowed:'Playlists are not supported.',live_not_allowed:'Live streams are not supported.',authentication_required:'This track requires an account.',extract_failed:'This track could not be retrieved.',conversion_failed:'Audio conversion failed.',size_limit:'The track exceeds the file size limit.',platform_blocked:'The source is temporarily blocking requests. Try again later.',duration_exceeded:'This track exceeds the 15 minute limit.',too_long:'This track exceeds the 15 minute limit.',invalid_duration:'The track duration could not be verified.',unavailable:'This track is unavailable.',timeout:'Conversion timed out. Please try again.',worker_lost:'The conversion worker disconnected. Please try again.',interrupted:'Conversion was interrupted by a server restart. Please try again.',queue_expired:'The request expired while waiting. Please try again.',invalid_audio:'The conversion did not produce valid MP3 audio.',size_exceeded:'The track exceeds the file size limit.'};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),random=()=>crypto.randomBytes(32).toString('base64url');
class Store {
 constructor({dataDir,now=Date.now}){
  this.now=now;this.dir=dataDir;fs.mkdirSync(dataDir,{recursive:true});this.files=path.join(dataDir,'files');fs.mkdirSync(this.files,{recursive:true});
  this.db=new DatabaseSync(path.join(dataDir,'jobs.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS admissions(ip TEXT,at INTEGER); CREATE INDEX IF NOT EXISTS admission_ip ON admissions(ip,at); CREATE TABLE IF NOT EXISTS blocks(platform TEXT,at INTEGER); CREATE TABLE IF NOT EXISTS circuits(platform TEXT PRIMARY KEY,until INTEGER);');
  for(const j of this.all())if(ACTIVE.includes(j.state))this.finish(j,'failed','interrupted');
  const retained=new Set(this.all().filter(j=>j.state==='ready').map(j=>`${j.id}.mp3`));for(const file of fs.readdirSync(this.files))if(!retained.has(file))fs.rmSync(path.join(this.files,file),{force:true});
 }
 all(){return this.db.prepare('SELECT data FROM jobs ORDER BY rowid').all().map(r=>JSON.parse(r.data));}
 get(id){const r=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);return r?JSON.parse(r.data):null;}
 save(j){this.db.prepare('INSERT INTO jobs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(j.id,JSON.stringify(j));return j;}
 admit(ip,platform,url){
  const now=this.now(),jobs=this.all();if(jobs.some(j=>j.ip===hash(ip)&&!TERMINAL.includes(j.state)))return {error:429,code:'outstanding_job',message:'Finish or cancel your current conversion first.'};
  if(this.db.prepare('SELECT count(*) AS n FROM admissions WHERE ip=? AND at>?').get(hash(ip),now-3600000).n>=5)return {error:429,code:'rate_limited',message:'You can start five conversions per hour. Please try again later.'};
  if(jobs.filter(j=>j.state==='queued').length>=10)return {error:429,code:'queue_full',message:'The conversion queue is full. Please try again shortly.'};
  const token=random(),j={id:crypto.randomUUID(),tokenHash:hash(token),ip:hash(ip),url,platform,state:'queued',percent:0,title:'',message:MESSAGES.queued,createdAt:now,expiresAt:now+600000};
  this.db.exec('BEGIN IMMEDIATE');try{this.save(j);this.db.prepare('INSERT INTO admissions VALUES(?,?)').run(hash(ip),now);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return {id:j.id,token};
 }
 finish(j,state,code){j.state=state;j.code=code||null;j.message=ERRORS[code]||MESSAGES[state];j.expiresAt=this.now()+3600000;j.leaseHash=null;if(state==='ready')j.percent=100;this.save(j);return j;}
 public(j){return {id:j.id,platform:j.platform,state:j.state,percent:j.percent,message:j.message,title:j.title,createdAt:new Date(j.createdAt).toISOString(),expiresAt:new Date(j.expiresAt).toISOString(),queuePosition:j.state==='queued'?this.all().filter(x=>x.state==='queued').findIndex(x=>x.id===j.id)+1:null,code:j.code||null};}
 blocked(platform){return (this.db.prepare('SELECT until FROM circuits WHERE platform=?').get(platform)?.until||0)>this.now();}
 block(platform){const now=this.now();this.db.prepare('INSERT INTO blocks VALUES(?,?)').run(platform,now);if(this.db.prepare('SELECT count(*) AS n FROM blocks WHERE platform=? AND at>?').get(platform,now-600000).n>=3)this.db.prepare('INSERT OR REPLACE INTO circuits VALUES(?,?)').run(platform,now+600000);}
 prune(){const now=this.now();this.db.prepare('DELETE FROM admissions WHERE at<=?').run(now-3600000);this.db.prepare('DELETE FROM blocks WHERE at<=?').run(now-600000);for(const j of this.all())if(j.expiresAt<=now&&TERMINAL.includes(j.state)){fs.rmSync(path.join(this.files,`${j.id}.mp3`),{force:true});this.db.prepare('DELETE FROM jobs WHERE id=?').run(j.id);}}
 close(){this.db.close();}
}
module.exports={Store,ACTIVE,TERMINAL,MESSAGES,ERRORS,hash,random};

