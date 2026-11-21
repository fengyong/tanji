<script setup lang="ts">
import { computed } from 'vue';
import type { SyncState } from '@tanji/sync';

const props = defineProps<{ state: SyncState | null; pending: number }>();

const view = computed(() => {
  const s = props.state;
  if (!s) return { cls: 'offline', label: '未连接' };
  if (s.status === 'session_invalid') return { cls: 'bad', label: '登录已失效' };
  if (s.openConflicts > 0) return { cls: 'bad', label: `${s.openConflicts} 项冲突` };
  if (s.status === 'syncing') return { cls: 'busy', label: '同步中…' };
  if (s.status === 'offline') return { cls: 'offline', label: '离线 · 改动已保存本机' };
  if (s.status === 'error') return { cls: 'pending', label: '重试中…' };
  if (props.pending > 0) return { cls: 'pending', label: `已保存本机 · 待同步 ${props.pending}` };
  if (s.lastSyncAt) return { cls: 'ok', label: '已同步' };
  return { cls: 'offline', label: '初始化…' };
});
</script>

<template>
  <span class="syncbadge" :class="view.cls" :title="state?.lastError ?? ''">
    <span class="dot" />{{ view.label }}
  </span>
</template>
