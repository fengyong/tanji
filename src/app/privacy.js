import {CAP,isNative} from './env.js';

let plugin=null,pending=null;
function nativePlugin(){
  if(!plugin)plugin=CAP.Capacitor.registerPlugin('AmountPrivacy');
  return plugin;
}

export async function restoreAmountPrivacy(){
  if(!isNative)return false;
  const result=await nativePlugin().getState();
  if(typeof result?.enabled!=='boolean')throw new Error('金额隐私状态格式无效');
  return result.enabled;
}

export function toggleAmountPrivacy(){
  if(!isNative)return Promise.resolve(null);
  if(pending)return pending;
  pending=(async()=>{
    try{
      const result=await nativePlugin().toggle();
      if(typeof result?.enabled!=='boolean')throw new Error('金额隐私状态格式无效');
      return result.enabled;
    }finally{pending=null}
  })();
  return pending;
}

export function privacyFailureMessage(error){
  if(error?.code==='AUTH_IN_PROGRESS')return '正在验证 Face ID，请稍候';
  if(error?.code==='USER_CANCELED')return '已取消，金额状态未改变';
  return typeof error?.message==='string'&&error.message?error.message:'Face ID 验证未完成，金额状态未改变';
}
