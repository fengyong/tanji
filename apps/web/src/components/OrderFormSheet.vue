<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getLedger, app, toast, refreshOrders } from '../lib/session';
import { parseYuanToCents, formatCents, todayISO, conflictFor, toZonedLocalInput, CATEGORIES, uuidV4 } from '@tanji/domain';

const props = defineProps<{ mode: 'new' | 'edit'; orderId?: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const settings = ref<{ collect_threshold_days: number; timezone: string }>({ collect_threshold_days: 15, timezone: 'Asia/Shanghai' });
const form = ref({
  store: '', category: '其他', settle_via: 'private', channel: '直客', contact: '', note: '',
  appt_local: `${todayISO('Asia/Shanghai')}T10:00`, price: '', deposit: '',
  partner_name: '', partner_user_id: '', address: '',
});
const err = ref('');
const lockedMoney = ref(false);
const contacts = ref<Record<string, unknown>[]>([]);
const allOrders = ref<{ appt_local: string; store: string }[]>([]);

const tz = computed(() => settings.value.timezone || 'Asia/Shanghai');

onMounted(async () => {
  const l = getLedger();
  settings.value = (await l.call('settings')) as { collect_threshold_days: number; timezone: string };
  contacts.value = (await l.call('listContacts')) as Record<string, unknown>[];
  allOrders.value = (await l.call('listOrders', {})) as never[];
  if (props.mode === 'edit' && props.orderId) {
    const o = (await l.call('getOrder', { id: props.orderId })) as Record<string, unknown> | null;
    if (!o) { toast('订单不存在'); emit('close'); return; }
    form.value = {
      store: String(o.store), category: String(o.category), settle_via: String(o.settle_via),
      channel: String(o.channel), contact: String(o.contact), note: String(o.note),
      appt_local: String(o.appt_local),
      price: formatCents(Number(o.price_cents)), deposit: formatCents(Number(o.deposit_cents)),
      partner_name: String(o.partner_name ?? ''), partner_user_id: String(o.partner_user ?? ''),
      address: String(o.place_address ?? ''),
    };
    lockedMoney.value = hasAnyReceipt(o);
  }
});

function hasAnyReceipt(o: Record<string, unknown>): boolean {
  const pays = (o.payments ?? []) as { entry_type: string; reverses_id?: string }[];
  return pays.some((p) => p.entry_type === 'receipt' && !p.reverses_id);
}

const conflictMsg = computed(() =>
  conflictFor(allOrders.value as never, apptUTC.value || '', tz.value, (iso, t) => toZonedLocalInput(iso, t), props.orderId));
const apptUTC = computed(() => {
  try {
    return utcFromLocal(form.value.appt_local, tz.value);
  } catch {
    return '';
  }
});
function utcFromLocal(local: string, tzv: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error('时间格式无效');
  const naive = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tzv, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(naive));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return new Date(naive - (asUTC - naive)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function save() {
  err.value = '';
  const priceCents = parseYuanToCents(form.value.price, false);
  const depositCents = parseYuanToCents(form.value.deposit, true);
  if (!form.value.store.trim()) { err.value = '请填写商家名称'; return; }
  if (priceCents === null || depositCents === null || depositCents > priceCents) {
    err.value = '总价和定金须为有效金额(最多两位小数),定金不能超过总价';
    return;
  }
  if (!form.value.appt_local) { err.value = '请填写预约时间'; return; }
  const l = getLedger();
  const place = form.value.address.trim() ? { address: form.value.address.trim() } : undefined;
  try {
    if (props.mode === 'new') {
      const partner = form.value.partner_user_id
        ? { type: 'account' as const, user_id: form.value.partner_user_id }
        : form.value.partner_name.trim()
          ? { type: 'external' as const, external_name: form.value.partner_name.trim() }
          : undefined;
      await l.call('createOrder', {
        sessionId: app.user?.session_id ?? null,
        payload: {
          id: uuidV4(), store: form.value.store, category: form.value.category,
          contact: form.value.contact, note: form.value.note,
          price_cents: priceCents, deposit_cents: depositCents,
          appt_local: form.value.appt_local, timezone: tz.value,
          settle_via: form.value.settle_via, channel: form.value.channel || '直客',
          place, partner,
        },
      });
      toast(`已添加预约:${form.value.store}(已保存本机)`);
    } else if (props.orderId) {
      const changes: Record<string, unknown> = {
        store: form.value.store, category: form.value.category, contact: form.value.contact,
        note: form.value.note, channel: form.value.channel || '直客',
        settle_via: form.value.settle_via, appt_local: form.value.appt_local,
      };
      if (!lockedMoney.value) {
        changes.price_cents = priceCents;
        changes.deposit_cents = depositCents;
      }
      changes.place = place ?? { address: '' };
      await l.call('updateOrder', { id: props.orderId, changes, sessionId: app.user?.session_id ?? null });
      toast('已保存修改(已保存本机)');
    }
    await refreshOrders();
    emit('saved');
    emit('close');
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <div class="sheet show">
    <div class="sheet-head">
      <div class="sheet-title">{{ mode === 'new' ? '新建预约' : '编辑订单' }}</div>
      <button class="sheet-close" @click="emit('close')">✕</button>
    </div>
    <div class="auth-wrap">
      <div class="frow"><label>商家名称</label><input v-model="form.store" placeholder="店名"></div>
      <div class="frow">
        <label>类型</label>
        <select v-model="form.category"><option v-for="c in CATEGORIES" :key="c">{{ c }}</option></select>
      </div>
      <div class="frow">
        <label>结算方式</label>
        <select v-model="form.settle_via">
          <option value="private">私收(微信/支付宝/银行卡)</option>
          <option value="douyin">抖音商单(平台结算)</option>
        </select>
      </div>
      <div class="frow"><label>渠道</label><input v-model="form.channel" placeholder="如:蜂向/小爱/金城/食物/直客"></div>
      <div class="frow">
        <label>出镜搭档(账号)</label>
        <select v-model="form.partner_user_id">
          <option value="">不组队 / 单人拍摄</option>
          <option v-for="c in contacts" :key="c.user_id as string" :value="c.user_id">{{ c.nickname }}</option>
        </select>
      </div>
      <div class="frow"><label>或外部搭档名字</label><input v-model="form.partner_name" placeholder="外部搭档(尚未注册账号)"></div>
      <div class="frow"><label>预约时间</label><input v-model="form.appt_local" type="datetime-local"></div>
      <div v-if="conflictMsg" class="banner-amber" style="margin:0" v-html="conflictMsg" />
      <div class="frow"><label>总价(¥)</label><input v-model="form.price" inputmode="decimal" :readonly="lockedMoney" placeholder="0.00"></div>
      <div class="frow"><label>定金(¥)</label><input v-model="form.deposit" inputmode="decimal" :readonly="lockedMoney" placeholder="0(支持 0 元无定金)"></div>
      <div v-if="lockedMoney" class="errbox">已有收款记录,不能修改总价和定金;请先撤销错误收款再改。</div>
      <div class="frow"><label>地址(第一版手填,可空)</label><input v-model="form.address" placeholder="门店地址文本"></div>
      <div class="frow"><label>联系方式</label><input v-model="form.contact" placeholder="客户联系人/电话(仅自己可见)"></div>
      <div class="frow"><label>备注</label><textarea v-model="form.note" rows="2" /></div>
      <div v-if="err" class="errbox">{{ err }}</div>
      <button class="btn primary" @click="save">保存(先写入本机 SQLite)</button>
      <div class="rsub" style="text-align:center">保存成功≠云端已确认;联网后自动同步,状态见顶部</div>
    </div>
  </div>
</template>
