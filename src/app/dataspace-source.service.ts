import { Injectable } from '@angular/core';
import {
  getContainedResourceUrlAll,
  getDatetime,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getThingAll,
  getUrl,
  getUrlAll,
} from '@inrupt/solid-client';
import { DCAT, DCTERMS, FOAF, LDP, RDF } from '@inrupt/vocab-common-rdf';
import { SolidAuthService } from './solid-auth.service';

const SDM_NS = 'https://w3id.org/solid-dataspace-manager#';
const SDM = {
  accessDecision: `${SDM_NS}AccessDecision`,
  decision: `${SDM_NS}decision`,
  decidedAt: `${SDM_NS}decidedAt`,
  datasetIdentifier: `${SDM_NS}datasetIdentifier`,
  datasetAccessUrl: `${SDM_NS}datasetAccessUrl`,
  expiresAt: `${SDM_NS}expiresAt`,
};

const REGISTRY_PRESETS = [
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/stadt-wuppertal',
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/dace',
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/timberconnect',
];

const REQUESTER_WEB_ID =
  'https://tmdt-solid-community-server.de/heatmonitoringapp/profile/card#me';
const REQUESTER_POD = 'https://tmdt-solid-community-server.de/heatmonitoringapp/';

export type DecisionState = 'approved' | 'denied' | 'revoked' | 'expired' | 'pending' | 'none';

export interface TempJsonSource {
  key: string;
  identifier: string;
  title: string;
  accessUrl: string;
  ownerWebId: string;
  isPublic: boolean;
}

export interface AccessDecisionItem {
  key: string;
  state: DecisionState;
  decidedAt: string;
  expiresAt: string;
}

export interface SensorReading {
  ts: string;
  temperature: number;
  humidity: number;
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class DataspaceSourceService {
  private readonly noCacheFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    this.auth.fetch(input, {
      ...init,
      cache: 'no-store',
      headers: { ...(init?.headers || {}), 'Cache-Control': 'no-cache' },
    });

  constructor(private auth: SolidAuthService) {}

  getRequesterWebId(): string {
    return REQUESTER_WEB_ID;
  }

  async discoverTempJsonSources(): Promise<TempJsonSource[]> {
    const requesterWebId = this.auth.webId() || REQUESTER_WEB_ID;
    const members = await this.loadRegistryMembers(requesterWebId);
    const catalogs = await Promise.all(
      members.map(async (member) => this.resolveCatalogUrl(member))
    );
    const uniqueCatalogs = Array.from(new Set(catalogs.filter((v): v is string => Boolean(v))));
    const sourceLists = await Promise.all(uniqueCatalogs.map(async (catalogUrl) => this.loadCatalogSources(catalogUrl)));
    const merged = sourceLists.flat();
    const dedupe = new Map<string, TempJsonSource>();

    merged.forEach((entry) => {
      if (!this.isTempJson(entry.accessUrl)) return;
      if (!dedupe.has(entry.key)) {
        dedupe.set(entry.key, entry);
      }
    });

    return Array.from(dedupe.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  async requestRestrictedAccess(source: TempJsonSource, message: string): Promise<void> {
    if (!this.auth.isLoggedIn()) {
      throw new Error('Please sign in with Solid first.');
    }

    const inbox = await this.resolveInboxUrl(source.ownerWebId);
    if (!inbox) {
      throw new Error('Owner inbox not configured.');
    }

    const now = new Date().toISOString();
    const requesterWebId = this.auth.webId() || REQUESTER_WEB_ID;
    const turtle = [
      `@prefix sdm: <${SDM_NS}>.`,
      '@prefix dct: <http://purl.org/dc/terms/>.',
      '@prefix as: <https://www.w3.org/ns/activitystreams#>.',
      '@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.',
      '',
      '<> a sdm:AccessRequest, as:Offer;',
      `  dct:created "${now}"^^xsd:dateTime;`,
      '  sdm:status "pending";',
      `  sdm:requesterWebId <${requesterWebId}>;`,
      '  sdm:requesterName "Smart City Urban Heat Monitoring";',
      '  sdm:requesterEmail "noreply@smartcityurbanheatmonitoring.local";',
      `  sdm:datasetIdentifier "${this.escapeLiteral(source.identifier)}";`,
      `  sdm:datasetTitle "${this.escapeLiteral(source.title)}";`,
      `  sdm:datasetAccessUrl <${source.accessUrl}>;`,
      `  sdm:message "${this.escapeLiteral(message)}";`,
      '  .',
    ].join('\n');

    const response = await this.noCacheFetch(inbox, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/turtle',
        Slug: `access-request-${source.identifier}-${Date.now()}`,
      },
      body: turtle,
    });

    if (!response.ok) {
      throw new Error(`Access request failed (${response.status}).`);
    }
  }

  async loadLatestReading(url: string): Promise<SensorReading> {
    const response = await this.noCacheFetch(url);
    if (!response.ok) {
      throw new Error(`Could not load source (${response.status}).`);
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Source contains no readings.');
    }

    const validRows = data
      .map((row) => this.toReading(row))
      .filter((row): row is SensorReading => row !== null)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    if (validRows.length === 0) {
      throw new Error('No valid temperature rows in source.');
    }

    return validRows[validRows.length - 1];
  }

  async loadDecisionStateBySourceKey(): Promise<Map<string, AccessDecisionItem>> {
    const requesterWebId = this.auth.webId() || REQUESTER_WEB_ID;
    const inbox = (await this.resolveInboxUrl(requesterWebId)) || `${REQUESTER_POD}inbox/`;
    const result = new Map<string, AccessDecisionItem>();

    const inboxDataset = await getSolidDataset(inbox, { fetch: this.noCacheFetch });
    const resourceUrls = getContainedResourceUrlAll(inboxDataset);
    const parsed = await Promise.all(
      resourceUrls.map(async (url) => {
        try {
          return await this.parseDecisionResource(url);
        } catch {
          return null;
        }
      })
    );

    parsed
      .filter((item): item is AccessDecisionItem => item !== null)
      .forEach((item) => {
        const existing = result.get(item.key);
        const existingTime = existing ? Date.parse(existing.decidedAt || '') : 0;
        const nextTime = Date.parse(item.decidedAt || '');
        if (!existing || nextTime >= existingTime) {
          result.set(item.key, item);
        }
      });

    return result;
  }

  private async parseDecisionResource(url: string): Promise<AccessDecisionItem | null> {
    const dataset = await getSolidDataset(url, { fetch: this.noCacheFetch });
    const thing = getThing(dataset, url) || getThingAll(dataset)[0];
    if (!thing) return null;

    const types = getUrlAll(thing, RDF.type);
    if (!types.includes(SDM.accessDecision)) return null;

    const identifier = getStringNoLocale(thing, SDM.datasetIdentifier) || '';
    const datasetAccessUrl = getUrl(thing, SDM.datasetAccessUrl) || '';
    const key = this.buildSourceKey(identifier, datasetAccessUrl);
    if (!key) return null;

    const decision = (getStringNoLocale(thing, SDM.decision) || '').toLowerCase();
    const decidedAt =
      getDatetime(thing, SDM.decidedAt)?.toISOString() ||
      getStringNoLocale(thing, SDM.decidedAt) ||
      '';
    const expiresAt = getStringNoLocale(thing, SDM.expiresAt) || '';
    const now = Date.now();
    const expiresTs = Date.parse(expiresAt);

    let state: DecisionState = 'none';
    if (decision === 'approved') {
      if (!Number.isNaN(expiresTs) && expiresTs <= now) {
        state = 'expired';
      } else {
        state = 'approved';
      }
    } else if (decision === 'denied') {
      state = 'denied';
    } else if (decision === 'revoked') {
      state = 'revoked';
    }

    return { key, state, decidedAt, expiresAt };
  }

  private async loadRegistryMembers(baseWebId: string): Promise<string[]> {
    const config = await this.loadRegistryConfig(baseWebId);
    const containers =
      config.mode === 'private'
        ? [config.privateRegistry]
        : config.registries.length > 0
          ? config.registries
          : REGISTRY_PRESETS;

    const allMembers = new Set<string>();
    await Promise.all(
      containers
        .map((url) => this.normalizeContainerUrl(url))
        .filter(Boolean)
        .map(async (containerUrl) => {
          try {
            const container = await getSolidDataset(containerUrl, { fetch: this.noCacheFetch });
            const resources = getContainedResourceUrlAll(container);
            await Promise.all(
              resources.map(async (resourceUrl) => {
                try {
                  const entry = await getSolidDataset(resourceUrl, { fetch: this.noCacheFetch });
                  const thing = getThing(entry, `${resourceUrl}#it`) || getThingAll(entry)[0];
                  if (!thing) return;
                  const member = getUrl(thing, FOAF.member);
                  if (member) allMembers.add(member);
                } catch {
                  // Ignore malformed registry entries.
                }
              })
            );
          } catch {
            // Ignore inaccessible registries.
          }
        })
    );

    return Array.from(allMembers);
  }

  private async loadRegistryConfig(webId: string): Promise<{
    mode: 'research' | 'private';
    registries: string[];
    privateRegistry: string;
  }> {
    const profileDoc = webId.split('#')[0];
    const defaults = {
      mode: 'research' as const,
      registries: [] as string[],
      privateRegistry: `${this.getPodRoot(webId)}registry/`,
    };
    try {
      const dataset = await getSolidDataset(profileDoc, { fetch: this.noCacheFetch });
      const thing = getThing(dataset, webId);
      if (!thing) return defaults;
      const modeRaw = (getStringNoLocale(thing, `${SDM_NS}registryMode`) || 'research').toLowerCase();
      const registries = (getUrlAll(thing, `${SDM_NS}registry`) || []).filter(Boolean);
      const privateRegistry = getUrl(thing, `${SDM_NS}privateRegistry`) || defaults.privateRegistry;
      return {
        mode: modeRaw === 'private' ? 'private' : 'research',
        registries,
        privateRegistry,
      };
    } catch {
      return defaults;
    }
  }

  private async resolveCatalogUrl(webId: string): Promise<string> {
    try {
      const profileDoc = webId.split('#')[0];
      const dataset = await getSolidDataset(profileDoc, { fetch: this.noCacheFetch });
      const thing = getThing(dataset, webId) || getThingAll(dataset)[0];
      return thing ? getUrl(thing, DCAT.catalog) || '' : '';
    } catch {
      return '';
    }
  }

  private async resolveInboxUrl(webId: string): Promise<string> {
    try {
      const profileDoc = webId.split('#')[0];
      const dataset = await getSolidDataset(profileDoc, { fetch: this.noCacheFetch });
      const thing = getThing(dataset, webId) || getThingAll(dataset)[0];
      return thing ? getUrl(thing, LDP.inbox) || '' : '';
    } catch {
      return '';
    }
  }

  private async loadCatalogSources(catalogUrl: string): Promise<TempJsonSource[]> {
    const catalogDoc = this.getDocumentUrl(catalogUrl);
    const catalogDataset = await getSolidDataset(catalogDoc, { fetch: this.noCacheFetch });
    const catalogThing = getThing(catalogDataset, catalogUrl);
    if (!catalogThing) return [];
    const datasetUrls = (getUrlAll(catalogThing, DCAT.dataset) || [])
      .map((url) => this.resolveUrl(url, catalogDoc))
      .filter(Boolean);

    const sources = await Promise.all(
      datasetUrls.map(async (datasetUrl) => {
        try {
          return await this.parseSourceFromDataset(datasetUrl);
        } catch {
          return null;
        }
      })
    );
    return sources.filter((item): item is TempJsonSource => item !== null);
  }

  private async parseSourceFromDataset(datasetUrl: string): Promise<TempJsonSource | null> {
    const docUrl = this.getDocumentUrl(datasetUrl);
    const datasetDoc = await getSolidDataset(docUrl, { fetch: this.noCacheFetch });
    const thing = getThing(datasetDoc, datasetUrl) || getThing(datasetDoc, `${docUrl}#it`) || getThingAll(datasetDoc)[0];
    if (!thing) return null;

    const datasetType = getUrlAll(thing, RDF.type);
    const isSeries = datasetType.includes('http://www.w3.org/ns/dcat#DatasetSeries');
    if (isSeries) return null;

    const identifier = getStringNoLocale(thing, DCTERMS.identifier) || datasetUrl;
    const title = getStringNoLocale(thing, DCTERMS.title) || 'Untitled source';
    const ownerWebId = getUrl(thing, DCTERMS.creator) || '';
    const accessRights = (getStringNoLocale(thing, DCTERMS.accessRights) || '').toLowerCase();
    const distributions = getUrlAll(thing, DCAT.distribution) || [];

    let accessUrl = '';
    for (const distUrl of distributions) {
      const resolvedDistUrl = this.resolveUrl(distUrl, docUrl);
      const distThing = getThing(datasetDoc, resolvedDistUrl) || getThing(datasetDoc, distUrl);
      if (!distThing) continue;
      const downloadUrl =
        this.resolveUrl(getUrl(distThing, DCAT.downloadURL) || '', docUrl) ||
        this.resolveUrl(getUrl(distThing, DCAT.accessURL) || '', docUrl);
      if (downloadUrl) {
        accessUrl = downloadUrl;
        break;
      }
    }
    if (!accessUrl) return null;

    const key = this.buildSourceKey(identifier, accessUrl);
    if (!key) return null;

    return {
      key,
      identifier,
      title,
      accessUrl,
      ownerWebId,
      isPublic: accessRights === 'public',
    };
  }

  buildSourceKey(identifier: string, accessUrl: string): string {
    if (identifier) return identifier;
    return accessUrl;
  }

  private toReading(row: unknown): SensorReading | null {
    if (!row || typeof row !== 'object') return null;
    const candidate = row as Record<string, unknown>;
    const ts = typeof candidate['ts'] === 'string' ? candidate['ts'] : '';
    const temperature = Number(candidate['temperature']);
    const humidity = Number(candidate['humidity']);
    const lat = Number(candidate['lat']);
    const lng = Number(candidate['lng']);

    if (!ts || Number.isNaN(Date.parse(ts))) return null;
    if ([temperature, humidity, lat, lng].some((n) => Number.isNaN(n))) return null;
    return { ts, temperature, humidity, lat, lng };
  }

  private isTempJson(url: string): boolean {
    const lower = this.getDocumentUrl(url).toLowerCase();
    return lower.endsWith('.json') && lower.includes('temp');
  }

  private getDocumentUrl(resourceUrl: string): string {
    return resourceUrl.split('#')[0];
  }

  private resolveUrl(value: string, base: string): string {
    if (!value) return '';
    try {
      return new URL(value, base).href;
    } catch {
      return value;
    }
  }

  private normalizeContainerUrl(value: string): string {
    if (!value) return '';
    try {
      const url = new URL(value);
      return url.href.endsWith('/') ? url.href : `${url.href}/`;
    } catch {
      return value.endsWith('/') ? value : `${value}/`;
    }
  }

  private getPodRoot(webId: string): string {
    const parsed = new URL(webId);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const profileIndex = segments.indexOf('profile');
    const baseSegments = profileIndex > -1 ? segments.slice(0, profileIndex) : segments;
    const basePath = baseSegments.length ? `/${baseSegments.join('/')}/` : '/';
    return `${parsed.origin}${basePath}`;
  }

  private escapeLiteral(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
  }
}
