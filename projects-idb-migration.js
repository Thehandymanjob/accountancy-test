/* THA Projects IndexedDB repository — isolated migration prototype.
   This module writes only to a dedicated IndexedDB kv key. It never touches
   LocalStorage, the live app's Projects key, accounting, contracts, or backups.
*/
(function(root){
 "use strict";
 const KEY="__tha_idb_projects_migration_v1__";
 const TEST_KEY="__tha_idb_projects_migration_selftest_v1__";
 function api(){
  const a=root.HandymanStorageFoundation;
  if(!a||typeof a.get!=="function"||typeof a.set!=="function"||typeof a.remove!=="function")
   throw new Error("The test IndexedDB foundation is unavailable.");
  return a;
 }
 function validate(x){
  if(!x||typeof x!=="object"||Array.isArray(x))throw new Error("Projects payload must be an object.");
  if(!Array.isArray(x.projects)||!Array.isArray(x.workers))throw new Error("Projects and workers arrays are required.");
  for(const k of ["partners","contractors","companies","companyJobs"])
   if(x[k]!==undefined&&!Array.isArray(x[k]))throw new Error(k+" must be an array.");
  if(x.profile!==undefined&&(!x.profile||typeof x.profile!=="object"||Array.isArray(x.profile)))
   throw new Error("Projects profile must be an object.");
  return x;
 }
 async function readKey(key){return api().get(key)}
 async function writeKey(key,raw){
  await api().set(key,raw);
  const check=await api().get(key);
  if(check!==raw)throw new Error("IndexedDB read-back verification failed for "+key);
  return {ok:true,bytes:new Blob([raw]).size};
 }
 async function load(){const raw=await readKey(KEY);if(raw===null)return null;let x;try{x=JSON.parse(raw)}catch(e){throw new Error("IndexedDB Projects record is not valid JSON; it was not changed.")}return validate(x)}
 async function save(value){validate(value);const raw=JSON.stringify(value);if(typeof raw!=="string")throw new Error("Projects serialization failed.");return writeKey(KEY,raw)}
 async function restoreBackupObject(parsed){
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Backup root must be an object.");
  if(parsed.app!==undefined&&parsed.app!=="The Handyman Accountancy")throw new Error("This backup belongs to a different app.");
  if(parsed.backupType!==undefined&&parsed.backupType!=="complete-user-data")throw new Error("Unsupported backup type.");
  const candidate=validate(parsed.projects);
  const normalized=JSON.parse(JSON.stringify(candidate));
  normalized.projects=normalized.projects.map(p=>({...p,price:(Array.isArray(p.subprojects)?p.subprojects:[]).reduce((sum,s)=>sum+Math.max(0,Number(s&&s.price)||0),0)}));
  const raw=JSON.stringify(normalized);
  const previous=await readKey(KEY);
  try{
   const result=await writeKey(KEY,raw);
   const check=await load();
   if(JSON.stringify(check)!==raw)throw new Error("Imported Projects payload did not match its verified read-back.");
   return {ok:true,bytes:result.bytes,projects:check.projects.length,workers:check.workers.length,
    subprojects:check.projects.reduce((n,p)=>n+(Array.isArray(p.subprojects)?p.subprojects.length:0),0),
    previousRecordPreservedUntilVerified:true,appCutover:false,localStorageChanged:false};
  }catch(error){
   try{if(previous===null)await api().remove(KEY);else await writeKey(KEY,previous)}catch(rollbackError){
    throw new Error("Import failed and IndexedDB rollback could not be verified. Do not clear browser data. Original error: "+(error.message||error)+"; rollback: "+(rollbackError.message||rollbackError));
   }
   throw error;
  }
 }
 async function importFile(file){
  if(!file)throw new Error("Choose a backup JSON file first.");
  const parsed=JSON.parse(await file.text());
  if(!Object.prototype.hasOwnProperty.call(parsed,"projects")||parsed.projects===null)
   throw new Error("The selected backup does not contain Projects data.");
  return restoreBackupObject(parsed);
 }
 async function selfTest(){
  const before=await api().get(TEST_KEY);
  if(before!==null)throw new Error("Prototype self-test key is already occupied; refusing to overwrite it.");
  const photo="data:image/jpeg;base64,"+"A".repeat(6*1024*1024);
  const fixture={projects:[{id:"idb-test-project",name:"Synthetic test project",photo,subprojects:[{id:"sub-300",name:"Extra Job",price:300}]}],
   workers:[{id:"idb-test-worker",name:"Synthetic worker"}],partners:[],contractors:[],companies:[],companyJobs:[],profile:{businessName:"Synthetic test"}};
  const raw=JSON.stringify(fixture);let saved=false;
  try{
   await writeKey(TEST_KEY,raw);saved=true;
   const read=JSON.parse(await api().get(TEST_KEY));
   const checks={projectCount:read.projects.length===1,subprojectAmount:read.projects[0].subprojects[0].price===300,
    photoPayloadPreserved:read.projects[0].photo===photo,largePayloadBytes:new Blob([raw]).size};
   if(!checks.projectCount||!checks.subprojectAmount||!checks.photoPayloadPreserved)throw new Error("Large-payload round-trip test failed.");
   return {ok:true,checks,legacyLocalStorageChanged:false,liveProjectsChanged:false,appCutover:false};
  }finally{if(saved)await api().remove(TEST_KEY)}
 }
 root.HandymanProjectsIDBMigration={key:KEY,load,save,restoreBackupObject,importFile,selfTest};
})(window);
