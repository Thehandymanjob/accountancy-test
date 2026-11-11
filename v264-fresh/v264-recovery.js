/* THA v264 portable backup / restore / factory reset.
   Export is a standalone file. Reset is fail-closed and requires re-selecting that file.
   IndexedDB records are never cleared by merely creating or downloading a backup.
*/
(function(root){
 "use strict";
 const FORMAT="tha-v264-portable-backup-v1";
 const SNAPSHOT_FORMAT="tha-v264-indexeddb-snapshot-v1";

 const bytesToBase64=bytes=>{
  let binary="";
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+step,bytes.length)));
  return btoa(binary);
 };
 const base64ToBytes=value=>{
  if(typeof value!=="string"||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error("Invalid base64 binary data in backup.");
  const binary=atob(value),out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
 };
 async function encode(value,seen){
  if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number")return value;
  if(typeof value==="undefined")return {$tha:"Undefined"};
  if(typeof value==="bigint")return {$tha:"BigInt",value:String(value)};
  if(typeof value==="function"||typeof value==="symbol")throw new Error("Backup contains an unsupported function or symbol.");
  if(seen.has(value))throw new Error("Backup contains a circular reference; export stopped to prevent data loss.");
  seen.add(value);
  try{
   if(value instanceof Date)return {$tha:"Date",value:value.toISOString()};
   if(typeof root.File!=="undefined"&&value instanceof root.File){
    const data=new Uint8Array(await value.arrayBuffer());
    return {$tha:"File",name:value.name,type:value.type,lastModified:value.lastModified,data:bytesToBase64(data)};
   }
   if(value instanceof Blob){
    const data=new Uint8Array(await value.arrayBuffer());
    return {$tha:"Blob",type:value.type,data:bytesToBase64(data)};
   }
   if(value instanceof ArrayBuffer)return {$tha:"ArrayBuffer",data:bytesToBase64(new Uint8Array(value))};
   if(ArrayBuffer.isView(value)){
    const name=value.constructor.name;
    const allowed=["Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Uint16Array","Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array","DataView"];
    if(!allowed.includes(name))throw new Error("Unsupported typed array in backup: "+name);
    return {$tha:"TypedArray",type:name,data:bytesToBase64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
   }
   if(Array.isArray(value))return await Promise.all(value.map(v=>encode(v,seen)));
   const proto=Object.getPrototypeOf(value);
   if(proto!==Object.prototype&&proto!==null)throw new Error("Unsupported object type in backup: "+(value.constructor&&value.constructor.name||"unknown"));
   const out={};
   for(const key of Object.keys(value))out[key]=await encode(value[key],seen);
   return out;
  }finally{seen.delete(value);}
 }
 async function decode(value){
  if(value===null||typeof value!=="object")return value;
  if(Array.isArray(value))return Promise.all(value.map(decode));
  if(value.$tha){
   const tag=value.$tha;
   if(tag==="Undefined")return undefined;
   if(tag==="BigInt")return BigInt(value.value);
   if(tag==="Date"){const d=new Date(value.value);if(!Number.isFinite(d.getTime()))throw new Error("Invalid Date in backup.");return d;}
   if(tag==="Blob")return new Blob([base64ToBytes(value.data)],{type:value.type||""});
   if(tag==="File"){
    if(typeof root.File!=="function")throw new Error("This browser cannot restore File objects.");
    return new File([base64ToBytes(value.data)],String(value.name||"file"),{type:value.type||"",lastModified:Number(value.lastModified)||0});
   }
   if(tag==="ArrayBuffer")return base64ToBytes(value.data).buffer;
   if(tag==="TypedArray"){
    const bytes=base64ToBytes(value.data),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const constructors={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView};
    if(typeof BigInt64Array!=="undefined")constructors.BigInt64Array=BigInt64Array;
    if(typeof BigUint64Array!=="undefined")constructors.BigUint64Array=BigUint64Array;
    const C=constructors[value.type];if(!C)throw new Error("Unsupported typed array constructor in backup.");
    if(value.type!=="DataView"&&buffer.byteLength%C.BYTES_PER_ELEMENT!==0)throw new Error("Typed array byte length is invalid.");
    return new C(buffer);
   }
   throw new Error("Unknown tagged value in backup: "+tag);
  }
  const out={};for(const key of Object.keys(value))out[key]=await decode(value[key]);return out;
 }
 async function digest(text){
  if(!root.crypto||!root.crypto.subtle)throw new Error("SHA-256 verification is unavailable in this browser; backup operation is blocked.");
  const hash=await root.crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,"0")).join("");
 }
 const canonical=value=>JSON.stringify(value);
 function create(engine,adapter,scopeName){
  if(!engine||!adapter)throw new Error("Storage engine and application adapter are required.");
  const DB=engine.databaseName;
  if(typeof DB!=="string"||!DB)throw new Error("Storage engine database identity is unavailable.");
  const SCOPES=Object.freeze({
   accounting:["accounting","sequences"],
   projects:["projects"],
   contracts:["contracts"],
   businessProfile:["business_profile"],
   support:["preferences","preference_meta","diagnostics","reports","report_notifications","report_settings","report_workflow","notifications","recovery","factory_reset_recovery","help_contact_drafts"],
   media:["media"]
  });
  if(!Object.prototype.hasOwnProperty.call(SCOPES,scopeName))throw new Error("A single supported application domain must be selected for backup or restore.");
  const allowed=SCOPES[scopeName].slice().sort();
  function assertScope(pkg){
   if(!pkg||pkg.format!==SNAPSHOT_FORMAT||pkg.database!==DB||!Array.isArray(pkg.domains)||!Array.isArray(pkg.records))throw new Error("Invalid v264 scoped backup.");
   const actual=[...pkg.domains].sort();
   if(actual.length!==allowed.length||actual.some((d,i)=>d!==allowed[i]))throw new Error("Backup does not match the selected independent domain: "+scopeName+".");
   for(const row of pkg.records)if(!row||!allowed.includes(row.domain))throw new Error("Backup contains a record outside the selected domain.");
   return pkg;
  }
  async function capture(){
   await adapter.initialize();
   const snapshot=assertScope(await adapter.backup(scopeName));
   const ids=new Set();
   for(const row of snapshot.records){
    const id=row.domain+":"+encodeURIComponent(row.key);
    if(row.id!==id||ids.has(id))throw new Error("Scoped backup contains an invalid or duplicate record identity.");
    ids.add(id);
   }
   return snapshot;
  }
  async function packageSnapshot(snapshot){
   assertScope(snapshot);
   const payload={format:SNAPSHOT_FORMAT,database:DB,scope:scopeName,createdAt:snapshot.createdAt,domains:snapshot.domains,records:[]};
   for(const row of snapshot.records)payload.records.push({id:row.id,domain:row.domain,key:row.key,value:await encode(row.value,new WeakSet())});
   const body=canonical(payload);
   return {format:FORMAT,algorithm:"SHA-256",digest:await digest(body),payload};
  }
  async function verifyPackage(pkg){
   if(!pkg||pkg.format!==FORMAT||pkg.algorithm!=="SHA-256"||typeof pkg.digest!=="string"||!pkg.payload)throw new Error("This is not a supported v264 domain backup.");
   const actual=await digest(canonical(pkg.payload));
   if(actual!==pkg.digest)throw new Error("Backup integrity check failed: SHA-256 does not match.");
   const p=pkg.payload;
   if(p.format!==SNAPSHOT_FORMAT||p.database!==DB||p.scope!==scopeName||!Array.isArray(p.domains)||!Array.isArray(p.records))throw new Error("Backup scope or database identity is invalid.");
   const domains=[...p.domains].sort();
   if(domains.length!==allowed.length||domains.some((d,i)=>d!==allowed[i]))throw new Error("Backup belongs to a different independent domain.");
   const ids=new Set();
   for(const row of p.records){
    if(!row||typeof row.domain!=="string"||typeof row.key!=="string"||!allowed.includes(row.domain))throw new Error("Backup contains a record outside its selected domain.");
    const id=row.domain+":"+encodeURIComponent(row.key);
    if(row.id!==id||ids.has(id))throw new Error("Backup record identity is invalid or duplicated.");
    ids.add(id);
   }
   return {ok:true,scope:scopeName,algorithm:"SHA-256",digest:actual,domains:domains.length,records:p.records.length,createdAt:p.createdAt};
  }
  async function createBackup(){
   const snapshot=await capture(),pkg=await packageSnapshot(snapshot);
   const check=await verifyPackage(pkg);
   if(check.records!==snapshot.records.length)throw new Error("Domain backup record-count verification failed.");
   const blob=new Blob([JSON.stringify(pkg)],{type:"application/vnd.thehandyman.v264-domain-backup+json"});
   return {ok:true,blob,filename:"THA-v264-"+scopeName+"-backup-"+new Date().toISOString().replace(/[:.]/g,"-")+".json",verification:check};
  }
  async function readFile(file){
   if(!file||typeof file.text!=="function")throw new Error("Select a valid domain backup file from the Files app.");
   let pkg;try{pkg=JSON.parse(await file.text());}catch(_){throw new Error("The selected file is not valid backup JSON.");}
   const verification=await verifyPackage(pkg),records=[];
   for(const row of pkg.payload.records)records.push({domain:row.domain,key:row.key,value:await decode(row.value)});
   return {pkg,verification,snapshot:{format:SNAPSHOT_FORMAT,database:DB,createdAt:pkg.payload.createdAt,domains:pkg.payload.domains,records}};
  }
  async function inspectFile(file){const parsed=await readFile(file);return {ok:true,...parsed.verification};}
  async function restoreFromFile(file){
   const parsed=await readFile(file);
   const result=await adapter.restore(scopeName,parsed.snapshot);
   const after=assertScope(await adapter.backup(scopeName));
   const afterPkg=await packageSnapshot(after);
   const afterData={...afterPkg.payload};delete afterData.createdAt;
   const expectedData={...parsed.pkg.payload};delete expectedData.createdAt;
   if(await digest(canonical(afterData))!==await digest(canonical(expectedData)))throw new Error("Scoped restore verification failed: restored records do not exactly match the selected backup.");
   return {ok:true,restored:result.restored??after.records.length,domains:allowed.length,verified:true,scope:scopeName};
  }
  async function downloadBackup(){
   const result=await createBackup(),url=URL.createObjectURL(result.blob),a=root.document.createElement("a");
   a.href=url;a.download=result.filename;a.style.display="none";root.document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
   return {ok:true,scope:scopeName,filename:result.filename,verification:result.verification,instructions:"Save this domain-specific file in the iPhone Files app. Restore it only with the same domain selected."};
  }
  async function resetFromBackupFile(){throw new Error("Global Factory Reset is disabled. Domain backups can restore only their selected domain.");}
  return Object.freeze({scope:scopeName,domains:allowed,createBackup,downloadBackup,inspectFile,restoreFromFile,resetFromBackupFile,verifyPackage});
 }

 const FULL_DOMAINS=["accounting","business_profile","contracts","diagnostics","factory_reset_recovery","help_contact_drafts","media","notifications","preference_meta","preferences","projects","recovery","report_notifications","report_settings","report_workflow","reports","sequences"].sort();
 function createFull(engine){
  if(!engine||typeof engine.snapshot!=="function"||typeof engine.restore!=="function"||typeof engine.beginResetLock!=="function"||typeof engine.clearWhileResetLocked!=="function"||typeof engine.completeRecovery!=="function")throw new Error("Full IndexedDB recovery engine is unavailable.");
  const DB=engine.databaseName;
  async function capture(){
   const snap=await engine.snapshot(FULL_DOMAINS);
   if(!snap||snap.format!==SNAPSHOT_FORMAT||snap.database!==DB||!Array.isArray(snap.records))throw new Error("Full database snapshot is invalid.");
   const ids=new Set();
   for(const row of snap.records){
    if(!row||!FULL_DOMAINS.includes(row.domain)||typeof row.key!=="string"||row.id!==row.domain+":"+encodeURIComponent(row.key)||ids.has(row.id))throw new Error("Full snapshot contains an invalid or duplicate record.");
    ids.add(row.id);
   }
   return snap;
  }
  async function packageSnapshot(snap){
   const payload={format:SNAPSHOT_FORMAT,database:DB,scope:"full",createdAt:snap.createdAt,domains:FULL_DOMAINS,records:[]};
   for(const row of snap.records)payload.records.push({id:row.id,domain:row.domain,key:row.key,value:await encode(row.value,new WeakSet())});
   const body=canonical(payload);
   return {format:"tha-v264-full-backup-v1",algorithm:"SHA-256",digest:await digest(body),payload};
  }
  async function readFile(file){
   if(!file||typeof file.text!=="function")throw new Error("Select the complete full-database backup file.");
   let pkg;try{pkg=JSON.parse(await file.text())}catch(_){throw new Error("The selected file is not valid backup JSON.")};
   if(!pkg||pkg.format!=="tha-v264-full-backup-v1"||pkg.algorithm!=="SHA-256"||!pkg.payload||typeof pkg.digest!=="string")throw new Error("This is not a supported full database backup.");
   const p=pkg.payload;
   if(await digest(canonical(p))!==pkg.digest)throw new Error("Full backup SHA-256 integrity check failed.");
   if(p.format!==SNAPSHOT_FORMAT||p.database!==DB||p.scope!=="full"||!Array.isArray(p.domains)||p.domains.slice().sort().join("|")!==FULL_DOMAINS.join("|")||!Array.isArray(p.records))throw new Error("Backup database identity or full-domain coverage is invalid.");
   const ids=new Set(),records=[];
   for(const row of p.records){
    if(!row||!FULL_DOMAINS.includes(row.domain)||typeof row.key!=="string"||row.id!==row.domain+":"+encodeURIComponent(row.key)||ids.has(row.id))throw new Error("Backup has an invalid, duplicate or out-of-scope record.");
    ids.add(row.id);records.push({id:row.id,domain:row.domain,key:row.key,value:await decode(row.value)});
   }
   return {pkg,snapshot:{format:SNAPSHOT_FORMAT,database:DB,createdAt:p.createdAt,domains:FULL_DOMAINS,records},verification:{ok:true,scope:"full",database:DB,domains:FULL_DOMAINS.length,records:records.length,digest:pkg.digest,createdAt:p.createdAt}};
  }
  async function createBackup(){
   const snap=await capture(),pkg=await packageSnapshot(snap),check=(await readFile({text:async()=>JSON.stringify(pkg)})).verification;
   if(check.records!==snap.records.length)throw new Error("Full backup record-count verification failed.");
   return {ok:true,blob:new Blob([JSON.stringify(pkg)],{type:"application/vnd.thehandyman.v264-full-backup+json"}),filename:"THA-v264-FULL-backup-"+new Date().toISOString().replace(/[:.]/g,"-")+".json",verification:check};
  }
  async function downloadBackup(){
   const result=await createBackup(),url=URL.createObjectURL(result.blob),a=root.document.createElement("a");
   a.href=url;a.download=result.filename;a.style.display="none";root.document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   return {ok:true,filename:result.filename,verification:result.verification,instructions:"Save this complete backup in the iPhone Files app, then select that exact file in the reset confirmation."};
  }
  async function inspectFile(file){const parsed=await readFile(file);return parsed.verification}
  async function restoreFromFile(file){
   const parsed=await readFile(file);
   const result=await engine.restore(parsed.snapshot);
   const after=await capture();
   if(after.records.length!==parsed.snapshot.records.length)throw new Error("Full restore verification failed: record count differs.");
   for(let i=0;i<after.records.length;i++){
    const a=after.records[i],b=parsed.snapshot.records.slice().sort((x,y)=>x.id.localeCompare(y.id))[i];
    if(a.id!==b.id||!(await engine.valuesEqual(a.value,b.value)))throw new Error("Full restore verification failed at "+b.domain+"/"+b.key);
   }
   return {ok:true,restored:result.restored??after.records.length,domains:FULL_DOMAINS.length,verified:true};
  }
  async function resetFromBackupFile(file){
   const parsed=await readFile(file);
   if(!parsed.verification.ok)throw new Error("Full backup verification failed; reset blocked.");
   const before=await capture(),expected=parsed.snapshot.records.slice().sort((a,b)=>a.id.localeCompare(b.id));
   if(before.records.length!==expected.length)throw new Error("The selected backup does not exactly match the current database; reset blocked.");
   for(let i=0;i<before.records.length;i++){
    if(before.records[i].id!==expected[i].id||!(await engine.valuesEqual(before.records[i].value,expected[i].value)))throw new Error("The selected backup differs from current data at "+(expected[i]?.domain||"unknown")+"/"+(expected[i]?.key||"unknown")+"; reset blocked.");
   }
   await engine.beginResetLock();
   try{
    const locked=await engine.health();
    if(!locked||locked.resetLocked!==true)throw new Error("Persistent reset lock could not be verified.");
    await engine.clearWhileResetLocked();
    const empty={format:SNAPSHOT_FORMAT,database:DB,createdAt:new Date().toISOString(),domains:FULL_DOMAINS,records:[]};
    const restored=await engine.restore(empty);
    await engine.completeRecovery(empty);
    const health=await engine.health(),after=await capture();
    if(!health||health.resetLocked!==false||after.records.length!==0)throw new Error("Empty database verification failed; reset remains blocked.");
    return {ok:true,reset:true,backupVerified:true,domains:FULL_DOMAINS.length,previousRecords:before.records.length,remainingRecords:0,unlocked:true};
   }catch(error){throw new Error("Reset stopped safely. The database may remain locked and requires full-backup recovery: "+String(error&&error.message||error))}
  }
  return Object.freeze({domains:FULL_DOMAINS.slice(),createBackup,downloadBackup,inspectFile,restoreFromFile,resetFromBackupFile});
 }

 const engine=()=>root.HandymanStorageV264,adapter=()=>root.HandymanAppStorageV264;
 root.HandymanRecoveryV264=Object.freeze({build:"THA-264-SCOPED-RECOVERY-2-FULL",create:scopeName=>create(engine(),adapter(),scopeName),createFull:()=>createFull(engine()),createWithDependencies:create});
})(window);
