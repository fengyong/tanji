<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getLedger, app, toast, refreshOrders } from '../lib/session';
import { dueCents, formatMoney, RECEIPT_METHODS, type PaymentEntry } from '@tanji/domain';

const props = defineProps<{ orderId: string; kind: 'deposit' | 'final' }>();
const emit = defineEmits<{ close: []; done: [] }>();

const order = ref<Record<string, unknown> | null>(null);
const method = ref('微信');
const busy = ref(false);

onMounted(async () => {
  const l = getLedger();
  order.value = (await l.call('getOrder', { id: props.orderId })) as Record<string, unknown> | null;
  if (order.value?.settle_via === 'douyin') method.value = '抖音商单';
});

const amount = computed(() => (order.value ? dueCents(order.value as never, (order.value.payments ?? []) as PaymentEntry[], props.kind) : 0));
const label = computed(() => (props.kind === 'deposit' ? '定金' : '尾款'));
const settleLabel = computed(() => (order.value?.settle_via === 'douyin' ? '约定抖音商单结算' : '私收款项'));

async function confirm() {
  busy.value = true;
  try {
    await getLedger().call('recordPayment', {
      id: props.orderId, kind: props.kind, method: method.value, paidAtLocal: 'now',
      sessionId: app.user?.session_id ?? null,
    });
    await refreshOrders();
    emit('done');
    emit('close');
    toast(`已收${label.value} ${formatMoney(amount.value)} · ${method.value}(已保存本机)`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="sheet show">
    <div class="sheet-head">
      <div class="sheet-title">{{ order?.store }}</div>
      <button class="sheet-close" @click="emit('close')">✕</button>
    </div>
    <div style="text-align:center;padding:6px 0 2px">
      <div style="font-size:34px;font-weight:800;margin:8px 0 2px">{{ formatMoney(amount) }}</div>
      <div class="rsub">{{ label }} · {{ settleLabel }} · 仅作入账记录</div>
    </div>
    <div class="sec-title" style="justify-content:center">收款方式(记录用)</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
      <button v-for="m in RECEIPT_METHODS" :key="m" class="mchip" :class="{ on: method === m }" @click="method = m">{{ m }}</button>
    </div>
    <div style="padding:18px 0 4px">
      <button class="btn green" :disabled="busy" @click="confirm">确认收款 {{ formatMoney(amount) }}</button>
      <div class="rsub" style="text-align:center;margin-top:8px">重复点击/请求重试由云端幂等保证,不会重复入账</div>
    </div>
  </div>
</template>
