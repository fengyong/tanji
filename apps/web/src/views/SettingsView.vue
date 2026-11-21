<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { work, app, getApi, getLedger, refreshOrders, logout, toast, lockWorkspace } from '../lib/session';
import { formatMoney, formatCents, todayISO } from '@tanji/domain';
import { parseLegacyBackup, previewLegacyBackup, migrateLegacyBackup } from '@tanji/domain';
import { grantSetID } from '@tanji/domain';

const emit = defineEmits<{ goto: [tab: string] }>();

const settings = computed(() => work.settings as { collect_threshold_days: number; timezone: string });
const contacts = ref<Record<string, unknown>[]>([]);
const invites = ref<{ token: string; invite_id: string }[]>([]);
const conflicts = ref<Record<string, unknown>[]>([]);
const shared = ref<Record<string, unknown>[]>([]);
const busy = ref(false);
const importPreview = ref<null | ReturnType<typeof previewLegacyBackup>>(null);
const importItems = ref<ReturnType<typeof migrateLegacyBackup> | null>(null);
const importSource = ref('');
const importTZ = ref('Asia/Shanghai');

onMounted(async () => { await reload(); });

async function reload() {
  const l = getLedger();
  contacts.value = (await l.call('listContacts')) as Record<string, unknown>[];
  conflicts.value = (await l.call('listConflicts')) as Record<string, unknown>[];
  shared.value = (await l.call('listShared')) as Record<string, unknown>[];
  try {
    const r = await getApi().listContacts();
    contacts.value = (await l.call('mergeContacts', { contacts: r.contacts })) as Record<string, unknown>[];
  } catch { /* 离线:用本地缓存 */ }
}

async function setThreshold(days: number) {
  const l = getLedger();
  try {
    await l.call('updateSettings', { changes: { collect_threshold_days: days }, sessionId: app.user?.session_id ?? null });
    await refreshOrders();
    toast(`催收阈值已设为 ${days} 天(已保存本机,等待同步)`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

// ---- 联系邀请 ----
const inviteToken = ref('');
async function createInvite() {
  try {
    const r = await getApi().createInvite(undefined, undefined);
    inviteToken.value = r.token;
    invites.value.push({ token: r.token, invite_id: r.invite_id });
    toast('邀请已创建,把凭据发给对方');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
async function acceptInvite() {
  if (!inviteToken.value.trim()) return;
  try {
    await getApi().acceptInvite(inviteToken.value.trim());
    inviteToken.value = '';
    toast('已建立联系');
    await reload();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
async function deleteContact(id: string) {
  if (!window.confirm('删除联系后,该关系代次下所有订单授权同时失效,对方缓存将在联网后清除。确认?')) return;
  try {
    await getApi().deleteContact(id);
    toast('联系已删除,授权撤销中');
    await reload();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

// ---- 冲突处理 ----
function conflictIntent(c: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(c.intent as string);
}
function conflictServer(c: Record<string, unknown>): Record<string, unknown> | null {
  return c.server_content ? JSON.parse(c.server_content as string) : null;
}
async function resolveKeepServer(id: string) {
  await getLedger().call('resolveConflictKeepServer', { conflictId: id });
  await reload();
  await refreshOrders();
  toast('已采用云端内容,本地意图已保留在冲突记录');
}
async function resolveRetry(id: string) {
  await getLedger().call('resolveConflictRetry', { conflictId: id });
  await reload();
  await refreshOrders();
  toast('已以当前云端版本重建更正操作,等待同步');
}

// ---- 旧数据迁移 ----
async function onImportFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MB');
    const backup = parseLegacyBackup(await file.text());
    const preview = previewLegacyBackup(backup, importTZ.value);
    importPreview.value = preview;
    importItems.value = migrateLegacyBackup(backup, importTZ.value, []);
    importSource.value = `${file.name}:${preview.orders}:${preview.payments}:${preview.receivedTotalCents}`;
    if (preview.issues.some((i) => i.level === 'error')) {
      toast('备份存在无法安全转换的项目,请核对预览');
    }
  } catch (e) {
    toast(`不能导入:${e instanceof Error ? e.message : String(e)}`);
    importPreview.value = null;
  }
}
async function confirmImport() {
  if (!importItems.value || !importSource.value) return;
  busy.value = true;
  try {
    const r = (await getLedger().call('importLegacy', {
      sourceDataset: importSource.value, items: importItems.value, sessionId: app.user?.session_id ?? null,
    })) as { created: number; skipped: number };
    toast(`已导入 ${r.created} 笔订单(跳过重复 ${r.skipped});上传需你的明确确认`);
    importPreview.value = null;
    importItems.value = null;
    await refreshOrders();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

// ---- 导出 ----
function exportJson() {
  const doc = {
    app: '探记 TanJi 云端版', version: 'cloud-0.1', exportedAt: new Date().toISOString(),
    orders: work.orders, settings: work.settings,
  };
  download(`探记-云端备份-${todayISO('Asia/Shanghai')}.json`, JSON.stringify(doc, null, 2), 'application/json');
  toast('已导出 JSON 备份(仅本人账本)');
}
function download(name: string, content: string, type: string) {
  const blob = new Blob(["\ufeff" + content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2500);
}

const money = (c: number) => formatMoney(c);
const cents = (c: number) => formatCents(c);
</script>

<template>
  <div class="view">
    <div class="htop-row">
      <div>
        <div class="eyebrow">{{ app.user?.email }}</div>
        <h1 class="big">{{ app.user?.nickname }}</h1>
        <div class="hsub">设备 {{ app.user?.session_id.slice(0, 8) }}… · 同一账号只允许一处在线</div>
      </div>
    </div>

    <!-- 同步状态 -->
    <div class="card" style="margin-top:12px">
      <div class="sec-title" style="margin:0 0 8px">同步状态</div>
      <div class="rsub" style="white-space:normal;line-height:1.7">
        <template v-if="app.sync?.status === 'session_invalid'">⚠️ 登录已失效:上传已停止,本机改动保留在待恢复队列。</template>
        <template v-else-if="app.sync?.openConflicts">⚠️ 有 {{ app.sync.openConflicts }} 项同步冲突待处理(见下方)。</template>
        <template v-else-if="app.sync?.status === 'offline'">网络不可用:可继续离线记账,恢复联网后自动双向同步。</template>
        <template v-else-if="Number(work.meta.pending_ops ?? 0) > 0">已保存在本机,等待上传 {{ work.meta.pending_ops }} 项(云端未确认,不宣称已云备份)。</template>
        <template v-else>已同步:本机变更均获云端确认(最后确认 {{ app.sync?.lastSyncAt?.slice(11, 19) ?? '—' }})。</template>
      </div>
    </div>

    <!-- 冲突 -->
    <template v-if="conflicts.length">
      <div class="sec-title">同步冲突(保留双方,不会静默覆盖)</div>
      <div v-for="c in conflicts" :key="c.id as string" class="card" style="margin-bottom:10px">
        <div class="rname">订单的本地修改被云端拒绝</div>
        <div class="rsub">原因:{{ c.error_code === 'entity_deleted' ? '订单已在云端删除' : '云端版本已前进' }}</div>
        <div class="frow" style="margin-top:8px">
          <label>我的待同步修改</label>
          <div class="okbox" style="white-space:pre-wrap">{{ JSON.stringify(conflictIntent(c), null, 1) }}</div>
        </div>
        <div class="frow" style="margin-top:8px" v-if="conflictServer(c)">
          <label>云端当前内容</label>
          <div class="errbox" style="white-space:pre-wrap">{{ JSON.stringify(conflictServer(c), null, 1).slice(0, 400) }}</div>
        </div>
        <div class="btn2" style="margin-top:10px">
          <button class="btn tint" @click="resolveRetry(c.id as string)">以云端当前版本重建更正</button>
          <button class="btn ghost" @click="resolveKeepServer(c.id as string)">放弃本地,采用云端</button>
        </div>
      </div>
    </template>

    <!-- 搭档与联系 -->
    <div class="sec-title">搭档联系({{ contacts.length }})</div>
    <div class="card rows">
      <div v-for="c in contacts" :key="c.contact_id as string" class="row">
        <div class="rmain">
          <div class="rname">{{ c.nickname }}</div>
          <div class="rsub">已关联账号 · 关系代次 {{ c.generation }}</div>
        </div>
        <button class="mini-btn" style="background:var(--red-soft);color:var(--red);border:none;border-radius:10px;padding:7px 12px;font-weight:700" @click="deleteContact(c.contact_id as string)">删除联系</button>
      </div>
      <div v-if="!contacts.length" class="empty">还没有已关联的账号搭档</div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="rsub" style="white-space:normal;line-height:1.6;margin-bottom:8px">
        邀请对方:发送一次性凭据(72 小时有效);对方接受后可被选择为订单搭档。建立联系本身不共享任何订单。
      </div>
      <div class="btn2">
        <button class="btn tint" :disabled="busy" @click="createInvite">生成邀请凭据</button>
      </div>
      <div v-if="inviteToken" class="okbox" style="margin-top:8px;white-space:pre-wrap">邀请凭据(只显示一次):\n{{ inviteToken }}</div>
      <div class="frow" style="margin-top:10px">
        <label>输入对方的邀请凭据</label>
        <input v-model="inviteToken" placeholder="粘贴对方发来的凭据">
      </div>
      <button class="btn tint" style="margin-top:8px" @click="acceptInvite">接受邀请</button>
    </div>

    <!-- 旧数据迁移 -->
    <div class="sec-title">从旧版本迁移</div>
    <div class="card">
      <div class="rsub" style="white-space:normal;line-height:1.6;margin-bottom:8px">
        选择旧站点导出的 JSON 备份。迁移前先预览;同一来源重复导入不会重复建单;旧搭档按外部搭档处理,时间按所选时区解释。
      </div>
      <div class="frow">
        <label>时区解释(旧数据无时区)</label>
        <select v-model="importTZ">
          <option>Asia/Shanghai</option><option>UTC</option>
        </select>
      </div>
      <input type="file" accept=".json" style="margin-top:10px" @change="onImportFile" />
      <div v-if="importPreview" style="margin-top:10px">
        <div class="okbox" style="white-space:normal;line-height:1.8">
          {{ importSource.split(':')[0] }}:{{ importPreview.orders }} 笔订单、{{ importPreview.payments }} 笔流水、
          实收 {{ money(importPreview.receivedTotalCents) }}、催收阈值 {{ importPreview.threshold }} 天、时区 {{ importPreview.timezone }}。
        </div>
        <div v-for="(issue, i) in importPreview.issues" :key="i" class="errbox" style="margin-top:6px">{{ issue.message }}</div>
        <div class="btn2" style="margin-top:10px">
          <button class="btn primary" :disabled="busy" @click="confirmImport">确认导入到本机(暂不上传)</button>
          <button class="btn ghost" @click="importPreview = null">取消</button>
        </div>
      </div>
    </div>

    <!-- 导出 -->
    <div class="sec-title">数据导出(仅本人账本)</div>
    <div class="card">
      <button class="btn ghost" @click="exportJson">导出 JSON 备份</button>
    </div>

    <!-- 共享给我的入口 -->
    <div class="sec-title">共享给我的档期</div>
    <div class="card rows">
      <div class="row" @click="emit('goto', 'shared')">
        <div class="rmain"><div class="rname">查看搭档分享给我的档期</div><div class="rsub">{{ shared.length }} 个已授权档期(白名单内容)</div></div>
        <svg class="ic" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
    </div>

    <!-- 退出 -->
    <div style="padding:16px 0">
      <button class="btn danger-ghost" @click="logout()">退出登录</button>
      <div class="rsub" style="text-align:center;margin-top:8px">退出前如有未同步改动会先提示;离线退出将锁定本机,云端撤销待联网完成。</div>
    </div>
  </div>
</template>
