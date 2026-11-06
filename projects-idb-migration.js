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
  // Preserve the backup's Projects object byte-for-byte at the JSON data level.
  // Price normalization is deliberately deferred until the app's own restore
  // rules are applied; this lab must not alter the £300/sub-project evidence.
  const preserved=JSON.parse(JSON.stringify(candidate));
  const raw=JSON.stringify(preserved);
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


// Normalized workspace repository: one add-only transaction across all stores.
(function(root){
 "use strict";
 const map={projects:"projects",workers:"workers",partners:"partners",contractors:"contractors",companies:"companies",companyJobs:"companyJobs"};
 const profileId="__tha_projects_profile_v1__",stateId="__tha_projects_workspace_state_v1__",manifestId="__tha_projects_workspace_manifest_v1__";
 function api(){const a=root.HandymanStorageFoundation;if(!a||!a.bulkAddAcrossStores||!a.getAllRecords)throw Error("IndexedDB repository API unavailable");return a;}
 function prepare(x){
  if(!x||typeof x!=="object"||Array.isArray(x)||!Array.isArray(x.projects)||!Array.isArray(x.workers))throw Error("Projects and workers arrays are required.");
  for(const k of ["partners","contractors","companies","companyJobs"])if(x[k]!==undefined&&!Array.isArray(x[k]))throw Error(k+" must be an array.");
  const out={};
  for(const k of Object.keys(map)){out[map[k]]=(x[k]||[]).map((r,i)=>{if(!r||typeof r!=="object"||Array.isArray(r)||(typeof r.id!=="string"&&!(typeof r.id==="number"&&Number.isFinite(r.id)))||String(r.id).trim()==="")throw Error(k+" record "+i+" has no valid id");return JSON.parse(JSON.stringify(r));});}
  const meta=[];if(x.profile!==undefined){if(!x.profile||typeof x.profile!=="object"||Array.isArray(x.profile))throw Error("Invalid profile");meta.push({id:profileId,kind:"projects-profile",value:JSON.parse(JSON.stringify(x.profile))});}
  const workspaceState={};for(const [k,v] of Object.entries(x))if(!Object.prototype.hasOwnProperty.call(map,k)&&k!=="profile")workspaceState[k]=JSON.parse(JSON.stringify(v));
  meta.push({id:stateId,kind:"projects-workspace-state",value:workspaceState});
  const counts={};for(const k of Object.keys(map))counts[map[k]]=out[map[k]].length;
  meta.push({id:manifestId,kind:"projects-workspace-manifest",schema:1,counts,subprojectCount:x.projects.reduce((n,p)=>n+(Array.isArray(p.subprojects)?p.subprojects.length:0),0),createdAt:new Date().toISOString()});
  out.projectMetadata=meta;return out;
 }
 async function importWorkspace(x){const rows=prepare(x),r=await api().bulkAddAcrossStores(rows);return {ok:true,atomic:r.atomic,appCutover:false,localStorageChanged:false,backupChanged:false,written:r.written,verification:r.verification,subprojects:x.projects.reduce((n,p)=>n+(Array.isArray(p.subprojects)?p.subprojects.length:0),0)};}
 async function importBackupFile(file){if(!file)throw Error("Select a backup JSON file");const b=JSON.parse(await file.text());if(!b||typeof b!=="object"||Array.isArray(b))throw Error("Invalid backup root");if(b.app!==undefined&&b.app!=="The Handyman Accountancy")throw Error("Backup belongs to another app");if(b.backupType!==undefined&&b.backupType!=="complete-user-data")throw Error("Unsupported backup type");return importWorkspace(b.projects);}
 async function readSummary(){const a=api(),o={ok:true,appCutover:false,stores:{}};for(const s of [...Object.values(map),"projectMetadata"]){const r=await a.getAllRecords(s);o.stores[s]={count:r.length,ids:r.map(x=>x.id)};}const p=await a.getAllRecords("projects");o.subprojects=p.reduce((n,x)=>n+(Array.isArray(x.subprojects)?x.subprojects.length:0),0);o.manifest=o.stores.projectMetadata.ids.includes(manifestId);return o;}
 async function selfTest(){
  const suffix=Date.now()+"_"+Math.random().toString(36).slice(2),projectId="__tha_idb_project_test__"+suffix,workerId="__tha_idb_worker_test__"+suffix;
  const metaId="__tha_idb_meta_test__"+suffix,collisionProjectId="__tha_idb_collision_project__"+suffix,collisionWorkerId="__tha_idb_collision_worker__"+suffix,photo="data:image/jpeg;base64,"+"A".repeat(6*1024*1024);
  const fixture={projects:[{id:projectId,name:"Synthetic IndexedDB test",photo,subprojects:[{id:"sub-300",name:"Extra Job",price:300}]}],
   workers:[{id:workerId,name:"Synthetic worker"}],partners:[],contractors:[],companies:[],companyJobs:[],current:projectId,currentSubproject:"sub-300",guide:"fa"};
  const rows=prepare(fixture);rows.projectMetadata=rows.projectMetadata.filter(x=>x.id!==manifestId&&x.id!==stateId);
  rows.projectMetadata.push({id:metaId,kind:"test-fixture"});
  let committed=false;
  try{
   const result=await api().bulkAddAcrossStores(rows);committed=true;
   const p=await api().getRecord("projects",projectId);
   const state=await api().getRecord("projectMetadata",stateId);
   const checks={atomicWrite:result.atomic,photoPreserved:!!p&&p.photo===photo,subprojectAmountPreserved:!!p&&p.subprojects[0].price===300,workerPreserved:!!(await api().getRecord("workers",workerId)),workspaceStatePreserved:!!state&&state.value.current===projectId&&state.value.currentSubproject==="sub-300"&&state.value.guide==="fa"};
   if(!checks.photoPreserved||!checks.subprojectAmountPreserved||!checks.workerPreserved||!checks.workspaceStatePreserved)throw Error("Normalized Projects self-test failed");
   const sentinel={id:collisionProjectId,marker:"existing-record-must-survive"};await api().putRecord("projects",sentinel);
   let collisionRejected=false;try{await api().bulkAddAcrossStores({projects:[{id:collisionProjectId,marker:"overwrite-attempt"}],workers:[{id:collisionWorkerId,name:"must-not-commit"}]});}catch(_){collisionRejected=true;}
   const afterCollision=await api().getRecord("projects",collisionProjectId),partial=await api().getRecord("workers",collisionWorkerId);
   checks.duplicateCollisionRejected=collisionRejected;checks.atomicRollbackOnCollision=!!afterCollision&&afterCollision.marker===sentinel.marker&&partial===null;
   await api().deleteRecord("projects",collisionProjectId);
   if(!checks.duplicateCollisionRejected||!checks.atomicRollbackOnCollision)throw Error("Atomic collision rollback test failed");
   return {ok:true,checks,legacyLocalStorageChanged:false,liveDataChanged:false,appCutover:false,bytes:new Blob([JSON.stringify(fixture)]).size};
  }finally{
   if(committed){for(const [store,ids] of [["projects",[projectId]],["workers",[workerId]],["projectMetadata",[metaId]]])for(const id of ids)await api().deleteRecord(store,id);}
  }
 }
 root.HandymanProjectsIDBRepository=Object.freeze({prepare,importWorkspace,importBackupFile,readSummary,selfTest,stores:Object.values(map)});
})(window);
