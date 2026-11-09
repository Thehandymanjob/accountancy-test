/* THA v263 approved project-to-accounting transfer service v2.
   Uses one IndexedDB mutateMany transaction over both application domains.
   No stale read/whole-snapshot write cycle; source ledger remains intact.
*/
(function(root){
 "use strict";
 const storage=()=>{const x=root.HandymanAppStorageV263;if(!x)throw new Error("v263 storage adapter unavailable.");return x;};
 const engine=()=>{const x=root.HandymanStorageV263;if(!x||typeof x.mutateMany!=="function")throw new Error("Atomic multi-domain mutation engine unavailable.");return x;};
 const incomeCollections=new Set(["income"]);
 const expenseCollections=new Set(["expenses","wages","tools","food","contractors","materials"]);
 const descriptors=[
  {domain:"projects",key:"state",initialValue:{projects:[],workers:[],partners:[],contractors:[],companies:[],companyJobs:[],profile:{},current:null,guide:"en"}},
  {domain:"accounting",key:"state",initialValue:{entries:[],customers:[],invoices:[],customExpenseCategories:[],settings:{businessName:"",ownerName:""}}}
 ];
 function locate(projects,projectId,subprojectId,collection,recordId){
  if(!projects||!Array.isArray(projects.projects))throw new Error("Projects state has an invalid structure.");
  const p=projects.projects.find(x=>String(x.id)===String(projectId));if(!p)throw new Error("Project not found.");
  const ledger=subprojectId?(p.subprojects||[]).find(x=>String(x.id)===String(subprojectId)):p;
  if(!ledger)throw new Error("Sub-project not found.");
  if(!incomeCollections.has(collection)&&!expenseCollections.has(collection))throw new Error("Unsupported transfer source collection.");
  const list=ledger[collection];if(!Array.isArray(list))throw new Error("Project ledger collection not found.");
  const record=list.find(x=>String(x.id)===String(recordId));if(!record)throw new Error("Source ledger record not found.");
  return {project:p,ledger,record};
 }
 async function transfer(args){
  if(!args||args.approved!==true)throw new Error("Explicit approval is required before transfer.");
  const {projectId,subprojectId=null,collection,recordId}=args;
  if(!projectId||!recordId)throw new Error("Project ID and source record ID are required.");
  const transferId="project-transfer:"+String(projectId)+":"+String(subprojectId||"main")+":"+String(collection)+":"+String(recordId);
  await storage().initialize();
  const stamp=new Date().toISOString();
  let postedEntry=null,transferAmount=null,transferType=null;
  const result=await engine().mutateMany(descriptors,rows=>{
   const projects=rows[0].value,accounting=rows[1].value;
   if(!projects||!Array.isArray(projects.projects))throw new Error("Projects state has an invalid structure.");
   if(!accounting||!Array.isArray(accounting.entries))throw new Error("Accounting state has an invalid structure.");
   const {project,ledger,record}=locate(projects,projectId,subprojectId,collection,recordId);
   if(record.transferredToAccounting===true||record.accountingTransferId)throw new Error("This source record has already been transferred.");
   if(accounting.entries.some(x=>String(x.projectTransferId||"")===transferId||String(x.id)===transferId))throw new Error("Matching accounting transfer already exists; duplicate blocked.");
   const amount=Math.round((Number(record.amount)||0)*100)/100;
   if(!(amount>0))throw new Error("Source amount must be greater than zero.");
   const type=incomeCollections.has(collection)?"income":"expense";
   const entry={
    id:transferId,type,
    date:String(record.date||record.paymentDate||stamp.slice(0,10)),
    amount,
    method:record.method||record.paymentMethod||"bank",
    category:String(record.category||record.description||collection),
    reference:String(record.reference||record.description||("Project "+project.name)),
    notes:"Approved project transfer · "+String(project.name)+(subprojectId?" / "+String(ledger.name):""),
    projectId:String(projectId),subprojectId:subprojectId?String(subprojectId):"",
    projectSourceCollection:collection,projectSourceRecordId:String(recordId),
    projectTransferId:transferId,createdAt:stamp
   };
   record.transferredToAccounting=true;
   record.accountingTransferId=transferId;
   record.accountingTransferredAt=stamp;
   accounting.entries.push(entry);
   postedEntry=entry;transferAmount=amount;transferType=type;
   return [projects,accounting];
  });
  if(!result||result.updated!==2)throw new Error("Atomic project/accounting transfer was not confirmed.");
  const [projectsAfter,accountingAfter]=await Promise.all([storage().read("projects"),storage().read("accounting")]);
  const source=locate(projectsAfter,projectId,subprojectId,collection,recordId).record;
  const posted=accountingAfter.entries.find(x=>String(x.projectTransferId||"")===transferId);
  if(!source.transferredToAccounting||source.accountingTransferId!==transferId||!posted||posted.amount!==transferAmount||posted.type!==transferType)throw new Error("Atomic transfer read-back verification failed.");
  return {ok:true,transferId,amount:transferAmount,type:transferType,accountingEntryId:posted.id,sourceRetained:true,projectPnlSourceUnchanged:true,atomicDomains:["projects","accounting"]};
 }
 root.HandymanProjectAccountingTransferV263=Object.freeze({transfer});
})(window);
