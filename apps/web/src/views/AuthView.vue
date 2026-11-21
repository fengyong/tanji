<script setup lang="ts">
import { reactive, ref } from 'vue';
import { getApi, ensureDeviceID, toast } from '../lib/session';
import { ApiError } from '@tanji/api-client';

const emit = defineEmits<{ authenticated: [] }>();

const mode = ref<'login' | 'register' | 'register-verify' | 'forgot' | 'reset'>('login');
const busy = ref(false);
const err = ref('');
const notice = ref('');
const devCode = ref('');
const form = reactive({
  email: '', password: '', nickname: '', code: '',
});

function switchMode(m: typeof mode.value) {
  mode.value = m;
  err.value = '';
  notice.value = '';
  devCode.value = '';
}

async function submit() {
  err.value = '';
  busy.value = true;
  const api = getApi();
  try {
    if (mode.value === 'register') {
      const r = await api.register(form.email, form.password, form.nickname);
      if (r.dev_code) devCode.value = r.dev_code;
      notice.value = '验证码已发送(开发环境见下方提示),请输入完成验证';
      mode.value = 'register-verify';
    } else if (mode.value === 'register-verify') {
      await api.verifyEmail(form.email, form.code);
      toast('账号已激活,请登录');
      mode.value = 'login';
    } else if (mode.value === 'login') {
      await api.login(form.email, form.password, ensureDeviceID());
      emit('authenticated');
    } else if (mode.value === 'forgot') {
      const r = await api.forgotPassword(form.email);
      if (r.dev_code) devCode.value = r.dev_code;
      notice.value = '如果该邮箱已注册,找回验证码已发送';
      mode.value = 'reset';
    } else if (mode.value === 'reset') {
      await api.resetPassword(form.email, form.code, form.password);
      toast('密码已重置,请用新密码登录');
      mode.value = 'login';
    }
  } catch (e) {
    const apiErr = e as ApiError;
    err.value = apiErr.message ?? String(e);
    if (apiErr.status === 401 && mode.value === 'login') err.value = '邮箱或密码不正确';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="view">
    <div class="auth-title">探记 TanJi</div>
    <div class="auth-sub">
      {{ mode === 'login' ? '达人你好,登录后离线也能记账,联网自动同步' :
         mode === 'register' ? '注册邮箱账号,激活后开始使用' :
         mode === 'register-verify' ? '输入邮件里的 6 位验证码完成激活' :
         mode === 'forgot' ? '输入注册邮箱,我们将发送找回验证码' :
         '输入验证码与新密码(至少 12 位)' }}
    </div>

    <form class="auth-wrap" @submit.prevent="submit">
      <template v-if="mode === 'login'">
        <div class="frow"><label>邮箱</label><input v-model="form.email" type="email" autocomplete="email" required></div>
        <div class="frow"><label>密码</label><input v-model="form.password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" :disabled="busy" type="submit">{{ busy ? '登录中…' : '登录' }}</button>
        <div style="display:flex;justify-content:space-between">
          <button class="linklike" type="button" @click="switchMode('register')">注册新账号</button>
          <button class="linklike" type="button" @click="switchMode('forgot')">忘记密码</button>
        </div>
      </template>

      <template v-else-if="mode === 'register'">
        <div class="frow"><label>邮箱</label><input v-model="form.email" type="email" required></div>
        <div class="frow"><label>昵称(搭档会看到)</label><input v-model="form.nickname" required></div>
        <div class="frow"><label>密码(至少 12 位,允许密码管理器长口令)</label><input v-model="form.password" type="password" required></div>
        <button class="btn primary" :disabled="busy" type="submit">{{ busy ? '提交中…' : '获取验证码' }}</button>
        <button class="linklike" type="button" @click="switchMode('login')">返回登录</button>
      </template>

      <template v-else-if="mode === 'register-verify'">
        <div class="frow"><label>验证码</label><input v-model="form.code" inputmode="numeric" maxlength="6" required></div>
        <div v-if="devCode" class="okbox">开发环境验证码:{{ devCode }}(生产环境以邮件为准)</div>
        <button class="btn primary" :disabled="busy" type="submit">完成验证</button>
        <button class="linklike" type="button" @click="switchMode('register')">返回</button>
      </template>

      <template v-else-if="mode === 'forgot'">
        <div class="frow"><label>邮箱</label><input v-model="form.email" type="email" required></div>
        <button class="btn primary" :disabled="busy" type="submit">发送找回验证码</button>
        <button class="linklike" type="button" @click="switchMode('login')">返回登录</button>
      </template>

      <template v-else>
        <div class="frow"><label>验证码</label><input v-model="form.code" inputmode="numeric" maxlength="6" required></div>
        <div v-if="devCode" class="okbox">开发环境验证码:{{ devCode }}(生产环境以邮件为准)</div>
        <div class="frow"><label>新密码(至少 12 位)</label><input v-model="form.password" type="password" required></div>
        <button class="btn primary" :disabled="busy" type="submit">重置密码</button>
        <button class="linklike" type="button" @click="switchMode('login')">返回登录</button>
      </template>

      <div v-if="err" class="errbox">{{ err }}</div>
      <div v-if="notice" class="okbox">{{ notice }}</div>
    </form>
  </div>
</template>
