/* THA source-to-IndexedDB reconciliation — read-only diagnostic.
   Compares active LocalStorage payloads with normalized typed IndexedDB records.
   Never writes, imports, deletes, snapshots, or changes app storage. */
(function(root){
 "use strict";
 const LS={
  accounting:"tha_test226_accounting_v1",projects:"tha_test226_projects_v1",
  contracts:"tha_test226_contracts_v1",sequence:"tha_test226_invoice_sequence_v1",
  monitor:"tha_test226_monitor_log_v1",notifications:"tha_test226_report_notifications_v1",
  language:"tha_test226_app_language_v1",languageVersion:"tha_test226_app_language_pref_version_v1"
 };
 const canonical=v=>{
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  return JSON.stringify(v);
 };
 const parse=(key)=>{const raw=root.localStorage.getItem(key);if(raw===null)return {present:false,raw:null,value:null};try{return {present:true,raw,value:JSON.parse(raw)}}catch(_){return {present:true,raw,value:raw,plainString:true}}};
 const idOf=(v,i,prefix)=>String(v&&v.id!==undefined&&v.id!==null&&String(v.id).trim()!==""?v.id:"legacy-"+prefix+"-"+String(i+1).padStart(6,"0"));
 const compactIds=xs=>xs.slice(0,30);
 async function inspect(){
  const api=root.HandymanStorageFoundation;if(!api||!api.openDatabase)throw Error("IndexedDB foundation unavailable");
  const db=await api.openDatabase();
  try{
   const report={ok:true,diagnostic:"source-idb-reconciliation-v1",readOnly:true,willWrite:false,
    localStorageChanged:false,indexedDBChanged:false,appCutover:false,database:api.databaseName,schemaVersion:api.schemaVersion,
    domains:{},unmappedSources:[],notes:[]};
   const readStore=async name=>{const tx=db.transaction([name],"readonly"),req=tx.objectStore(name).getAll();return await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error||Error("Read failed: "+name));});};
   const compare=(label,store,sourceRows,opts={})=>{
    const existing=opts.existing||[];const keyFn=opts.keyFn||((x)=>String(x.id));
    const srcMap=new Map(),duplicates=[];
    sourceRows.forEach((x,i)=>{const k=keyFn(x,i);if(srcMap.has(k))duplicates.push(k);else srcMap.set(k,x);});
    const dbMap=new Map(existing.map((x)=>[String(x.id),x]));
    const missing=[],identical=[],conflicts=[];
    for(const [id,row] of srcMap){const prior=dbMap.get(id);if(!prior)missing.push(id);else if(canonical(prior)===canonical(row))identical.push(id);else conflicts.push(id);}
    const extra=[...dbMap.keys()].filter(id=>!srcMap.has(id));
    report.domains[label]={targetStore:store,sourceCount:sourceRows.length,targetCount:existing.length,
     exactMatches:identical.length,missingFromIndexedDB:missing.length,conflictingSameId:conflicts.length,
     extraInIndexedDB:extra.length,duplicateSourceIds:duplicates.length,
     missingIds:compactIds(missing),conflictingIds:compactIds(conflicts),extraIds:compactIds(extra),
     duplicateIds:compactIds(duplicates),comparison:"canonical full-record equality"};
   };
   const a=parse(LS.accounting),p=parse(LS.projects),c=parse(LS.contracts);
   if(a.present&&!a.plainString&&a.value&&typeof a.value==="object"){
    const d=a.value;
    for(const [field,store] of [["entries","accountingEntries"],["customers","customers"],["invoices","invoices"]]){
     const rows=Array.isArray(d[field])?d[field]:[];
     const normalized=rows.map((x,i)=>({...x,id:idOf(x,i,field.slice(0,-1))}));
     compare("accounting."+field,store,normalized,{existing:await readStore(store)});
    }
    const categories=Array.isArray(d.customExpenseCategories)?d.customExpenseCategories:[];
    const categoryRows=categories.map((name,i)=>({id:"legacy-category-"+String(i+1).padStart(6,"0"),name:String(name),position:i}));
    compare("accounting.customExpenseCategories","customExpenseCategories",categoryRows,{existing:await readStore("customExpenseCategories")});
    report.domains["accounting.settings"]={targetStore:"accountingSettings",sourceCount:d.settings?1:0,targetCount:(await readStore("accountingSettings")).length,
     status:"not compared; prior settings differences were explicitly accepted by user"};
   }else report.notes.push("Active Accounting LocalStorage payload missing or invalid; no content comparison performed.");
   if(p.present&&!p.plainString&&p.value&&typeof p.value==="object"){
    const d=p.value;
    for(const store of ["projects","workers","partners","contractors","companies","companyJobs"]){
     const rows=Array.isArray(d[store])?d[store]:[];
     compare("projects."+store,store,rows,{existing:await readStore(store)});
    }
    const profile=await readStore("projectMetadata"),profileRow=profile.find(x=>x.id==="__tha_projects_profile_v1__");
    const stateRow=profile.find(x=>x.id==="__tha_projects_workspace_state_v1__");
    const state={};for(const [k,v] of Object.entries(d))if(!["projects","workers","partners","contractors","companies","companyJobs","profile"].includes(k))state[k]=v;
    report.domains["projects.profile"]={targetStore:"projectMetadata",sourceCount:d.profile===undefined?0:1,targetPresent:!!profileRow,
     exactMatch:!!profileRow&&canonical(profileRow.value)===canonical(d.profile),status:"normalized profile metadata"};
    report.domains["projects.workspaceState"]={targetStore:"projectMetadata",sourceCount:1,targetPresent:!!stateRow,
     exactMatch:!!stateRow&&canonical(stateRow.value)===canonical(state),sourceFields:Object.keys(state).sort(),
     targetFields:stateRow&&stateRow.value&&typeof stateRow.value==="object"?Object.keys(stateRow.value).sort():[],status:"normalized workspace state"};
    const projectRows=Array.isArray(d.projects)?d.projects:[];
    report.domains["projects.subprojects"]={sourceCount:projectRows.reduce((n,x)=>n+(Array.isArray(x.subprojects)?x.subprojects.length:0),0),
     targetCount:(await readStore("projects")).reduce((n,x)=>n+(Array.isArray(x.subprojects)?x.subprojects.length:0),0),
     sourceIncomeCount:projectRows.reduce((n,x)=>n+(Array.isArray(x.subprojects)?x.subprojects.reduce((m,s)=>m+(Array.isArray(s.income)?s.income.length:0),0):0),0),
     targetIncomeCount:(await readStore("projects")).reduce((n,x)=>n+(Array.isArray(x.subprojects)?x.subprojects.reduce((m,s)=>m+(Array.isArray(s.income)?s.income.length:0),0):0),0),
     status:"counts only; project records above are compared in full including nested data and photos"};
   }else report.notes.push("Active Projects LocalStorage payload missing or invalid; no content comparison performed.");
   const contracts=await readStore("contracts");
   report.domains.contracts={activeLocalStoragePresent:c.present,activeSourceCount:c.present&&Array.isArray(c.value)?c.value.length:null,
    indexedDBCount:contracts.length,status:c.present?"requires record-level comparison":"active LocalStorage key absent; IndexedDB records may be older/imported; provenance unresolved"};
   const monitor=parse(LS.monitor),notifications=parse(LS.notifications);
   const audit=await readStore("auditLog");
   report.domains.monitorDiagnostics={localStoragePresent:monitor.present,localStorageCount:Array.isArray(monitor.value)?monitor.value.length:null,
    indexedDBAuditLogCount:audit.length,status:"not yet mapped; auditLog is not assumed to be equivalent to monitor log"};
   report.domains.reportNotifications={localStoragePresent:notifications.present,localStorageCount:Array.isArray(notifications.value)?notifications.value.length:null,
    status:"no dedicated typed store mapping yet"};
   const seq=parse(LS.sequence),order=await readStore("recordOrder"),seqRow=order.find(x=>x.id==="invoice-sequence");
   report.domains.invoiceSequence={localStoragePresent:seq.present,localStorageValue:seq.value,
    indexedDBPresent:!!seqRow,indexedDBValue:seqRow?seqRow.value:null,exactMatch:!!seqRow&&canonical(seqRow.value)===canonical(seq.value)};
   const lang=parse(LS.language),langV=parse(LS.languageVersion),kv=await readStore("kv");
   report.domains.language={localStoragePresent:lang.present,localStorageValue:lang.value,localStoragePrefVersion:langV.value,
    indexedDBKvCount:kv.length,status:"no approved typed mapping yet"};
   report.unmappedSources=["report archive/settings/workflow/email settings","support drafts","monitor log","language and preference version","factory-reset recovery snapshot","invoice cleanup flags","legacy/recovery namespace keys","contracts provenance"];
   report.summary={comparedDomains:Object.keys(report.domains).length,
    domainsWithMissingRecords:Object.values(report.domains).filter(x=>(x.missingFromIndexedDB||0)>0).length,
    domainsWithConflicts:Object.values(report.domains).filter(x=>(x.conflictingSameId||0)>0).length,
    domainsNotYetMapped:report.unmappedSources.length};
   report.notes.push("Full-record equality is intentionally strict. A differing normalized shape is reported as a conflict, not auto-merged.");
   report.safety="Read-only IndexedDB transactions and LocalStorage reads only. No snapshot, write, delete, import, export, or cutover.";
   return report;
  }finally{db.close();}
 }
 root.HandymanSourceIDBReconciliation=Object.freeze({inspect});
})(window);
