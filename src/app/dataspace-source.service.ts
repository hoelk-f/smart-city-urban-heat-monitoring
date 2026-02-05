import { Injectable } from '@angular/core';
import {
  getContainedResourceUrlAll,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getThingAll,
  getUrl,
  getUrlAll,
} from '@inrupt/solid-client';
import { DCAT, DCTERMS, FOAF, RDF } from '@inrupt/vocab-common-rdf';

const REGISTRY_CONTAINERS = [
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/stadt-wuppertal',
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/timberconnect',
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/dace',
  // Fallback aliases matching manually typed registry names.
  'https://tmdt-solid-community-server.de/semanticdatacatalog/stadt wuppertal/',
  'https://tmdt-solid-community-server.de/semanticdatacatalog/timberconnect/',
  'https://tmdt-solid-community-server.de/semanticdatacatalog/dace/',
];

export interface TempJsonSource {
  key: string;
  identifier: string;
  title: string;
  accessUrl: string;
  ownerWebId: string;
  isPublic: boolean;
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
    fetch(input, {
      ...init,
      cache: 'no-store',
      headers: { ...(init?.headers || {}), 'Cache-Control': 'no-cache' },
    });

  async discoverTempJsonSources(): Promise<TempJsonSource[]> {
    const allSources = await this.discoverAllSources();
    return allSources.filter(
      (entry) => this.matchesTempTitle(entry.title) && !this.isIgnoredDataset(entry.title)
    );
  }

  async discoverPublicSources(): Promise<TempJsonSource[]> {
    const allSources = await this.discoverAllSources();
    return allSources.filter((entry) => entry.isPublic);
  }

  async discoverAllSources(): Promise<TempJsonSource[]> {
    const members = await this.loadRegistryMembers();
    const catalogs = await Promise.all(members.map(async (member) => this.resolveCatalogUrl(member)));
    const uniqueCatalogs = Array.from(new Set(catalogs.filter((value): value is string => Boolean(value))));
    const sourceLists = await Promise.all(uniqueCatalogs.map(async (catalogUrl) => this.loadCatalogSources(catalogUrl)));
    const merged = sourceLists.flat();
    const dedupe = new Map<string, TempJsonSource>();

    merged.forEach((entry) => {
      if (!dedupe.has(entry.key)) {
        dedupe.set(entry.key, entry);
      }
    });

    return Array.from(dedupe.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  async loadLatestReading(url: string): Promise<SensorReading> {
    const latestReadings = await this.loadLatestReadings(url, 1);
    if (latestReadings.length === 0) {
      throw new Error('No valid temperature rows in source.');
    }
    return latestReadings[latestReadings.length - 1];
  }

  async loadLatestReadings(url: string, limit = 10): Promise<SensorReading[]> {
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

    if (validRows.length === 0) return [];
    if (limit <= 0) return [];
    return validRows.slice(-limit);
  }

  buildSourceKey(identifier: string, accessUrl: string): string {
    if (identifier) return identifier;
    return accessUrl;
  }

  private async loadRegistryMembers(): Promise<string[]> {
    const allMembers = new Set<string>();

    await Promise.all(
      REGISTRY_CONTAINERS.map((url) => this.normalizeContainerUrl(url)).map(async (containerUrl) => {
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

  private async resolveCatalogUrl(webId: string): Promise<string> {
    if (!webId) return '';
    try {
      const profileDoc = webId.split('#')[0];
      const dataset = await getSolidDataset(profileDoc, { fetch: this.noCacheFetch });
      const thing = getThing(dataset, webId) || getThingAll(dataset)[0];
      const profileCatalog = thing ? getUrl(thing, DCAT.catalog) || '' : '';
      if (profileCatalog) return profileCatalog;
    } catch {
      // Fallback to default catalog location below.
    }

    try {
      return this.getCatalogResourceUrl(webId);
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

  private matchesTempTitle(title: string): boolean {
    return /temp/i.test(title || '');
  }

  private isIgnoredDataset(title: string): boolean {
    return (title || '').trim().toLowerCase() === 'road temperature sensor data in seattle';
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
    const sanitized = value.trim().replace(/ /g, '%20');
    try {
      const url = new URL(sanitized);
      return url.href.endsWith('/') ? url.href : `${url.href}/`;
    } catch {
      return sanitized.endsWith('/') ? sanitized : `${sanitized}/`;
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

  private getCatalogResourceUrl(webId: string): string {
    return `${this.getPodRoot(webId)}catalog/cat.ttl#it`;
  }
}
