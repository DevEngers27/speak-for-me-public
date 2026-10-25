/** Validate DTOs before Convex's return check can include offending values. */
import type {GenericValidator} from 'convex/values';
import {appError} from './errors';
import {publicOpsLog,type PublicFnName} from './opsLog';

type NormalizeId=(table:string,value:string)=>string|null;
function matches(validator:GenericValidator,value:unknown,normalizeId?:NormalizeId):boolean {
  if(value===undefined)return validator.isOptional==='optional';
  switch(validator.kind){
    case 'null':return value===null;
    case 'boolean':return typeof value==='boolean';
    case 'string':return typeof value==='string';
    case 'float64':return typeof value==='number';
    case 'int64':return typeof value==='bigint'&&value>=-(1n<<63n)&&value<(1n<<63n);
    case 'commitTs':return typeof value==='bigint';
    case 'bytes':return value instanceof ArrayBuffer;
    case 'literal':return Object.is(value,validator.value);
    case 'id':return typeof value==='string'&&(normalizeId?normalizeId(validator.tableName,value)===value:value.length>0);
    case 'array':return Array.isArray(value)&&Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)&&matches(validator.element,value[i],normalizeId)).every(Boolean);
    case 'union':return validator.members.some((member:GenericValidator)=>matches(member,value,normalizeId));
    case 'object':{
      if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
      const fields:Record<string,GenericValidator>=validator.fields;
      const record=value as Record<string,unknown>;
      return Object.keys(record).every(key=>Object.hasOwn(fields,key))&&Object.entries(fields).every(([key,field])=>matches(field,record[key],normalizeId));
    }
    case 'record':{
      if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
      return Object.entries(value).every(([key,entry])=>matches(validator.key,key,normalizeId)&&matches(validator.value,entry,normalizeId));
    }
    case 'any':return false; // Public DTOs must be closed, including nested data.
  }
}
export function invalidReturn(fn:PublicFnName):never {
  publicOpsLog('unhandled',{fn,errorClass:'TypeError'});
  throw appError('internal');
}
export function checkedReturn<T>(fn:PublicFnName,validator:GenericValidator,value:T,mode:'query',normalizeId?:NormalizeId):T|null;
export function checkedReturn<T>(fn:PublicFnName,validator:GenericValidator,value:T,mode:'mutation',normalizeId?:NormalizeId):T;
export function checkedReturn<T>(fn:PublicFnName,validator:GenericValidator,value:T,mode:'query'|'mutation',normalizeId?:NormalizeId):T|null {
  let valid=false;
  try {valid=matches(validator,value,normalizeId);} catch { /* No validator exception text leaves this boundary. */ }
  if(valid)return value;
  if(mode==='query'){publicOpsLog('unhandled',{fn,errorClass:'TypeError'});return null;}
  return invalidReturn(fn);
}
