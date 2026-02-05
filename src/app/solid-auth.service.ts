import { Injectable } from '@angular/core';
import { Session } from '@inrupt/solid-client-authn-browser';

const sessionStorageWrapper = {
  get: async (key: string): Promise<string | undefined> =>
    typeof window === 'undefined'
      ? undefined
      : window.sessionStorage.getItem(key) ?? undefined,
  set: async (key: string, value: string): Promise<void> => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(key, value);
    }
  },
  delete: async (key: string): Promise<void> => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(key);
    }
  },
};

@Injectable({ providedIn: 'root' })
export class SolidAuthService {
  private readonly session = new Session({
    clientName: 'Smart City Urban Heat Monitoring',
    sessionId: 'smart-city-urban-heat-monitoring',
    secureStorage: sessionStorageWrapper,
    insecureStorage: sessionStorageWrapper,
  });

  async init(): Promise<void> {
    if (typeof window === 'undefined') return;
    await this.session.handleIncomingRedirect(window.location.href, {
      restorePreviousSession: true,
    });
  }

  async login(): Promise<void> {
    if (typeof window === 'undefined') return;
    await this.session.login({
      oidcIssuer: 'https://solidcommunity.net',
      redirectUrl: window.location.href,
      clientName: 'Smart City Urban Heat Monitoring',
    });
  }

  async logout(): Promise<void> {
    if (!this.session.info.isLoggedIn) return;
    await this.session.logout();
  }

  isLoggedIn(): boolean {
    return this.session.info.isLoggedIn;
  }

  webId(): string {
    return this.session.info.webId || '';
  }

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.session.info.isLoggedIn) {
      return this.session.fetch(input, init);
    }
    return fetch(input, init);
  }
}
