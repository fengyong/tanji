import {CAP,isNative} from './env.js';

const TAB_IDS=new Set(['home','trip','orders','pay','stats']);
let plugin=null,initialized=false,sheetOpen=false,cropOpen=false,sheetTimer=null,lastPayload='';
let state={ready:false,tab:'home',badge:0,overlay:'none',appliedCommandId:null};

function applyBottomInset(value){
  const height=Math.max(0,Number(value)||0);
  document.documentElement.style.setProperty('--native-tab-height',`${height}px`);
}
function sendState(){
  if(!plugin)return;
  const payload=JSON.stringify(state);
  if(payload===lastPayload)return;
  lastPayload=payload;
  plugin.setState({...state}).then(result=>{
    if(result)applyBottomInset(result.bottomInset);
  }).catch(error=>console.warn('[TanJi] 原生底栏状态同步失败',error));
}
export function syncNativeTabs(update={}){
  if(!plugin)return;
  Object.assign(state,update);
  sendState();
}
function syncOverlay(){
  syncNativeTabs({overlay:cropOpen?'crop':sheetOpen?'sheet':'none'});
}
export function setNativeSheetOpen(open){
  if(!plugin)return;
  sheetOpen=open;
  clearTimeout(sheetTimer);
  if(open){syncOverlay();return}
  sheetTimer=setTimeout(()=>{sheetTimer=null;syncOverlay()},360);
}
export function setNativeCropOpen(open){
  if(!plugin)return;
  cropOpen=open;
  syncOverlay();
}
export function refreshNativeOverlay(){syncOverlay()}
export function initNativeTabs(showTab){
  if(initialized||!isNative||!CAP?.Capacitor?.registerPlugin)return;
  initialized=true;
  plugin=CAP.Capacitor.registerPlugin('NativeTabs');
  window.addEventListener('tanjiNativeLayout',event=>applyBottomInset(event.bottomInset));
  window.addEventListener('tanjiNativeTab',event=>{
    if(!TAB_IDS.has(event.tab))return;
    state.appliedCommandId=event.commandId??null;
    showTab(event.tab);
    const heading=document.querySelector('#v-'+event.tab+' h1');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}
  });
  syncNativeTabs();
}
