/* THA v250 — read-only conversion planner.
   Reads only the staged legacy domain in the v250 repository.
   It never writes typed domains, LocalStorage, or application data.
*/
(function(root){
 "use strict";
 const DB="the_handyman_accountancy_v250_idb";
 const ENVELOPE="tha-legacy-localstorage-value-v1";
 const MAP={
  "tha_test226_accounting_v1":{domain:"accounting",key:"main",kind:"accounting"},
  "tha_test226_projects_v1":{domain:"projects",key:"main",kind:"projects"},
  "tha_test226_contracts_v1":{domain:"contracts",key:"main",kind:"contracts"},
  "tha_test226_invoice_sequence_v1":{domain:"sequences",key:"invoice",kind:"counter"},
  "tha_test226_isolation_test_record_cleanup_v1":{domain:"maintenance",key:"isolation-test-cleanup",kind:"flag"},
  "tha_test226_invoice_sequence_cleanup_v1":{domain:"maintenance",key:"invoice-sequence-cleanup",kind:"flag"},
  "tha_test226_empty_invoice_sequence_reset_v229":{domain:"maintenance",key:"empty-sequence-reset-v229",kind:"flag"},
  "tha_test226_factory_reset_recovery_v1":{domain:"recovery",key:"factory-reset",kind:"json"},
  "tha_test226_monitor_log_v1":{domain:"diagnostics",key:"monitor-log",kind:"json-array"},
  "tha_test226_report_archive_v1":{domain:"reports",key:"archive",kind:"json"},
  "tha_test226_report_notifications_v1":{domain:"reports",key:"notifications",kind:"json"},
  "tha_test226_report_settings_v1":{domain:"reports",key:"settings",kind:"json"},
  "tha_test226_report_workflow_v1":{domain:"reports",key:"workflow",kind:"json"},
  "tha_test226_report_email_settings_v1":{domain:"reports",key:"email-settings",kind:"json"},
  "tha_test226_help_contact_drafts_v1":{domain:"support",key:"contact-drafts",kind:"json"},
  "tha_test226_app_language_v1":{domain:"preferences",key:"language",kind:"language"},
  "tha_test226_app_language_pref_version_v1":{domain:"preferences",key:"language-pref-version",kind:"pref-version"}
 };
 const array=(v)=>Array.isArray(v);
 const object=(v)=>!!v&&typeof v==="object"&&!Array.isArray(v);
 function duplicates(values){
  const seen=new Set(),dupes=new Set();
  for(const value of values){if(value===undefined||value===null||value==="")continue;const k=String(value);if(seen.has(k))dupes.add(k);seen.add(k);}
  return [...dupes];
 }
 function idCheck(list,label,issues){
  if(!array(list))return;
  const ids=duplicates(list.map(x=>object(x)?x.id:undefined));
  if(ids.length)issues.push({severity:"blocker",code:"duplicate_ids",area:label,values:ids});
  const missing=list.filter(x=>!object(x)||typeof x.id!=="string"||!x.id.trim()).length;
  if(missing)issues.push({severity:"warning",code:"missing_ids",area:label,count:missing});
 }
 function validate(kind,raw,key){
  const issues=[],summary={};
  let value;
  try{value=JSON.parse(raw)}catch(_){
   if(kind==="counter"||kind==="flag"||kind==="language"||kind==="pref-version"){
    value=raw;
   }else{
    return {valid:false,issues:[{severity:"blocker",code:"invalid_json",message:"Value is not valid JSON."}],summary};
   }
  }
  if(kind==="accounting"){
   if(!object(value)||!array(value.entries))issues.push({severity:"blocker",code:"accounting_shape",message:"Expected an object with an entries array."});
   else{
    for(const name of ["customers","invoices","customExpenseCategories"])
     if(value[name]!==undefined&&!array(value[name]))issues.push({severity:"blocker",code:"accounting_array_shape",area:name});
    if(value.settings!==undefined&&!object(value.settings))issues.push({severity:"blocker",code:"accounting_settings_shape"});
    summary.entries=value.entries.length;summary.customers=array(value.customers)?value.customers.length:0;summary.invoices=array(value.invoices)?value.invoices.length:0;
    idCheck(value.customers,"accounting.customers",issues);idCheck(value.invoices,"accounting.invoices",issues);idCheck(value.entries,"accounting.entries",issues);
   }
  }else if(kind==="projects"){
   if(!object(value)||!array(value.projects)||!array(value.workers))issues.push({severity:"blocker",code:"projects_shape",message:"Expected an object with projects and workers arrays."});
   else{
    for(const name of ["partners","contractors","companies","companyJobs"])
     if(value[name]!==undefined&&!array(value[name]))issues.push({severity:"blocker",code:"projects_array_shape",area:name});
    if(value.profile!==undefined&&!object(value.profile))issues.push({severity:"blocker",code:"projects_profile_shape"});
    summary.projects=value.projects.length;summary.workers=value.workers.length;
    for(const name of ["projects","workers","partners","contractors","companies","companyJobs"])
     if(value[name]!==undefined)idCheck(value[name],"projects."+name,issues);
   }
  }else if(kind==="contracts"){
   if(!array(value))issues.push({severity:"blocker",code:"contracts_shape",message:"Expected an array of contract objects."});
   else{
    summary.contracts=value.length;
    if(value.some(x=>!object(x)||typeof x.id!=="string"||!x.id.trim()))
     issues.push({severity:"blocker",code:"contract_id_shape",message:"Every contract must be an object with a non-empty string ID."});
    idCheck(value,"contracts",issues);
   }
  }else if(kind==="counter"){
   const n=Number(value);
   if(!Number.isSafeInteger(n)||n<0)issues.push({severity:"blocker",code:"counter_invalid",message:"Invoice sequence must be a non-negative safe integer."});
   else summary.highWaterMark=n;
  }else if(kind==="flag"){
   if(raw!=="1"&&raw!=="0")issues.push({severity:"warning",code:"flag_unrecognised",message:"Cleanup marker is not the expected literal 1 or 0; preserve without executing."});
   summary.rawValue=raw;
  }else if(kind==="language"){
   if(!["en","fa","ar","ckb","kmr","tr","pl"].includes(raw))issues.push({severity:"warning",code:"language_unrecognised",message:"Language value is not in the app's currently recognised list."});
   summary.language=raw;
  }else if(kind==="pref-version"){
   if(!/^\d+$/.test(raw))issues.push({severity:"warning",code:"preference_version_unrecognised"});
   summary.preferenceVersion=raw;
  }else if(kind==="json-array"){
   if(!array(value))issues.push({severity:"warning",code:"expected_array",message:"Expected an array; retain as legacy until manually reviewed."});
   else summary.items=value.length;
  }else{
   summary.jsonType=array(value)?"array":object(value)?"object":value===null?"null":typeof value;
   if(object(value))summary.topLevelFields=Object.keys(value).length;
   if(array(value))summary.items=value.length;
  }
  return {valid:!issues.some(x=>x.severity==="blocker"),issues,summary,value};
 }
 function invoiceAudit(accounting,sequence){
  const issues=[];
  if(!object(accounting))return {issues,invoiceCount:0,standaloneIncomeCount:0,observedMax:0,sequenceValue:sequence};
  const invoices=array(accounting.invoices)?accounting.invoices:[];
  const entries=array(accounting.entries)?accounting.entries:[];
  const invoiceRows=invoices.map(x=>({number:Number(x&&x.number)||0,id:x&&x.id})).filter(x=>x.number>0);
  const standalone=entries.filter(e=>e&&e.type==="income"&&!e.invoiceId&&!String(e.id||"").startsWith("invoice-income-")&&!/^Invoice\s+/i.test(String(e.reference||"").trim())&&!/payment received for invoice/i.test(String(e.notes||"")));
  const incomeRows=standalone.map(x=>({number:Number(x.number)||0,id:x.id})).filter(x=>x.number>0);
  const invDup=duplicates(invoiceRows.map(x=>x.number));
  const incDup=duplicates(incomeRows.map(x=>x.number));
  const invoiceSet=new Set(invoiceRows.map(x=>x.number));
  const cross=duplicates([...invoiceRows.map(x=>"I:"+x.number),...incomeRows.map(x=>"E:"+x.number)]);
  const crossNumbers=[...new Set(invoiceRows.map(x=>x.number).filter(n=>incomeRows.some(y=>y.number===n)))];
  if(invDup.length)issues.push({severity:"blocker",code:"duplicate_invoice_numbers",numbers:invDup});
  if(incDup.length)issues.push({severity:"blocker",code:"duplicate_standalone_income_numbers",numbers:incDup});
  if(crossNumbers.length)issues.push({severity:"blocker",code:"invoice_income_number_collision",numbers:crossNumbers});
  const observedMax=Math.max(0,...invoiceRows.map(x=>x.number),...incomeRows.map(x=>x.number));
  const sequenceValue=Number(sequence)||0;
  if(sequenceValue<observedMax)issues.push({severity:"blocker",code:"sequence_below_observed_max",sequence:sequenceValue,observedMax});
  return {issues,invoiceCount:invoices.length,standaloneIncomeCount:standalone.length,observedMax,sequenceValue};
 }
 async function plan(){
  const api=root.HandymanStorageRepository;
  if(!api||api.databaseName!==DB||typeof api.snapshot!=="function")
   throw new Error("The v250 IndexedDB repository is not loaded.");
  const snap=await api.snapshot(["legacy"]);
  if(!snap||snap.format!=="tha-idb-repository-snapshot-v1"||snap.database!==DB||!array(snap.records))
   throw new Error("Could not read a valid v250 legacy snapshot.");
  const rows=snap.records.map(row=>{
   const env=row.value;
   if(!object(env)||env.format!==ENVELOPE||env.sourceKey!==row.key||typeof env.raw!=="string")
    return {sourceKey:row.key,classification:"invalid-envelope",status:"BLOCKED",issues:[{severity:"blocker",code:"legacy_envelope_invalid"}]};
   const mapping=MAP[row.key];
   if(!mapping)return {sourceKey:row.key,classification:"unmapped",status:"RETAIN_LEGACY",rawBytes:new Blob([env.raw]).size,issues:[]};
   const checked=validate(mapping.kind,env.raw,row.key);
   return {sourceKey:row.key,target:{domain:mapping.domain,key:mapping.key},kind:mapping.kind,status:checked.valid?(checked.issues.length?"REVIEW":"READY"):"BLOCKED",rawBytes:new Blob([env.raw]).size,summary:checked.summary,issues:checked.issues};
  });
  const findRaw=key=>{const row=snap.records.find(x=>x.key===key);return row&&row.value&&row.value.format===ENVELOPE?row.value.raw:null;};
  let accounting=null,sequence=null;
  try{const raw=findRaw("tha_test226_accounting_v1");if(raw!==null)accounting=JSON.parse(raw)}catch(_){}
  try{const raw=findRaw("tha_test226_invoice_sequence_v1");if(raw!==null)sequence=Number(raw)}catch(_){}
  const invoice=invoiceAudit(accounting,sequence);
  const issues=rows.flatMap(x=>x.issues.map(issue=>({...issue,sourceKey:x.sourceKey}))).concat(invoice.issues);
  const blockers=issues.filter(x=>x.severity==="blocker").length;
  const warnings=issues.filter(x=>x.severity==="warning").length;
  const ready=rows.filter(x=>x.status==="READY").length;
  const review=rows.filter(x=>x.status==="REVIEW").length;
  const blocked=rows.filter(x=>x.status==="BLOCKED").length;
  const unmapped=rows.filter(x=>x.status==="RETAIN_LEGACY").length;
  return {
   ok:blockers===0,
   mode:"read-only",
   database:DB,
   legacyRecordCount:rows.length,
   mappedCount:rows.filter(x=>x.target).length,
   readyCount:ready,
   reviewCount:review,
   blockedCount:blocked,
   unmappedCount:unmapped,
   invoiceReconciliation:invoice,
   issues,
   records:rows,
   writesPerformed:false,
   localStorageChanged:false,
   typedDomainsChanged:false,
   appCutover:false,
   note:"This planner only reads the v250 legacy domain. It does not create or modify typed domain records."
  };
 }
 root.HandymanV250ConversionPlanner=Object.freeze({plan});
})(window);
