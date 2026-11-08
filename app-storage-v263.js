/* THA v263 application repository adapter.
   This module is intentionally independent of LocalStorage and never imports legacy data.
   It is not wired into index.html until every application domain has an async cutover.
*/
(function(root){
  "use strict";
  const engine=()=> {
    const api=root.HandymanStorageV263;
    if(!api) throw new Error("v263 IndexedDB engine is not loaded.");
    return api;
  };
  const domains=Object.freeze({
    accounting:{key:"state",fallback:()=>({entries:[],customers:[],invoices:[],settings:{}})},
    projects:{key:"state",fallback:()=>({projects:[],workers:[],partners:[],contractors:[],companies:[],companyJobs:[],profile:{},current:null,guide:"en"})},
    contracts:{key:"state",fallback:()=>({contracts:[]})},
    sequences:{key:"invoice-number",fallback:()=>0},
    preferences:{key:"language",fallback:()=>"en"},
    diagnostics:{key:"monitor-log",fallback:()=>[]},
    reports:{key:"archive",fallback:()=>[]},
    notifications:{key:"items",fallback:()=>[]},
    recovery:{key:"last-reset-snapshot",fallback:()=>null}
  });
  const descriptor=name=>{
    const item=domains[name];
    if(!item) throw new Error("Unknown application storage domain: "+name);
    return {domain:name,key:item.key};
  };
  async function initialize(){
    const status=await engine().ready();
    if(!status||status.ok!==true) throw new Error("v263 IndexedDB initialization did not pass.");
    return {ok:true,database:status.database,build:status.build,mode:"indexeddb-only",legacyImport:false};
  }
  async function read(name){
    const d=descriptor(name),value=await engine().get(d.domain,d.key);
    return value===null?domains[name].fallback():value;
  }
  async function readAll(){
    await initialize();
    const names=Object.keys(domains);
    const rows=await engine().readMany(names.map(descriptor));
    const result={};
    for(const row of rows.records){
      result[row.domain]=row.value===null?domains[row.domain].fallback():row.value;
    }
    return {ok:true,emptyDatabase:rows.records.every(row=>row.value===null),state:result};
  }
  async function write(name,value){
    const d=descriptor(name);
    const result=await engine().put(d.domain,d.key,value);
    const verified=await engine().get(d.domain,d.key);
    if(!await sameValue(verified,value)) throw new Error("Application storage read-back mismatch: "+name);
    return {...result,verified:true};
  }
  async function writeMany(values){
    if(!values||typeof values!=="object"||Array.isArray(values)) throw new Error("A domain-value object is required.");
    const writes=Object.keys(values).map(name=>({...descriptor(name),value:values[name]}));
    if(!writes.length) throw new Error("No application domains supplied.");
    return engine().transact(writes);
  }
  async function sameValue(a,b){
    if(Object.is(a,b)) return true;
    if(a instanceof Blob||b instanceof Blob){
      if(!(a instanceof Blob)||!(b instanceof Blob)||a.size!==b.size||a.type!==b.type)return false;
      return (await a.text())===(await b.text());
    }
    if(a instanceof Date||b instanceof Date)return a instanceof Date&&b instanceof Date&&a.getTime()===b.getTime();
    if(a===null||b===null||typeof a!=="object"||typeof b!=="object")return false;
    if(Array.isArray(a)||Array.isArray(b)){
      if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
      for(let i=0;i<a.length;i++)if(!await sameValue(a[i],b[i]))return false;
      return true;
    }
    const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
    if(ak.length!==bk.length||ak.some((k,i)=>k!==bk[i]))return false;
    for(const k of ak)if(!await sameValue(a[k],b[k]))return false;
    return true;
  }
  async function reserveInvoiceNumber(minimum){return engine().reserveCounter("sequences","invoice-number",minimum||0);}
  async function backup(){return engine().snapshot(Object.keys(domains));}
  async function restore(packageValue){return engine().restore(packageValue);}
  async function health(){return engine().health();}
  root.HandymanAppStorageV263=Object.freeze({
    domains:Object.keys(domains),initialize,read,readAll,write,writeMany,
    reserveInvoiceNumber,backup,restore,health
  });
})(window);
