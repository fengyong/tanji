<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { app, getApi, ensureDeviceID, work, refreshOrders } from './lib/session';
import AuthView from './views/AuthView.vue';
import HomeView from './views/HomeView.vue';
import TripView from './views/TripView.vue';
import OrdersView from './views/OrdersView.vue';
import StatsView from './views/StatsView.vue';
import SharedView from './views/SharedView.vue';
import SettingsView from './views/SettingsView.vue';
import OrderDetailSheet from './components/OrderDetailSheet.vue';
import OrderFormSheet from './components/OrderFormSheet.vue';
import PaySheet from './components/PaySheet.vue';
import SyncBadge from './components/SyncBadge.vue';

const tab = ref<'home' | 'trip' | 'orders' | 'stats' | 'settings'>('home');
const detailId = ref<string | null>(null);
const formSheet = ref<{ mode: 'new' | 'edit'; id?: string } | null>(null);
const paySheet = ref<{ id: string; kind: 'deposit' | 'final' } | null>(null);
const privacy = ref(localStorage.getItem('tanji_privacy') === '1');
const bootError = ref('');

function setPrivacy(v: boolean) {
  privacy.value = v;
  localStorage.setItem('tanji_privacy', v ? '1' : '0');
}

async function boot() {
  try {
    ensureDeviceID();
    const s = await getApi().getSession();
    await import('./lib/session').then((m) => m.openWorkspace({
      user_id: s.user_id, nickname: s.nickname, email: s.email, session_id: s.session_id,
    }));
  } catch (e) {
    // 401 → 未登录;其他错误也先回登录页,避免阻塞
    if (e instanceof Error && !/401|unauthorized|会话/.test(e.message)) {
      bootError.value = e.message;
    }
    app.phase = 'logged-out';
  }
}
onMounted(boot);

async function afterAuth() {
  // 登录成功后恢复工作区(含待恢复队列对账)
  const m = await import('./lib/session');
  const s = await getApi().getSession();
  await m.openWorkspace({ user_id: s.user_id, nickname: s.nickname, email: s.email, session_id: s.session_id });
  await m.resumeAfterRelogin();
}

function openDetail(id: string) {
  detailId.value = id;
}
function closeSheets() {
  detailId.value = null;
  formSheet.value = null;
  paySheet.value = null;
}
async function refresh() {
  await refreshOrders();
}

const privacyCls = computed(() => (privacy.value ? 'on' : ''));
</script>

<template>
  <div class="stage">
    <div class="caption">探记 TanJi · 云端版(本地优先,离线可用)——演示界面与正式版布局一致</div>
    <div class="phone">
      <!-- 加载中 -->
      <div v-if="app.phase === 'boot'" class="view" style="display:flex;align-items:center;justify-content:center">
        <div class="auth-sub">正在打开本机数据…</div>
      </div>

      <!-- 登录/注册 -->
      <AuthView v-else-if="app.phase === 'logged-out'" @authenticated="afterAuth" />

      <!-- 锁定(会话失效) -->
      <div v-else-if="app.phase === 'locked'" class="view">
        <div class="locked-wrap">
          <div style="font-size:40px">🔒</div>
          <div class="auth-title">工作区已锁定</div>
          <div class="auth-sub">{{ app.lockReason }}</div>
          <div class="okbox" style="text-align:left">
            未同步的改动已安全保留在本机待恢复队列,不会上传也不会丢弃。重新登录同一账号后,系统会先与云端对账,再继续同步这些改动。
          </div>
          <button class="btn primary" @click="app.phase = 'logged-out'">重新登录</button>
        </div>
      </div>

      <!-- 工作区 -->
      <template v-else>
        <component
          :is="tab === 'home' ? HomeView : tab === 'trip' ? TripView : tab === 'orders' ? OrdersView : tab === 'stats' ? StatsView : tab === 'settings' ? SettingsView : SharedView"
          @open-detail="openDetail"
          @new-order="formSheet = { mode: 'new' }"
          @edit-order="(id: string) => (formSheet = { mode: 'edit', id })"
          @pay="(v: { id: string; kind: 'deposit' | 'final' }) => (paySheet = v)"
          @goto="(t: 'home' | 'trip' | 'orders' | 'stats' | 'settings' | 'shared') => (tab = t as never)"
          :privacy="privacy"
        />

        <!-- 顶栏右侧:模式 + 同步状态 + 隐私 -->
        <div style="position:absolute;top:22px;right:14px;display:flex;gap:8px;align-items:center;z-index:75">
          <SyncBadge :state="app.sync" :pending="Number(work.meta.pending_ops ?? 0)" />
          <button class="icon-btn" :class="privacyCls" aria-label="隐私模式" @click="setPrivacy(!privacy)">
            <svg class="ic" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path v-if="privacy" d="M4.5 4.5l15 15"/></svg>
          </button>
        </div>

        <!-- 底部导航 -->
        <nav class="tabbar">
          <button class="tab" :class="{ on: tab === 'home' }" @click="tab = 'home'">
            <svg class="ic" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9"/></svg>首页
          </button>
          <button class="tab" :class="{ on: tab === 'trip' }" @click="tab = 'trip'">
            <svg class="ic" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3.5v3M16 3.5v3"/></svg>行程
          </button>
          <button class="tab" :class="{ on: tab === 'orders' }" @click="tab = 'orders'">
            <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/></svg>订单
          </button>
          <button class="tab" :class="{ on: tab === 'stats' }" @click="tab = 'stats'">
            <svg class="ic" viewBox="0 0 24 24"><path d="M5 20V9M12 20V4M19 20v-7"/></svg>统计
          </button>
          <button class="tab" :class="{ on: tab === 'settings' }" @click="tab = 'settings'">
            <svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.4 4-5 7-5s5.8 1.6 7 5"/></svg>我的
          </button>
        </nav>

        <!-- 弹层 -->
        <div class="mask" :class="{ show: detailId || formSheet || paySheet }" @click="closeSheets" />
        <OrderDetailSheet
          v-if="detailId"
          :id="detailId"
          :privacy="privacy"
          @close="closeSheets"
          @edit="(id: string) => ((detailId = null), (formSheet = { mode: 'edit', id }))"
          @pay="(v: { id: string; kind: 'deposit' | 'final' }) => ((detailId = null), (paySheet = v))"
          @changed="refresh"
        />
        <OrderFormSheet
          v-if="formSheet"
          :mode="formSheet.mode"
          :order-id="formSheet.id"
          @close="closeSheets"
          @saved="refresh"
        />
        <PaySheet
          v-if="paySheet"
          :order-id="paySheet.id"
          :kind="paySheet.kind"
          @close="closeSheets"
          @done="refresh"
        />

        <div class="toast" :class="{ show: app.toast }">{{ app.toast }}</div>
      </template>
    </div>
  </div>
</template>
