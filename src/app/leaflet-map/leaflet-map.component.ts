import * as L from 'leaflet';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MarkerData } from '../interface/MarkerData';
import { SensorDataService } from '../sensor-data.service';
import { DataspaceSourceService, TempJsonSource } from '../dataspace-source.service';

interface TemperatureEntry {
  temp: number;
  lat: number;
  lng: number;
  activated: boolean;
  history: number[];
  coordinates?: L.LatLngExpression[][][];
  name?: string;
  polygonLayer?: L.Polygon;
  sourceKey?: string;
  sourceTitle?: string;
  sourceAccessUrl?: string;
}

interface IntegratedSource {
  key: string;
  title: string;
  accessUrl: string;
}

@Component({
  selector: 'app-leaflet-map',
  templateUrl: './leaflet-map.component.html',
  styleUrls: ['./leaflet-map.component.css'],
  standalone: true,
  imports: [CommonModule],
})
export class LeafletMapComponent implements OnInit, OnDestroy {
  private map!: L.Map;
  private markers: L.Marker[] = [];
  private readonly simulationIntervalMs = 10000;
  private readonly historyLength = 10;
  private readonly simulationDelta = 0.4;
  private readonly minSimulatedTemp = -10;
  private readonly maxSimulatedTemp = 50;
  private simulationTimerId?: number;
  private polygonTimerId?: number;

  public weatherReportTemp = 6.8;
  public temperatureData: TemperatureEntry[] = [];
  public averageTemperature = 0;
  public activeSensorCount = 0;
  public panelOpen = false;
  public sourceModalOpen = false;
  public sourceLoading = false;
  public sourceError = '';
  public requestError = '';
  public activeRegion = {
    name: '',
    temperatureLabel: '',
    count: 0,
    visible: false,
  };

  public publicSources: TempJsonSource[] = [];
  public restrictedSources: TempJsonSource[] = [];
  public integratedSources: IntegratedSource[] = [];
  public requestedRestrictedSourceKeys = new Set<string>();

  public dataSources = {
    geojson:
      'https://tmdt-solid-community-server.de/solidtestpod/public/hma-wuppertal-quartiere.json',
    sensors: [
      'https://tmdt-solid-community-server.de/solidtestpod/public/hma-temp-1.csv',
      'https://tmdt-solid-community-server.de/solidtestpod/public/hma-temp-2.json',
      'https://tmdt-solid-community-server.de/solidtestpod/public/hma-temp-3.csv',
    ],
  };

  public deviationLegend = [
    { label: '0.2Â°C', color: '#008000' },
    { label: '0.4Â°C', color: '#246e00' },
    { label: '0.6Â°C', color: '#495b00' },
    { label: '0.8Â°C', color: '#6d4900' },
    { label: '1.0Â°C', color: '#db1200' },
    { label: '> 1.2Â°C', color: '#ff0000' },
  ];

  public areaLegend = [
    { label: '< 0Â°C', color: '#00008B' },
    { label: '0-6Â°C', color: '#1E90FF' },
    { label: '6-11Â°C', color: '#00CED1' },
    { label: '11-20Â°C', color: '#ADFF2F' },
    { label: '20-30Â°C', color: '#ADFF2F' },
    { label: '30-40Â°C', color: '#FFA500' },
    { label: '> 40Â°C', color: '#8B0000' },
  ];

  constructor(
    private http: HttpClient,
    private sensorDataService: SensorDataService,
    private dataspaceSourceService: DataspaceSourceService
  ) {}

  ngOnInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.map = L.map('map').setView([51.2562, 7.1508], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'Â© OpenStreetMap contributors',
    }).addTo(this.map);

    this.map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      this.addSensorAtLocation(e.latlng);
    });

    void this.initializeTemperatureData();
    this.fetchWeatherReportTemperature();
    this.startSimulationLoop();
  }

  ngOnDestroy(): void {
    if (this.simulationTimerId) window.clearInterval(this.simulationTimerId);
    if (this.polygonTimerId) window.clearInterval(this.polygonTimerId);
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen;
  }

  openSourceModal(): void {
    this.sourceModalOpen = true;
    this.requestError = '';
    this.sourceError = '';
    void this.loadDiscoverableSources();
  }

  closeSourceModal(): void {
    this.sourceModalOpen = false;
    this.sourceError = '';
    this.requestError = '';
  }

  async loadDiscoverableSources(): Promise<void> {
    this.sourceLoading = true;
    this.sourceError = '';
    try {
      const discovered = await this.dataspaceSourceService.discoverTempJsonSources();
      this.publicSources = discovered.filter((source) => source.isPublic);
      this.restrictedSources = discovered.filter((source) => !source.isPublic);
    } catch (err) {
      this.sourceError = this.toErrorMessage(err, 'Could not load discoverable public data sources.');
    } finally {
      this.sourceLoading = false;
    }
  }

  async integratePublicSource(source: TempJsonSource): Promise<void> {
    await this.integrateSource(source);
  }

  requestRestrictedSource(source: TempJsonSource): void {
    if (this.requestedRestrictedSourceKeys.has(source.key)) {
      return;
    }
    this.requestedRestrictedSourceKeys.add(source.key);
    this.requestError = `Access request for "${source.title}" was created (demo only).`;
  }

  removeIntegratedSource(sourceKey: string): void {
    this.integratedSources = this.integratedSources.filter((source) => source.key !== sourceKey);
    this.temperatureData = this.temperatureData.filter((entry) => entry.sourceKey !== sourceKey);
    this.rebuildMarkers();
    this.recalculateStats();
  }

  isSourceIntegrated(sourceKey: string): boolean {
    return this.integratedSources.some((source) => source.key === sourceKey);
  }

  isRestrictedRequested(sourceKey: string): boolean {
    return this.requestedRestrictedSourceKeys.has(sourceKey);
  }

  private async integrateSource(source: TempJsonSource): Promise<void> {
    this.requestError = '';

    if (this.isSourceIntegrated(source.key)) {
      this.requestError = 'Source is already integrated.';
      return;
    }

    try {
      const latestReadings = await this.dataspaceSourceService.loadLatestReadings(
        source.accessUrl,
        this.historyLength
      );
      if (latestReadings.length === 0) {
        throw new Error('Source contains no usable temperature readings.');
      }
      const latest = latestReadings[latestReadings.length - 1];
      this.temperatureData.push({
        temp: latest.temperature,
        lat: latest.lat,
        lng: latest.lng,
        activated: true,
        history: this.normalizeHistory(latestReadings.map((item) => item.temperature)),
        sourceKey: source.key,
        sourceTitle: source.title,
        sourceAccessUrl: source.accessUrl,
      });
      this.integratedSources.push({
        key: source.key,
        title: source.title,
        accessUrl: source.accessUrl,
      });
      this.rebuildMarkers();
      this.recalculateStats();
    } catch (err) {
      this.requestError = this.toErrorMessage(err, 'Could not integrate data source.');
    }
  }

  private fetchWeatherReportTemperature(): void {
    this.http.get('assets/weatherreportapi.csv', { responseType: 'text' }).subscribe({
      next: (data) => {
        const rows = data.split('\n');
        if (rows.length > 1) {
          const [, temperature] = rows[1].split(',');
          const parsed = Number(temperature);
          if (!Number.isNaN(parsed)) {
            this.weatherReportTemp = parsed;
          }
        }
      },
      error: (error) => {
        console.error('Error loading weather report CSV:', error);
      },
    });
  }

  private async initializeTemperatureData(): Promise<void> {
    try {
      const geoJson = await this.http
        .get<any>('https://tmdt-solid-community-server.de/solidtestpod/public/hma-wuppertal-quartiere.json')
        .toPromise();
      if (!geoJson) {
        throw new Error('GeoJSON response empty');
      }

      const solidSensorData = await this.sensorDataService.loadAllSensors();
      this.temperatureData = [];

      geoJson.features.forEach((feature: any) => {
        const district = parseInt(feature.properties.QUARTIER, 10);
        const sensorData = solidSensorData.find(
          (sensor) => parseInt(sensor.district?.toString() ?? '', 10) === district
        );

        if (sensorData) {
          this.temperatureData.push({
            temp: sensorData.temp,
            lat: sensorData.lat,
            lng: sensorData.lng,
            history: this.normalizeHistory([sensorData.temp]),
            coordinates: feature.geometry.coordinates,
            name: feature.properties.NAME,
            activated: sensorData.activated,
          });
        }
      });

      this.rebuildMarkers();
      this.initializePolygonLayer();
      this.recalculateStats();
    } catch (err) {
      console.error('Error loading base Solid Pod sensor data:', err);
    }
  }

  private startSimulationLoop(): void {
    this.simulationTimerId = window.setInterval(() => {
      void this.runSimulationTick();
    }, this.simulationIntervalMs);
  }

  private async runSimulationTick(): Promise<void> {
    this.simulateSensorVariation();
    await this.refreshIntegratedSources();
    this.updateMarkerPopupsAndIcons();
    this.recalculateStats();
  }

  private simulateSensorVariation(): void {
    this.temperatureData.forEach((entry) => {
      if (entry.sourceKey) return;
      const delta = (Math.random() * 2 - 1) * this.simulationDelta;
      const nextValue = Number(entry.temp) + delta;
      entry.temp = this.clamp(nextValue, this.minSimulatedTemp, this.maxSimulatedTemp);
      this.appendHistory(entry, entry.temp);
    });
  }

  private async refreshIntegratedSources(): Promise<void> {
    const externalEntries = this.temperatureData.filter(
      (entry) => Boolean(entry.sourceKey && entry.sourceAccessUrl)
    );

    await Promise.all(
      externalEntries.map(async (entry) => {
        try {
          const readings = await this.dataspaceSourceService.loadLatestReadings(
            entry.sourceAccessUrl as string,
            this.historyLength
          );
          if (readings.length === 0) return;
          const latest = readings[readings.length - 1];
          entry.temp = latest.temperature;
          entry.lat = latest.lat;
          entry.lng = latest.lng;
          entry.history = this.normalizeHistory(readings.map((item) => item.temperature));
        } catch {
          // Keep last known state if source update fails.
        }
      })
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private rebuildMarkers(): void {
    this.markers.forEach((marker) => this.map.removeLayer(marker));
    this.markers = [];

    this.temperatureData.forEach((data) => {
      const iconPath = this.getIconPath(data);
      const marker = L.marker([data.lat, data.lng], { icon: this.createIconStatic(iconPath) });
      marker.bindPopup(this.buildPopupContent(data));

      marker.on('contextmenu', () => {
        data.activated = !data.activated;
        const newIconPath = this.getIconPath(data);
        marker.setIcon(this.createIconStatic(newIconPath));
      });

      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  private updateMarkerPopupsAndIcons(): void {
    this.temperatureData.forEach((entry, index) => {
      const marker = this.markers[index];
      if (!marker) return;
      marker.setLatLng([entry.lat, entry.lng]);
      marker.getPopup()?.setContent(this.buildPopupContent(entry));
      marker.setIcon(this.createIconStatic(this.getIconPath(entry)));
    });
  }

  private buildPopupContent(entry: TemperatureEntry): string {
    const values = this.normalizeHistory(entry.history);
    const chartSvg = this.createSparklineSvg(values);
    const title = entry.sourceTitle ? this.escapeHtml(entry.sourceTitle) : 'Sensor';
    return `<div style="min-width:180px"><strong>${title}</strong><br/>Temperature: ${entry.temp.toFixed(
      2
    )}°C<br/><div style="margin-top:6px">${chartSvg}</div></div>`;
  }

  private getIconPath(entry: TemperatureEntry): string {
    if (!entry.activated) return 'assets/stationary_sensor_disabled.png';
    if (entry.sourceKey) return 'assets/sensor.png';
    return 'assets/stationary_sensor.png';
  }

  private createIconStatic(path: string): L.Icon {
    return L.icon({
      iconUrl: path,
      iconSize: [25, 26],
      iconAnchor: [5, 30],
      popupAnchor: [7, -30],
    });
  }

  private initializePolygonLayer(): void {
    this.temperatureData.forEach((entry) => {
      if (!entry.coordinates) return;

      const polygon = L.polygon(entry.coordinates as L.LatLngExpression[][][], {
        fillColor: this.getColorByAvgTemp(0),
        fillOpacity: 0.4,
        color: this.getColor(1),
        weight: 2,
      }).addTo(this.map);

      polygon.on('mouseover', () => {
        polygon.setStyle({ fillOpacity: 0.7 });
        const inside = this.getMarkersInsidePolygon(polygon);
        const meanTemp = this.calculateMeanTemperature(inside);
        const count = this.countMarkersInsidePolygon(polygon);
        this.activeRegion = {
          name: entry.name || 'Area',
          temperatureLabel: count === 0 ? `Weather report ${this.weatherReportTemp}Â°C` : `Avg. ${meanTemp.toFixed(2)}Â°C`,
          count,
          visible: true,
        };
      });

      polygon.on('mouseout', () => {
        polygon.setStyle({ fillOpacity: 0.4 });
        this.activeRegion = { name: '', temperatureLabel: '', count: 0, visible: false };
      });

      polygon.on('click', () => {
        this.map.fitBounds(polygon.getBounds());
      });

      entry.polygonLayer = polygon;
      this.updateSinglePolygonStyle(entry);
    });

    this.polygonTimerId = window.setInterval(() => {
      this.temperatureData.forEach((entry) => this.updateSinglePolygonStyle(entry));
    }, this.simulationIntervalMs);
  }

  private updateSinglePolygonStyle(entry: TemperatureEntry): void {
    if (!entry.polygonLayer) return;
    const markersInside = this.getMarkersInsidePolygon(entry.polygonLayer);
    const meanTemp = this.calculateMeanTemperature(markersInside);
    const diff = Math.abs(meanTemp - this.weatherReportTemp);
    entry.polygonLayer.setStyle({
      fillColor: this.getColorByAvgTemp(meanTemp),
      color: this.getColor(diff),
      fillOpacity: 0.4,
    });
  }

  private getColorByAvgTemp(avgTemp: number): string {
    return avgTemp < 0
      ? '#00008B'
      : avgTemp < 6
        ? '#1E90FF'
        : avgTemp < 11
          ? '#00CED1'
          : avgTemp < 20
            ? '#ADFF2F'
            : avgTemp < 30
              ? '#ADFF2F'
              : avgTemp < 40
                ? '#FFA500'
                : '#8B0000';
  }

  public getColor(difference: number): string {
    return difference > 1.2
      ? '#ff0000'
      : difference > 1.0
        ? '#db1200'
        : difference > 0.8
          ? '#6d4900'
          : difference > 0.6
            ? '#495b00'
            : difference > 0.4
              ? '#246e00'
              : '#008000';
  }

  private getMarkersInsidePolygon(polygon: L.Polygon): TemperatureEntry[] {
    return this.temperatureData.filter((markerData) => this.isMarkerInsidePolygon(markerData, polygon) && markerData.activated);
  }

  private countMarkersInsidePolygon(polygon: L.Polygon): number {
    return this.getMarkersInsidePolygon(polygon).length;
  }

  private isMarkerInsidePolygon(marker: MarkerData, polygon: L.Polygon): boolean {
    const x = marker.lat;
    const y = marker.lng;
    let inside = false;

    const processVertices = (vertices: L.LatLng[]) => {
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].lat;
        const yi = vertices[i].lng;
        const xj = vertices[j].lat;
        const yj = vertices[j].lng;
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
    };

    const allVertices = polygon.getLatLngs();
    if (Array.isArray(allVertices)) {
      if (allVertices.length > 0 && Array.isArray(allVertices[0])) {
        allVertices.forEach((part) => {
          if (Array.isArray(part) && part.length > 0 && part[0] instanceof L.LatLng) {
            processVertices(part as L.LatLng[]);
          }
        });
      } else if (allVertices[0] instanceof L.LatLng) {
        processVertices(allVertices as L.LatLng[]);
      }
    }

    return inside;
  }

  private calculateMeanTemperature(markers: TemperatureEntry[]): number {
    if (markers.length === 0) return 0;
    const total = markers.reduce((acc, marker) => acc + marker.temp, 0);
    return total / markers.length;
  }

  private calculateOverallAverageTemperature(): number {
    if (this.temperatureData.length === 0) {
      return 0;
    }
    return this.temperatureData.reduce((sum, marker) => sum + marker.temp, 0) / this.temperatureData.length;
  }

  private recalculateStats(): void {
    this.averageTemperature = this.calculateOverallAverageTemperature();
    this.activeSensorCount = this.temperatureData.filter((entry) => entry.activated).length;
  }

  private addSensorAtLocation(latlng: L.LatLng): void {
    const input = prompt('Please enter the temperature value:', '');
    if (input === null || input.trim() === '' || Number.isNaN(Number(input))) {
      alert('Please enter a valid temperature value.');
      return;
    }

    this.temperatureData.push({
      lat: latlng.lat,
      lng: latlng.lng,
      temp: Number(input),
      activated: true,
      history: this.normalizeHistory([Number(input)]),
    });
    this.rebuildMarkers();
    this.recalculateStats();
  }


  private appendHistory(entry: TemperatureEntry, nextValue: number): void {
    entry.history = this.normalizeHistory([...(entry.history || []), nextValue]);
  }

  private normalizeHistory(values: number[]): number[] {
    return values
      .filter((value) => Number.isFinite(value))
      .slice(-this.historyLength);
  }

  private createSparklineSvg(values: number[]): string {
    if (values.length === 0) {
      return '<div style="font-size:12px;color:#64748b">No values</div>';
    }
    const width = 150;
    const height = 42;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    const points = values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * (width - 8) + 4;
        const y = height - ((value - min) / spread) * (height - 8) - 4;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Last ${
      values.length
    } values"><rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc"/><polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  private toErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return fallback;
  }
}
