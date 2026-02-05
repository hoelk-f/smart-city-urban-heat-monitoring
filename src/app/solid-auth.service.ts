import { Injectable } from '@angular/core';
import { Session } from '@inrupt/solid-client-authn-browser';

@Injectable({ providedIn: 'root' })
export class SolidAuthService {
  private readonly session = new Session();

  async init(): Promise<void> {
    if (typeof window === 'undefined') return;
    await this.session.handleIncomingRedirect({
      url: window.location.href,
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
