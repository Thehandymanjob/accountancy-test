/* THA v263 Business Profile controller.
   One neutral business-identity source for document branding.
   It has no Projects or Accounting dependency and never reads LocalStorage.
*/
(function(root){
 "use strict";
 const adapter=()=>{const x=root.HandymanAppStorageV263;if(!x)throw new Error("v263 application storage is unavailable.");return x;};
 const engine=()=>{const x=root.HandymanStorageV263;if(!x)throw new Error("v263 IndexedDB engine is unavailable.");return x;};
 const fields=["businessName","ownerName","phone","email","address","logo","paymentDetails"];
 function normalize(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Business Profile must be an object.");
  const result={...value};
  for(const key of fields)if(result[key]===undefined||result[key]===null)result[key]="";
  for(const key of fields)if(typeof result[key]!=="string")throw new Error("Business Profile field must be text: "+key);
  return result;
 }
 async function initialize(){const r=await adapter().initialize();return {ok:true,database:r.database,domain:"business_profile",build:"THA-263-BUSINESS-PROFILE-1"};}
 async function load(){await initialize();return normalize(await adapter().read("businessProfile"));}
 async function save(value){const next=normalize(value);await initialize();const written=await adapter().write("businessProfile",next);if(!written||written.ok!==true)throw new Error("Business Profile save was not confirmed.");const check=normalize(await adapter().read("businessProfile"));if(!(await engine().valuesEqual(check,next)))throw new Error("Business Profile read-back verification failed.");return {ok:true,profile:check};}
 async function update(patch){if(!patch||typeof patch!=="object"||Array.isArray(patch))throw new Error("A profile patch object is required.");const current=await load();return save({...current,...patch});}
 async function importLegacyProfile(source){if(!source||typeof source!=="object"||Array.isArray(source))throw new Error("A legacy profile object must be supplied explicitly.");return save(source);}
 async function backup(){await initialize();return engine().snapshot(["business_profile"]);}
 async function restore(pkg){if(!pkg||!Array.isArray(pkg.domains)||pkg.domains.length!==1||pkg.domains[0]!=="business_profile"||!Array.isArray(pkg.records)||pkg.records.some(x=>x.domain!=="business_profile"))throw new Error("Business Profile restore accepts only a Business Profile backup.");const result=await engine().restore(pkg);if(!result||result.ok!==true)throw new Error("Business Profile restore was not confirmed.");return result;}
 root.HandymanBusinessProfileV263=Object.freeze({fields,initialize,load,save,update,importLegacyProfile,backup,restore});
})(window);
