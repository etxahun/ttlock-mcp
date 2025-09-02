import axios from 'axios';
import qs from 'qs';
import { Env } from './env.js';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  uid: number;
  expires_in: number;
  scope: string;
};

type TTError = { errcode?: number; errmsg?: string };

function assertNoTTError<T extends TTError>(data: T) {
  if (typeof data?.errcode === 'number' && data.errcode !== 0) {
    const msg = data.errmsg || `TTLock error ${data.errcode}`;
    const e = new Error(msg) as Error & { code?: number };
    e.code = data.errcode;
    throw e;
  }
}

export class TTLockClient {
  private accessToken?: string;
  private refreshToken?: string;

  constructor(
    private base = Env.TTLOCK_API_BASE,
    private clientId = Env.TTLOCK_CLIENT_ID,
    private clientSecret = Env.TTLOCK_CLIENT_SECRET,
  ) {}

  isAuthed() {
    return Boolean(this.accessToken);
  }

  // === OAuth (password MD5 en minúsculas) ===
  async login(username: string, passwordMd5: string): Promise<void> {
    const url = `${this.base}/oauth2/token`;
    const body = qs.stringify({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username,
      password: passwordMd5,
    });
    const { data } = await axios.post<TokenResponse>(url, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
  }

  async refresh(): Promise<void> {
    if (!this.refreshToken) throw new Error('No refresh token — haz login primero.');
    const url = `${this.base}/oauth2/refreshToken`;
    const body = qs.stringify({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });
    const { data } = await axios.post<TokenResponse>(url, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
  }

  private ensureToken() {
    if (!this.accessToken) throw new Error('No autenticado — llama a login().');
  }

  // Helper POST x-www-form-urlencoded para v3
  private async postForm<T>(path: string, form: Record<string, any> = {}): Promise<T> {
    this.ensureToken();
    const url = `${this.base}${path}`;
    const body = qs.stringify({
      clientId: this.clientId,
      accessToken: this.accessToken,
      date: Date.now(),
      ...form,
    });
    const { data } = await axios.post<T & TTError>(url, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    assertNoTTError(data);
    return data as T;
  }

  // === Locks ===
  async listLocks(params?: { pageNo?: number; pageSize?: number }) {
    return this.postForm<{ list: any[]; pageNo: number; pages: number; total: number }>('/v3/lock/list', params ?? {});
  }

  async getLockDetail(lockId: number) {
    return this.postForm<any>('/v3/lock/detail', { lockId });
  }

  async unlock(lockId: number) {
    return this.postForm<any>('/v3/lock/unlock', { lockId });
  }

  async lock(lockId: number) {
    return this.postForm<any>('/v3/lock/lock', { lockId });
  }

  // === IC Cards ===
  async listCards(lockId: number, pageNo = 1, pageSize = 50) {
    return this.postForm<any>('/v3/identityCard/list', { lockId, pageNo, pageSize });
  }

  async addCardViaGateway(
    lockId: number,
    cardNumber: string,
    cardName?: string,
    startDate?: number,
    endDate?: number
  ) {
    return this.postForm<any>('/v3/identityCard/add', {
      lockId,
      cardNumber,
      cardName,
      startDate: startDate ?? 0,
      endDate: endDate ?? 0,
      addType: 2 // vía gateway/cloud
    });
  }

  // === IC Cards: Delete / Clear ===
  async deleteCard(lockId: number, cardId: number, deleteType: 1 | 2 | 3 = 2) {
    // deleteType: 1 = BLE, 2 = Gateway (recomendado si tienes gateway), 3 = NB-IoT
    return this.postForm<any>('/v3/identityCard/delete', { lockId, cardId, deleteType });
  }

  async clearCards(lockId: number) {
    // Vacía TODAS las tarjetas de la cerradura
    // (en algunos modelos la doc indica hacer clear vía BLE antes; prueba en tu hardware)
    return this.postForm<any>('/v3/identityCard/clear', { lockId });
  }

  // === Unlock records (accesos) ===
  async listUnlockRecords(
    lockId: number,
    pageNo = 1,
    pageSize = 50,
    startDate?: number,  // epoch ms (opcional)
    endDate?: number     // epoch ms (opcional)
  ) {
    const form: any = { lockId, pageNo, pageSize };
    if (startDate !== undefined) form.startDate = startDate;
    if (endDate !== undefined) form.endDate = endDate;
    return this.postForm<any>('/v3/lockRecord/list', form);
  }
}
