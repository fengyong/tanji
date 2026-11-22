// HTTP 客户端:Cookie(同源 Web)或 Bearer(原生/测试)认证;CSRF 双提交。
// 所有认证响应 Cache-Control: no-store(服务端已设);客户端不缓存认证响应。
import type { PushRequest, PushResponse, PullPage, OpEnvelope, OpResult } from '@tanji/domain';

export interface SessionView {
  user_id: string;
  nickname: string;
  email: string;
  session_id: string;
  device_id: string;
  auth_epoch: number;
  settings: { collect_threshold_days: number; timezone: string };
}

export interface ContactView {
  contact_id: string;
  user_id: string;
  nickname: string;
  auth_relation_generation: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Bearer 模式(原生/集成测试);Web 默认走 Cookie + CSRF */
  bearerToken?: string;
  /** 读取 CSRF 令牌(来自登录响应或非 HttpOnly cookie) */
  csrfToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private baseUrl: string;
  private bearerToken?: string;
  private csrfToken?: () => string | undefined;
  private fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.bearerToken = opts.bearerToken;
    this.csrfToken = opts.csrfToken;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;
    const csrf = this.csrfToken?.();
    if (csrf) headers['X-Tanji-CSRF'] = csrf;
    // 请求超时:引擎不会因单个请求挂死(SSE 不走本客户端)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    if (!resp.ok) {
      const err = (data ?? {}) as { code?: string; message?: string };
      throw new ApiError(resp.status, err.code ?? `http_${resp.status}`, err.message ?? resp.statusText);
    }
    return data as T;
  }

  // ---- 认证 ----

  async register(email: string, password: string, nickname: string) {
    return this.request<{ ok: boolean; message: string; dev_code?: string }>('POST', '/v1/auth/register', { email, password, nickname });
  }

  async verifyEmail(email: string, code: string) {
    return this.request<{ ok: boolean; message: string }>('POST', '/v1/auth/verify-email', { email, code });
  }

  async login(email: string, password: string, deviceID: string) {
    return this.request<SessionView & { csrf: string; expires_at: string }>('POST', '/v1/auth/login', { email, password, device_id: deviceID });
  }

  async logout() {
    return this.request<{ ok: boolean }>('POST', '/v1/auth/logout', {});
  }

  async getSession(): Promise<SessionView> {
    return this.request<SessionView>('GET', '/v1/session');
  }

  async forgotPassword(email: string) {
    return this.request<{ ok: boolean; message: string; dev_code?: string }>('POST', '/v1/auth/password/forgot', { email });
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    return this.request<{ ok: boolean; message: string }>('POST', '/v1/auth/password/reset', {
      email, code, new_password: newPassword,
    });
  }

  // ---- 联系人 ----

  async createInvite(inviteeUserID?: string, inviteeEmail?: string) {
    return this.request<{ invite_id: string; token: string; expires_at: string }>('POST', '/v1/contact-invites', {
      ...(inviteeUserID ? { invitee_user_id: inviteeUserID } : {}),
      ...(inviteeEmail ? { invitee_email: inviteeEmail } : {}),
    });
  }

  async acceptInvite(token: string) {
    return this.request<{ ok: boolean }>('POST', '/v1/contact-invites/accept', { token });
  }

  async listContacts(): Promise<{ contacts: ContactView[] }> {
    return this.request<{ contacts: ContactView[] }>('GET', '/v1/contacts');
  }

  async deleteContact(contactID: string) {
    return this.request<{ ok: boolean }>('DELETE', `/v1/contacts/${contactID}`);
  }

  // ---- 同步 ----

  async push(req: PushRequest): Promise<PushResponse> {
    return this.request<PushResponse>('POST', '/v1/sync/push', req);
  }

  async pull(cursor: string | undefined, limit: number): Promise<PullPage> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return this.request<PullPage>('GET', `/v1/sync/pull?${q.toString()}`);
  }

  async receipts(opIDs: string[]): Promise<{ receipts: OpResult[] }> {
    return this.request<{ receipts: OpResult[] }>('POST', '/v1/sync/receipts', { op_ids: opIDs });
  }

  async bootstrap(opIDs: string[], pageSize = 100) {
    return this.request<{ snapshot_id: string; pages: number; stream_epoch: number; high_water: string; expires_at: string }>(
      'POST', '/v1/sync/bootstrap', { op_ids: opIDs, page_size: pageSize });
  }

  async bootstrapPage(snapshotID: string, page: number): Promise<{ page: number; payload: unknown; checksum: string }> {
    return this.request('GET', `/v1/sync/bootstrap/${snapshotID}/pages/${page}`);
  }

  async sharedList(): Promise<{ shares: { projection: import('@tanji/domain').ScheduleProjection }[] }> {
    return this.request('GET', '/v1/shared');
  }
}

export type { OpEnvelope };
