/* THA v264 accounting UI cutover bridge.
   Async-only boundary for the preserved accounting UI. No LocalStorage,
   SessionStorage, legacy import, shadow writes, or synchronous fake persistence.
*/
(function(root){
 "use strict";
 const controller=()=>{const api=root.HandymanAccountingV264;if(!api)throw new Error("v264 accounting controller is unavailable.");return api;};
 let initialized=false,writeTail=Promise.resolve(),lastState=null;
 const clone=value=>root.structuredClone(value);
 function assertState(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||!Array.isArray(value.entries)||!Array.isArray(value.customers)||!Array.isArray(value.invoices))throw new Error("Invalid accounting UI state.");
  return value;
 }
 async function initialize(){
  const state=assertState(await controller().initialize());
  lastState=clone(state);initialized=true;
  return {ok:true,mode:"indexeddb-only",legacyImport:false,state:clone(state)};
 }
 async function load(){
  if(!initialized)await initialize();
  const state=assertState(await controller().load());
  lastState=clone(state);
  return clone(state);
 }
 async function commit(nextState){
  if(!initialized)throw new Error("Accounting UI bridge must be initialized before the first write.");
  const candidate=assertState(clone(nextState));
  const operation=writeTail.then(async()=>{
   const result=await controller().save(candidate);
   if(!result||result.ok!==true)throw new Error("IndexedDB did not confirm the accounting state write.");
   const verified=assertState(await controller().load());
   const equal=await root.HandymanStorageV264.valuesEqual(verified,candidate);
   if(!equal)throw new Error("Accounting UI state read-back verification failed.");
   lastState=clone(verified);
   return {ok:true,verified:true,state:clone(verified)};
  });
  writeTail=operation.catch(()=>{});
  return operation;
 }
 async function mutate(updater){
  if(typeof updater!=="function")throw new Error("A synchronous state updater is required.");
  if(!initialized)throw new Error("Accounting UI bridge is not initialized.");
  const operation=writeTail.then(async()=>{
   const result=await controller().update(current=>{
    const next=updater(clone(current));
    if(next&&typeof next.then==="function")throw new Error("Accounting UI updater must be synchronous.");
    return assertState(next===undefined?current:next);
   });
   if(!result||result.ok!==true)throw new Error("IndexedDB mutation was not confirmed.");
   const verified=assertState(await controller().load());
   lastState=clone(verified);
   return {ok:true,verified:true,state:clone(verified)};
  });
  writeTail=operation.catch(()=>{});
  return operation;
 }
 async function reserveNumber(minimum){if(!initialized)throw new Error("Accounting UI bridge is not initialized.");return controller().reserveInvoiceNumber(minimum);}
 async function flush(){await writeTail;return {ok:true,initialized,lastState:clone(lastState)};}
 root.HandymanAccountingUIBridgeV264=Object.freeze({initialize,load,commit,mutate,reserveNumber,flush,get initialized(){return initialized;}});
})(window);
