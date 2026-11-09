/* THA v263 invoice workflow controller — atomic invoice/payment mutations.
   Depends on HandymanAccountingV263 and uses only the isolated IndexedDB adapter.
*/
(function(root){
 "use strict";
 const api=()=>{const x=root.HandymanAccountingV263;if(!x)throw new Error("Accounting controller is not loaded.");return x;};
 const clone=x=>root.structuredClone(x),round=n=>Math.round((Number(n)||0)*100)/100;
 function validatePayment(p){if(!p||!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date||""))||!["cash","bank"].includes(p.method)||!(round(p.amount)>0))throw new Error("A valid payment date, method and positive amount are required.");}
 async function saveInvoice(invoice,payment){
  if(!invoice||typeof invoice!=="object"||!invoice.id||!invoice.customerId)throw new Error("Invoice ID and customer ID are required.");
  const item=clone(invoice);
  if(payment)validatePayment(payment);
  if(!Number.isSafeInteger(Number(item.number))||Number(item.number)<1)item.number=await api().reserveInvoiceNumber();
  await api().update(state=>{
   if(!state.customers.some(c=>String(c.id)===String(item.customerId)))throw new Error("Invoice customer does not exist.");
   const prior=state.invoices.find(i=>String(i.id)===String(item.id));
   if(prior&&Number(prior.number)!==Number(item.number))throw new Error("An existing invoice number cannot be changed.");
   if(state.invoices.some(i=>String(i.id)!==String(item.id)&&Number(i.number)===Number(item.number)))throw new Error("Invoice number is already in use.");
   if(payment){item.status="issued";item.paymentStatus="paid";item.paymentDate=payment.date;item.paymentMethod=payment.method;}
   const index=state.invoices.findIndex(i=>String(i.id)===String(item.id));
   if(index<0)state.invoices.push(item);else state.invoices[index]=item;
   if(payment){
    const income={id:"invoice-income-"+item.id,type:"income",date:payment.date,amount:round(payment.amount),method:payment.method,category:"Work income",reference:"Invoice "+item.number,notes:"Payment received for invoice "+item.number,invoiceId:item.id,createdAt:new Date().toISOString()};
    const matches=state.entries.filter(e=>e.type==="income"&&(String(e.invoiceId||"")===String(item.id)||String(e.reference||"")==="Invoice "+item.number||String(e.id)==="invoice-income-"+item.id));
    if(matches.length){const keep=matches[0];Object.assign(keep,income,{id:keep.id,createdAt:keep.createdAt||income.createdAt});state.entries=state.entries.filter(e=>e===keep||!matches.includes(e));}
    else state.entries.push(income);
   }
   return state;
  });
  return {ok:true,id:String(item.id),number:Number(item.number)};
 }
 async function markPaid(id,payment){
  validatePayment(payment);
  await api().update(state=>{
   const invoice=state.invoices.find(i=>String(i.id)===String(id)&&!i.deletedAt&&!i.deleted);
   if(!invoice)throw new Error("Active invoice not found.");
   invoice.status="issued";invoice.paymentStatus="paid";invoice.paymentDate=payment.date;invoice.paymentMethod=payment.method;
   const entry={id:"invoice-income-"+invoice.id,type:"income",date:payment.date,amount:round(payment.amount),method:payment.method,category:"Work income",reference:"Invoice "+invoice.number,notes:"Payment received for invoice "+invoice.number,invoiceId:invoice.id,createdAt:new Date().toISOString()};
   const matches=state.entries.filter(e=>e.type==="income"&&(String(e.invoiceId||"")===String(invoice.id)||String(e.reference||"")==="Invoice "+invoice.number||String(e.id)==="invoice-income-"+invoice.id));
   if(matches.length){const keep=matches[0];Object.assign(keep,entry,{id:keep.id,createdAt:keep.createdAt||entry.createdAt});state.entries=state.entries.filter(e=>e===keep||!matches.includes(e));}else state.entries.push(entry);
   return state;
  });return {ok:true};
 }
 async function markUnpaid(id){
  await api().update(state=>{const invoice=state.invoices.find(i=>String(i.id)===String(id)&&!i.deletedAt&&!i.deleted);if(!invoice)throw new Error("Active invoice not found.");state.entries=state.entries.filter(e=>!(e.type==="income"&&(String(e.invoiceId||"")===String(invoice.id)||String(e.reference||"")==="Invoice "+invoice.number||String(e.id)==="invoice-income-"+invoice.id)));invoice.paymentStatus="unpaid";invoice.paymentDate="";invoice.paymentMethod="";return state;});
  return {ok:true};
 }
 async function softDelete(id){
  await api().update(state=>{const invoice=state.invoices.find(i=>String(i.id)===String(id)&&!i.deletedAt&&!i.deleted);if(!invoice)throw new Error("Active invoice not found.");invoice.deletedAt=new Date().toISOString();invoice.deleted=true;state.entries=state.entries.filter(e=>!(e.type==="income"&&(String(e.invoiceId||"")===String(invoice.id)||String(e.reference||"")==="Invoice "+invoice.number||String(e.id)==="invoice-income-"+invoice.id)));return state;});
  return {ok:true,numberReserved:true};
 }
 root.HandymanInvoiceWorkflowV263=Object.freeze({saveInvoice,markPaid,markUnpaid,softDelete});
})(window);
