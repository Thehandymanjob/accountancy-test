/* THA v6 full-backup staging adapter.
   Synthetic test only. Normalizes the complete v6 envelope into schema-v4 stores
   in one transaction, verifies persisted records, then removes only its own test IDs.
   It never reads/writes LocalStorage and never connects the app to IndexedDB.
*/
(function(root) {
  "use strict";
  const PREFIX = "__tha_v6_stage_test__:";
  const SOURCE_ARRAYS = ["income","expenses","wages","tools","food","materials"];
  const STORES = ["legacySnapshots","customers","projects","invoices","contracts",
    "accountingEntries","projectReceipts","projectExpenses","workers","partners",
    "contractors","companies","companyJobs","customExpenseCategories",
    "thirdPartyTransactions","accountingSettings","projectMetadata","recordOrder"];

  function foundation() {
    const f = root.HandymanStorageFoundation;
    if (!f || typeof f.openDatabase !== "function" ||
        f.databaseName !== "the_handyman_accountancy_test226" ||
        f.schemaVersion !== 4 || !Array.isArray(f.stores) ||
        STORES.some(s => !f.stores.includes(s))) {
      throw new Error("Expected test database foundation schema v4 and all domain stores.");
    }
    return f;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function arr(x, name) {
    if (!Array.isArray(x)) throw new Error(name + " must be an array.");
    return x;
  }
  function object(x, name) {
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error(name + " must be an object.");
    return x;
  }
  function validateEnvelope(p) {
    object(p, "Backup envelope");
    if (p.app !== "The Handyman Accountancy" || p.backupType !== "complete-user-data" || p.version !== 6)
      throw new Error("Expected complete-user-data backup version 6.");
    const d = object(p.data, "data"), w = object(p.projects, "projects workspace");
    ["entries","customers","invoices","customExpenseCategories","thirdPartyTransactions"].forEach(k => arr(d[k], "data."+k));
    object(d.settings, "data.settings");
    ["projects","workers","partners","contractors","companies","companyJobs"].forEach(k => arr(w[k], "projects."+k));
    object(w.profile, "projects.profile");
    arr(p.contracts, "contracts");
    return p;
  }
  function record(store, source, id, extra) {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(store + " contains a non-object record.");
    if (source.id === undefined || source.id === null || String(source.id) === "") throw new Error(store + " record is missing its source id.");
    return Object.assign({}, clone(source), extra || {}, {id:String(source.id)});
  }
  function normalize(payload) {
    validateEnvelope(payload);
    const out = Object.fromEntries(STORES.map(s => [s, []]));
    const order = [];
    function push(store, source, extra, sourceCollection, index) {
      const r = record(store, source, source.id, extra);
      out[store].push(r);
      order.push({id:PREFIX+"order:"+order.length,store,sourceCollection,sourceIndex:index,sourceId:String(source.id)});
    }
    const d = payload.data, w = payload.projects;
    d.entries.forEach((x,i) => push("accountingEntries",x,{},"data.entries",i));
    d.customers.forEach((x,i) => push("customers",x,{},"data.customers",i));
    d.invoices.forEach((x,i) => push("invoices",x,{},"data.invoices",i));
    d.customExpenseCategories.forEach((x,i) => {
      const value = x;
      const id = PREFIX+"category:"+i;
      out.customExpenseCategories.push({id,value,sourceIndex:i});
      order.push({id:PREFIX+"order:"+order.length,store:"customExpenseCategories",sourceCollection:"data.customExpenseCategories",sourceIndex:i,sourceId:id});
    });
    d.thirdPartyTransactions.forEach((x,i) => push("thirdPartyTransactions",x,{},"data.thirdPartyTransactions",i));
    out.accountingSettings.push({id:PREFIX+"accounting-settings",settings:clone(d.settings)});
    order.push({id:PREFIX+"order:"+order.length,store:"accountingSettings",sourceCollection:"data.settings",sourceIndex:0,sourceId:PREFIX+"accounting-settings"});
    const nestedArrays = SOURCE_ARRAYS.concat(["subprojects"]);
    w.projects.forEach((project,pi) => {
      const parent = clone(project);
      nestedArrays.forEach(k => { if (Array.isArray(parent[k])) delete parent[k]; });
      out.projects.push(Object.assign({},parent,{id:String(project.id),recordType:"project"}));
      order.push({id:PREFIX+"order:"+order.length,store:"projects",sourceCollection:"projects.projects",sourceIndex:pi,sourceId:String(project.id)});
      (project.subprojects || []).forEach((sub,si) => {
        const clean = clone(sub);
        SOURCE_ARRAYS.forEach(k => { if (Array.isArray(clean[k])) delete clean[k]; });
        out.projects.push(Object.assign({},clean,{id:String(sub.id),recordType:"subproject",parentProjectId:String(project.id)}));
        order.push({id:PREFIX+"order:"+order.length,store:"projects",sourceCollection:"projects.projects["+pi+"].subprojects",sourceIndex:si,sourceId:String(sub.id)});
        SOURCE_ARRAYS.forEach(kind => (sub[kind] || []).forEach((item,ii) => {
          const extra = {parentProjectId:String(project.id),subprojectId:String(sub.id),sourceType:kind,sourceIndex:ii};
          const target = kind === "income" ? "projectReceipts" : "projectExpenses";
          push(target,item,extra,"projects.projects["+pi+"].subprojects["+si+"]."+kind,ii);
        }));
      });
      SOURCE_ARRAYS.forEach(kind => (project[kind] || []).forEach((item,ii) => {
        const target = kind === "income" ? "projectReceipts" : "projectExpenses";
        push(target,item,{parentProjectId:String(project.id),subprojectId:null,sourceType:kind,sourceIndex:ii},
          "projects.projects["+pi+"]."+kind,ii);
      }));
    });
    ["workers","partners","contractors","companies","companyJobs"].forEach(k =>
      w[k].forEach((x,i) => push(k,x,{},"projects."+k,i)));
    out.projectMetadata.push({id:PREFIX+"workspace-metadata",profile:clone(w.profile),
      current:w.current,guide:w.guide,currentSubproject:w.currentSubproject,
      profitReportProjectId:w.profitReportProjectId});
    order.push({id:PREFIX+"order:"+order.length,store:"projectMetadata",sourceCollection:"projects.workspaceMetadata",sourceIndex:0,sourceId:PREFIX+"workspace-metadata"});
    payload.contracts.forEach((x,i) => push("contracts",x,{},"contracts",i));
    out.recordOrder = order;
    return out;
  }
  function request(req) {
    return new Promise((resolve,reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB request failed."));
    });
  }
  function txDone(tx) {
    return new Promise((resolve,reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
    });
  }
  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function stageAndVerify(payload) {
    const f = foundation(), normalized = normalize(payload);
    const raw = JSON.stringify(payload), hash = await sha256(raw);
    const snapshot = {id:PREFIX+"raw-backup",legacyKey:PREFIX+"raw-backup",present:true,raw,
      byteLength:new Blob([raw]).size,sha256:hash,validJson:true,capturedAt:new Date().toISOString()};
    const db = await f.openDatabase();
    const stores = STORES;
    try {
      const tx = db.transaction(stores,"readwrite");
      const done = txDone(tx);
      for (const store of stores) {
        const os = tx.objectStore(store);
        if (store === "legacySnapshots") {
          const existing = await request(os.get(snapshot.id));
          if (existing) { tx.abort(); throw new Error("Staging snapshot key already exists; refusing to overwrite."); }
          os.add(snapshot);
          continue;
        }
        for (const item of normalized[store]) {
          const existing = await request(os.get(item.id));
          if (existing) { tx.abort(); throw new Error("Staging ID already exists in "+store+": "+item.id); }
          os.add(item);
        }
      }
      await done;
      const verifyTx = db.transaction(stores,"readonly");
      const verifyDone = txDone(verifyTx);
      const counts = {};
      for (const store of stores) {
        const os = verifyTx.objectStore(store);
        counts[store] = await request(os.count());
        for (const item of store === "legacySnapshots" ? [snapshot] : normalized[store]) {
          const saved = await request(os.get(item.id));
          if (!saved || JSON.stringify(saved) !== JSON.stringify(item)) throw new Error("Persisted record verification failed in "+store+": "+item.id);
        }
      }
      const savedSnapshot = await request(verifyTx.objectStore("legacySnapshots").get(snapshot.id));
      if (!savedSnapshot || savedSnapshot.raw !== raw || savedSnapshot.sha256 !== hash)
        throw new Error("Immutable raw snapshot verification failed.");
      await verifyDone;
      return {ok:true,counts,sourceBytes:snapshot.byteLength,sourceSha256:hash,
        stagedRecords:stores.reduce((n,s)=>n+(s==="legacySnapshots"?1:normalized[s].length),0),
        localStorageAccessed:false,appCutover:false};
    } catch(e) {
      throw e;
    } finally { db.close(); }
  }
  async function cleanup() {
    const f=foundation(), db=await f.openDatabase();
    try {
      const tx=db.transaction(STORES,"readwrite"), done=txDone(tx);
      for (const store of STORES) {
        const os=tx.objectStore(store);
        const all=await request(os.getAll());
        for (const item of all) {
          const id=String(item.id || "");
          if (id.startsWith(PREFIX)) os.delete(item.id);
        }
      }
      await done;
      const verify=db.transaction(STORES,"readonly"), verifyDone=txDone(verify);
      const leftovers={};
      for (const store of STORES) {
        const all=await request(verify.objectStore(store).getAll());
        leftovers[store]=all.filter(x=>String(x.id||"").startsWith(PREFIX)).length;
      }
      await verifyDone;
      return {ok:Object.values(leftovers).every(x=>x===0),leftovers};
    } finally { db.close(); }
  }
  function syntheticFixture() {
    const image="data:image/jpeg;base64,/9j/2Q==";
    return {
      app:"The Handyman Accountancy",backupType:"complete-user-data",version:6,
      exportedAt:"2026-11-04T19:48:48.755Z",
      data:{
        entries:[{id:"synthetic-entry-1",type:"income",date:"2026-11-01",amount:125,method:"bank",invoiceId:"synthetic-invoice-1",unknownEntryField:{keep:true}}],
        customers:[{id:"synthetic-customer-1",name:"Synthetic Customer",phone:"",address:"",workAddress:null,email:""}],
        invoices:[{id:"synthetic-invoice-1",number:90001,date:"2026-11-01",customerId:"synthetic-customer-1",status:"issued",paymentStatus:"paid",items:[{description:"Labour",price:125,unknownItemField:"keep"}]}],
        customExpenseCategories:["Synthetic category"],settings:{businessName:"Synthetic business",ownerName:""},thirdPartyTransactions:[]
      },
      projects:{
        projects:[{id:"synthetic-project-1",name:"Synthetic project",price:1000,photo:image,
          income:[],expenses:[],wages:[],tools:[],food:[],materials:[],
          subprojects:[{id:"synthetic-subproject-1",name:"Synthetic subproject",price:1000,photo:"",
            income:[{id:"synthetic-receipt-1",amount:100,date:"",method:"cash",receiptType:"extra-work",reference:""}],
            expenses:[{id:"synthetic-expense-1",amount:25,date:"2026-11-02",category:"materials",contractorId:"",description:""}],
            wages:[],tools:[],food:[],materials:[]}] }],
        workers:[{id:"synthetic-worker-1",name:"Synthetic worker"}],
        partners:[{id:"synthetic-partner-1",name:"Synthetic partner"}],
        contractors:[{id:"synthetic-contractor-1",name:"Synthetic contractor"}],
        companies:[{id:"synthetic-company-1",name:"Synthetic company"}],companyJobs:[],
        profile:{businessName:"Synthetic business",ownerName:"",logo:image,paymentDetails:{}},
        current:"synthetic-project-1",guide:"en",currentSubproject:null,profitReportProjectId:"synthetic-project-1"
      },
      contracts:[{id:"synthetic-contract-1",documentType:"contract",title:"Synthetic contract",customer:"Synthetic Customer",body:"Synthetic body"}]
    };
  }
  async function selfTest() {
    const result={ok:false,checks:{shape:false,normalize:false,atomicStage:false,counts:false,rawSnapshot:false,cleanup:false},
      localStorageAccessed:false,appCutover:false};
    try {
      const fixture=syntheticFixture(); validateEnvelope(fixture); result.checks.shape=true;
      const normalized=normalize(fixture); result.checks.normalize=
        normalized.accountingEntries.length===1 && normalized.customers.length===1 &&
        normalized.invoices.length===1 && normalized.projects.length===2 &&
        normalized.projectReceipts.length===1 && normalized.projectExpenses.length===1 &&
        normalized.contracts.length===1 && normalized.recordOrder.length>0;
      if(!result.checks.normalize) throw new Error("Synthetic v6 normalization count check failed.");
      const staged=await stageAndVerify(fixture); result.checks.atomicStage=staged.ok;
      result.checks.counts=staged.stagedRecords>0 && staged.counts.accountingEntries>=1 &&
        staged.counts.projects>=2 && staged.counts.projectReceipts>=1;
      result.checks.rawSnapshot=!!staged.sourceSha256 && staged.sourceBytes>0;
      const cleaned=await cleanup(); result.checks.cleanup=cleaned.ok;
      result.ok=Object.values(result.checks).every(Boolean);
      result.staged=staged; result.cleaned=cleaned;
      return result;
    } catch(e) {
      try { result.cleaned=await cleanup(); result.checks.cleanup=!!result.cleaned.ok; } catch(cleanupError) {
        result.cleanupError=String(cleanupError && cleanupError.message || cleanupError);
      }
      result.error=String(e && e.message || e);
      return result;
    }
  }
  root.HandymanBackupV6StagingAdapter=Object.freeze({validateEnvelope,normalize,stageAndVerify,cleanup,selfTest,syntheticFixture});
})(window);
