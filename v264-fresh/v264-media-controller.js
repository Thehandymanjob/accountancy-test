/* THA v264 media repository — IndexedDB-only binary asset storage.
   Stores Blob/File objects without base64 conversion. Metadata is separate from bytes.
   All mutations are verified and scoped to the media domain.
*/
(function(root){
 "use strict";
 const adapter=()=>{const a=root.HandymanAppStorageV264;if(!a)throw new Error("v264 application storage adapter is unavailable.");return a;};
 const engine=()=>{const e=root.HandymanStorageV264;if(!e)throw new Error("v264 IndexedDB engine is unavailable.");return e;};
 const clone=v=>root.structuredClone(v);
 const validId=id=>typeof id==="string"&&id.trim().length>0&&id.length<=256;
 const validBlob=value=>value instanceof Blob;
 async function load(){await adapter().initialize();const state=await adapter().read("media");if(!state||typeof state!=="object"||!Array.isArray(state.items))throw new Error("Media index is invalid.");return state;}
 async function saveAsset(input){
  if(!input||typeof input!=="object"||!validId(input.id)||!validBlob(input.blob))throw new Error("Media asset requires a stable ID and Blob/File data.");
  const state=await load(),now=new Date().toISOString(),prior=state.items.find(x=>x.id===input.id);
  const asset={id:input.id,name:String(input.name||input.fileName||"asset").slice(0,255),type:String(input.type||input.blob.type||"application/octet-stream"),size:input.blob.size,createdAt:prior?.createdAt||input.createdAt||now,updatedAt:now,ownerType:String(input.ownerType||"general"),ownerId:String(input.ownerId||""),role:String(input.role||"attachment"),blob:input.blob};
  const index=state.items.findIndex(x=>x.id===asset.id);if(index<0)state.items.push(asset);else state.items[index]=asset;
  const result=await adapter().write("media",state);
  if(!result||result.ok!==true)throw new Error("Media asset save was not confirmed.");
  const verified=await load(),saved=verified.items.find(x=>x.id===asset.id);
  if(!saved||!(await engine().valuesEqual(saved,asset)))throw new Error("Media asset full-content verification failed.");
  return {ok:true,asset:clone(saved)};
 }
 async function getAsset(id){if(!validId(id))throw new Error("A media asset ID is required.");const state=await load();const asset=state.items.find(x=>x.id===id);if(!asset)return null;return clone(asset);}
 async function deleteAsset(id){if(!validId(id))throw new Error("A media asset ID is required.");const state=await load(),before=state.items.length;state.items=state.items.filter(x=>x.id!==id);if(state.items.length===before)return {ok:true,removed:false};await adapter().write("media",state);const check=await load();if(check.items.some(x=>x.id===id))throw new Error("Media deletion verification failed.");return {ok:true,removed:true};}
 async function list(filter){const state=await load();const items=state.items.filter(x=>!filter||(!filter.ownerType||x.ownerType===filter.ownerType)&&(!filter.ownerId||x.ownerId===filter.ownerId)&&(!filter.role||x.role===filter.role));return items.map(({blob,...meta})=>clone(meta));}
 root.HandymanMediaV264=Object.freeze({load,saveAsset,getAsset,deleteAsset,list});
})(window);
