import { Injectable } from '@angular/core';
import { Session } from '@inrupt/solid-client-authn-browser';

@Injectable({ providedIn: 'root' })
export class SolidAuthService {
  private readonly issuerStorageKey = 'uhm.oidc.issuer';
  private readonly defaultIssuers = [
    'https://tmdt-solid-community-server.de',
    'https://solidcommunity.net',
  ];
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
    const savedIssuer = window.localStorage.getItem(this.issuerStorageKey) || '';
    const issuers = [savedIssuer, ...this.defaultIssuers].filter(
      (value, index, array) => Boolean(value) && array.indexOf(value) === index
    );
    const redirectUrl = `${window.location.origin}${window.location.pathname}`;

    let lastError: unknown = null;
    for (const issuer of issuers) {
      try {
        window.localStorage.setItem(this.issuerStorageKey, issuer);
        await this.session.login({
          oidcIssuer: issuer,
          redirectUrl,
          clientName: 'Smart City Urban Heat Monitoring',
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Solid login could not be started. Please verify your OIDC issuer.');
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
