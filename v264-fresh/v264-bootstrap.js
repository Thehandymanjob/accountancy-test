/* THA v264 asynchronous application bootstrap.
   This is the only supported entry point for bringing v264 UI modules online.
   It waits for IndexedDB and every domain load before declaring the UI ready.
   It never reads, imports, or removes legacy browser storage.
*/
(function(root){
 "use strict";
 const BUILD="THA-264-ASYNC-BOOTSTRAP-1";
 let pending=null,readyState=null;
 function requireApi(name,method){
  const api=root[name];
  if(!api||typeof api[method]!=="function")throw new Error("Required v264 module is unavailable: "+name+"."+method);
  return api;
 }
 async function start(){
  if(pending)return pending;
  pending=(async()=>{
   const engine=requireApi("HandymanStorageV264","ready");
   const storage=requireApi("HandymanAppStorageV264","initialize");
   const initialized=await storage.initialize();
   if(!initialized||initialized.ok!==true||initialized.mode!=="indexeddb-only"||initialized.legacyImport!==false)throw new Error("v264 storage initialization did not meet the clean-database policy.");
   const health=await engine.health();
   if(!health||health.ok!==true||health.database!==engine.databaseName||health.resetLocked)throw new Error("v264 database health or reset-lock check failed.");
   const accounting=requireApi("HandymanAccountingV264","load");
   const projects=requireApi("HandymanProjectsV264","load");
   const contracts=requireApi("HandymanContractsV264","load");
   const profile=requireApi("HandymanBusinessProfileV264","load");
   const support=requireApi("HandymanSupportV264","load");
   const [accountingState,projectState,contractState,businessProfile,preferences]=await Promise.all([
    accounting.load(),projects.load(),contracts.load(),profile.load(),
    Promise.all(["preferences","preferenceMeta","diagnostics","reports","reportNotifications","reportSettings","reportWorkflow","notifications"].map(name=>support.load(name)))
   ]);
   const names=["preferences","preferenceMeta","diagnostics","reports","reportNotifications","reportSettings","reportWorkflow","notifications"];
   const supportState={};names.forEach((name,i)=>supportState[name]=preferences[i]);
   const invoiceWorkflow=requireApi("HandymanInvoiceWorkflowV264","saveInvoice");
   const recovery=requireApi("HandymanRecoveryV264","create");
   const result={
    ok:true,ready:true,build:BUILD,database:health.database,mode:"indexeddb-only",
    legacyImport:false,productionTouched:false,health,
    state:{accounting:accountingState,projects:projectState,contracts:contractState,businessProfile,support:supportState},
    capabilities:{accounting:true,projects:true,contracts:true,businessProfile:true,support:true,invoiceWorkflow:!!invoiceWorkflow,recovery:!!recovery}
   };
   readyState=Object.freeze(result);
   return readyState;
  })().catch(error=>{pending=null;readyState=null;throw error;});
  return pending;
 }
 function isReady(){return !!readyState;}
 function getState(){if(!readyState)throw new Error("v264 application bootstrap has not completed.");return readyState;}
 root.HandymanBootstrapV264=Object.freeze({build:BUILD,start,isReady,getState});
})(window);
