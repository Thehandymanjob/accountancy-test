/* The Handyman Accountancy v250 — isolated IndexedDB Storage Repository.
   Design-stage adapter. Not referenced by index.html; no application cutover.
   It creates only the dedicated v250 database when explicitly opened by a test harness.
   It never reads, writes, migrates, or deletes LocalStorage.
*/
(function(root){
 "use strict";
 const DB_NAME="the_handyman_accountancy_v250_idb";
 const DB_VERSION=1;
 const STORE="records";
 const META="metadata";
 const SCHEMA_KEY="schema";
 const canonical=value=>{
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  return JSON.stringify(value);
 };
 const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
 const requestResult=req=>new Promise((resolve,reject)=>{
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error("IndexedDB request failed."));
 });
 const txDone=tx=>new Promise((resolve,reject)=>{
  tx.oncomplete=()=>resolve();
  tx.onabort=()=>reject(tx.error||new Error("IndexedDB transaction aborted."));
  tx.onerror=()=>reject(tx.error||new Error("IndexedDB transaction failed."));
 });
 const validName=value=>typeof value==="string"&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);
 const validKey=value=>typeof value==="string"&&value.length>0&&value.length<=512;
 function open(){
  return new Promise((resolve,reject)=>{
   if(!root.indexedDB)return reject(new Error("IndexedDB is unavailable."));
   const req=root.indexedDB.open(DB_NAME,DB_VERSION);
   req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains(STORE)){
     const records=db.createObjectStore(STORE,{keyPath:"id"});
     records.createIndex("domain","domain",{unique:false});
     records.createIndex("updatedAt","updatedAt",{unique:false});
    }
    if(!db.objectStoreNames.contains(META))db.createObjectStore(META,{keyPath:"key"});
   };
   req.onsuccess=()=>{
    const db=req.result;
    db.onversionchange=()=>db.close();
    resolve(db);
   };
   req.onerror=()=>reject(req.error||new Error("Could not open v250 IndexedDB."));
   req.onblocked=()=>reject(new Error("Database upgrade is blocked by another open tab."));
  });
 }
 function recordId(domain,key){return domain+"/"+key;}
 function validateValue(value){
  if(value===undefined)throw new Error("Undefined cannot be stored; use null explicitly.");
  const raw=JSON.stringify(value);
  if(typeof raw!=="string")throw new Error("Value is not JSON serializable.");
  return raw;
 }
 async function ready(){
  const db=await open();
  try{
   const tx=db.transaction([META],"readwrite"),done=txDone(tx),store=tx.objectStore(META);
   const old=await requestResult(store.get(SCHEMA_KEY));
   if(old&&old.version!==1)throw new Error("Unexpected repository schema metadata version.");
   if(!old)store.put({key:SCHEMA_KEY,version:1,database:DB_NAME,createdAt:new Date().toISOString()});
   await done;
   return {ok:true,database:DB_NAME,schemaVersion:DB_VERSION,appDataSchemaVersion:1};
  }finally{db.close();}
 }
 async function get(domain,key){
  if(!validName(domain)||!validKey(key))throw new Error("Invalid domain or record key.");
  const db=await open();
  try{
   const tx=db.transaction([STORE],"readonly"),done=txDone(tx);
   const row=await requestResult(tx.objectStore(STORE).get(recordId(domain,key)));
   await done;
   if(!row)return null;
   const value=JSON.parse(row.raw);
   return clone(value);
  }finally{db.close();}
 }
 async function put(domain,key,value){
  if(!validName(domain)||!validKey(key))throw new Error("Invalid domain or record key.");
  const raw=validateValue(value),id=recordId(domain,key),updatedAt=new Date().toISOString();
  const db=await open();
  try{
   const tx=db.transaction([STORE],"readwrite"),done=txDone(tx);
   tx.objectStore(STORE).put({id,domain,key,raw,updatedAt,byteLength:new Blob([raw]).size});
   await done;
   const verifyTx=db.transaction([STORE],"readonly"),verifyDone=txDone(verifyTx);
   const saved=await requestResult(verifyTx.objectStore(STORE).get(id));
   await verifyDone;
   if(!saved||saved.raw!==raw)throw new Error("IndexedDB read-back verification failed for "+id);
   return {ok:true,domain,key,byteLength:saved.byteLength,updatedAt};
  }finally{db.close();}
 }
 async function remove(domain,key){
  if(!validName(domain)||!validKey(key))throw new Error("Invalid domain or record key.");
  const id=recordId(domain,key),db=await open();
  try{
   const tx=db.transaction([STORE],"readwrite"),done=txDone(tx);
   tx.objectStore(STORE).delete(id);await done;
   const check=db.transaction([STORE],"readonly"),checkDone=txDone(check);
   const row=await requestResult(check.objectStore(STORE).get(id));await checkDone;
   if(row)throw new Error("IndexedDB delete verification failed for "+id);
   return {ok:true,removed:true,domain,key};
  }finally{db.close();}
 }
 async function transact(writes){
  if(!Array.isArray(writes)||writes.length===0)throw new Error("A non-empty writes array is required.");
  const prepared=writes.map(item=>{
   if(!item||!validName(item.domain)||!validKey(item.key))throw new Error("Invalid transaction record descriptor.");
   return {id:recordId(item.domain,item.key),domain:item.domain,key:item.key,raw:validateValue(item.value)};
  });
  const ids=new Set();for(const item of prepared){if(ids.has(item.id))throw new Error("Duplicate key in transaction: "+item.id);ids.add(item.id);}
  const db=await open();
  try{
   const tx=db.transaction([STORE],"readwrite"),done=txDone(tx),store=tx.objectStore(STORE),stamp=new Date().toISOString();
   for(const item of prepared)store.put({...item,updatedAt:stamp,byteLength:new Blob([item.raw]).size});
   await done;
   const verify=db.transaction([STORE],"readonly"),verifyDone=txDone(verify),read=verify.objectStore(STORE);
   for(const item of prepared){const row=await requestResult(read.get(item.id));if(!row||row.raw!==item.raw)throw new Error("Atomic transaction read-back failed for "+item.id);}
   await verifyDone;
   return {ok:true,written:prepared.length,updatedAt:stamp};
  }finally{db.close();}
 }
 async function snapshot(domains){
  if(!Array.isArray(domains)||domains.some(x=>!validName(x)))throw new Error("domains must be an array of valid names.");
  const db=await open();
  try{
   const tx=db.transaction([STORE],"readonly"),done=txDone(tx),rows=await requestResult(tx.objectStore(STORE).getAll());
   await done;
   const selected=rows.filter(row=>domains.includes(row.domain)).sort((a,b)=>a.id.localeCompare(b.id));
   return {format:"tha-idb-repository-snapshot-v1",database:DB_NAME,createdAt:new Date().toISOString(),
    domains:[...domains],records:selected.map(row=>({domain:row.domain,key:row.key,value:JSON.parse(row.raw)}))};
  }finally{db.close();}
 }
 async function restore(snapshotValue){
  if(!snapshotValue||snapshotValue.format!=="tha-idb-repository-snapshot-v1"||
     !Array.isArray(snapshotValue.domains)||!Array.isArray(snapshotValue.records))
   throw new Error("Unsupported repository snapshot.");
  const domains=snapshotValue.domains;
  if(domains.some(x=>!validName(x))||new Set(domains).size!==domains.length)
   throw new Error("Snapshot contains invalid or duplicate domains.");
  const writes=snapshotValue.records.map(row=>{
   if(!row||!domains.includes(row.domain)||!validKey(row.key))
    throw new Error("Snapshot record is outside its declared domains or has an invalid key.");
   return {id:recordId(row.domain,row.key),domain:row.domain,key:row.key,raw:validateValue(row.value)};
  });
  const ids=new Set();
  for(const row of writes){if(ids.has(row.id))throw new Error("Duplicate key in snapshot: "+row.id);ids.add(row.id);}
  const db=await open();
  try{
   const tx=db.transaction([STORE],"readwrite"),done=txDone(tx),store=tx.objectStore(STORE);
   const existing=await requestResult(store.getAll());
   for(const row of existing){if(domains.includes(row.domain))store.delete(row.id);}
   const stamp=new Date().toISOString();
   for(const row of writes)store.put({...row,updatedAt:stamp,byteLength:new Blob([row.raw]).size});
   await done;
   const verify=db.transaction([STORE],"readonly"),verifyDone=txDone(verify);
   const saved=await requestResult(verify.objectStore(STORE).getAll());
   await verifyDone;
   const actual=saved.filter(row=>domains.includes(row.domain)).sort((a,b)=>a.id.localeCompare(b.id));
   const expected=writes.slice().sort((a,b)=>a.id.localeCompare(b.id));
   if(actual.length!==expected.length||actual.some((row,i)=>row.id!==expected[i].id||row.raw!==expected[i].raw))
    throw new Error("Snapshot restore verification failed; restored domain contents do not match snapshot.");
   return {ok:true,written:writes.length,domains:domains.slice(),updatedAt:stamp,emptySnapshot:writes.length===0};
  }finally{db.close();}
 }
 async function health(){
  const db=await open();
  try{
   const tx=db.transaction([STORE,META],"readonly"),done=txDone(tx);
   const [rows,meta]=await Promise.all([
    requestResult(tx.objectStore(STORE).getAll()),
    requestResult(tx.objectStore(META).get(SCHEMA_KEY))
   ]);
   await done;
   const counts={};for(const row of rows)counts[row.domain]=(counts[row.domain]||0)+1;
   return {ok:true,database:DB_NAME,schemaVersion:DB_VERSION,appDataSchemaVersion:meta?meta.version:null,
    totalRecords:rows.length,counts};
  }finally{db.close();}
 }
 async function selfTest(){
  const domain="repository_test",key="roundtrip",existing=await get(domain,key);
  if(existing!==null)throw new Error("Self-test key is occupied; refusing to overwrite it.");
  const fixture={zero:0,blank:"",nil:null,flag:false,nested:[{id:"a",unknown:{keep:true}},[1,null,"x"]]};
  const checks={ready:false,roundTrip:false,atomicBatch:false,snapshotRestore:false,restoreRemovesStaleRecords:false,restorePreservesOtherDomains:false,emptySnapshotRestore:false,cleanup:false};
  try{
   await ready();checks.ready=true;
   await put(domain,key,fixture);
   const loaded=await get(domain,key);
   checks.roundTrip=canonical(loaded)===canonical(fixture);
   if(!checks.roundTrip)throw new Error("Round-trip test failed.");
   const batch=[{domain,key:"batch-a",value:{v:1}},{domain,key:"batch-b",value:{v:2}}];
   const result=await transact(batch);
   checks.atomicBatch=result.ok&&canonical(await get(domain,"batch-a"))===canonical({v:1})&&canonical(await get(domain,"batch-b"))===canonical({v:2});
   if(!checks.atomicBatch)throw new Error("Atomic batch test failed.");
   await put("unrelated_test","keep",{untouched:true});
   await put(domain,"stale-record",{mustBeRemoved:true});
   const snap=await snapshot([domain]);
   const restoreResult=await restore(snap);
   checks.snapshotRestore=restoreResult.ok&&canonical(await get(domain,key))===canonical(fixture);
   if(!checks.snapshotRestore)throw new Error("Snapshot restore test failed.");
   checks.restoreRemovesStaleRecords=(await get(domain,"stale-record"))===null;
   if(!checks.restoreRemovesStaleRecords)throw new Error("Restore did not remove stale records in declared domain.");
   checks.restorePreservesOtherDomains=canonical(await get("unrelated_test","keep"))===canonical({untouched:true});
   if(!checks.restorePreservesOtherDomains)throw new Error("Restore modified a record outside declared domains.");
   const emptyRestore=await restore({format:"tha-idb-repository-snapshot-v1",database:DB_NAME,domains:[domain],records:[]});
   checks.emptySnapshotRestore=emptyRestore.ok&&emptyRestore.written===0&&emptyRestore.emptySnapshot===true&&(await get(domain,key))===null;
   if(!checks.emptySnapshotRestore)throw new Error("Empty snapshot restore did not clear its declared domain.");
   await remove(domain,key);await remove(domain,"batch-a");await remove(domain,"batch-b");
   await remove("unrelated_test","keep");
   checks.cleanup=(await get(domain,key))===null&&(await get(domain,"batch-a"))===null&&(await get(domain,"batch-b"))===null&&(await get("unrelated_test","keep"))===null;
   if(!checks.cleanup)throw new Error("Self-test cleanup failed.");
   return {ok:true,database:DB_NAME,schemaVersion:DB_VERSION,checks,localStorageAccessed:false,appCutover:false};
  }catch(error){
   // Do not silently delete partial test evidence if a check fails.
   return {ok:false,database:DB_NAME,checks,error:String(error&&error.message||error),cleanupAttempted:false,appCutover:false};
  }
 }
 root.HandymanStorageRepository=Object.freeze({databaseName:DB_NAME,schemaVersion:DB_VERSION,ready,get,put,remove,transact,snapshot,restore,health,selfTest});
})(window);
