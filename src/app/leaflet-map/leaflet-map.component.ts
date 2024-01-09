import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { WeatherApiResponse } from '../interface/WeatherApiResponse'; 
import { MarkerData } from '../interface/MarkerData';
import * as L from 'leaflet';

@Component({
  selector: 'app-leaflet-map',
  templateUrl: './leaflet-map.component.html',
  styleUrls: ['./leaflet-map.component.css'],
  standalone: true
})

export class LeafletMapComponent implements OnInit {
  private map!: L.Map;
  private temperatureLegend!: L.Control;
  private temperatureWeatherReportLegend!: L.Control;
  private markers: L.Marker[] = [];
  private temperatureData: any[] = [];
  private markerData: MarkerData[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      import('leaflet').then(L => {
        this.map = L.map('map').setView([51.2562, 7.1508], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        const averageTemp = this.temperatureData.reduce((sum, data) => sum + data.temp, 0) / this.temperatureData.length;
        this.addTemperatureLegend(averageTemp);
        this.initializeTemperatureData();
        this.updateTemperatureData();
        this.fetchTemperatureData();
        this.addLegend();
        this.addDigitalShadowLegend();
        this.createMarkers();
      });
      
      setInterval(() => {
        const averageTemp = this.calculateOverallAverageTemperature();
        this.updateTemperatureLegend(averageTemp);
      }, 5000);
    }
  }

  private initializeTemperatureData() {
    this.fetchTemperatureData().subscribe(initialTemp => {
        this.initializeWeatherReportLegend(initialTemp);

        this.http.get<any>('assets/modified_wuppertal_quartiere.json').subscribe(data => {
            this.temperatureData = [];

            data.features.forEach((feature: any) => {
                if (feature.properties.sensors && feature.properties.sensors.length > 0) {
                    let sensor = feature.properties.sensors[0];
                    let temp = this.randomizeTemperature(initialTemp);

                    this.temperatureData.push({
                        temp: temp,
                        lat: sensor.lat,
                        lng: sensor.lng,
                        coordinates: feature.geometry.coordinates,
                        name: feature.properties.NAME
                    });

                    this.markerData.push({
                        temp: temp,
                        lat: sensor.lat,
                        lng: sensor.lng
                    });
                }
            });

            this.createMarkers();
            this.initializePolygonLayer();
        });
    });
  }

  private randomizeTemperature(baseTemp: number): number {
    const variation = Math.random() * 4 - 1;
    const result = parseFloat((baseTemp + variation).toFixed(2));
    return result;
  }

  private updateTemperatureData() {
    this.temperatureData.forEach(data => {
      if (data.polygonLayer) {
        data.polygonLayer.setStyle({ fillColor: this.getColor(data.temp) });
      }
    });
  }

  private initializePolygonLayer(): void {
    this.temperatureData.forEach(data => {
      if (data.coordinates) {
        
        const polygon = L.polygon(data.coordinates, { 
          fillColor: this.getColor(data.temp), 
          fillOpacity: 0.7, 
          color: "white"})
        .addTo(this.map);

        const resetStyle = () => {
          polygon.setStyle({
            fillColor: this.getColor(data.temp),
            fillOpacity: 0.7
          });
        };

        const highlightPolygon = () => {
          polygon.setStyle({
            fillColor: this.getColor(data.temp),
            fillOpacity: 1.0
          });
        };

        const updateLegend = (content: string) => {
          const legendDiv = document.getElementById('info-legend');
          if (legendDiv) {
            legendDiv.innerHTML = content;
            legendDiv.style.display = 'block';
          }
        };

        polygon.on('mouseover', (e) => {
          highlightPolygon();
          const markersInside = this.getMarkersInsidePolygon(polygon);
          const meanTemp = this.calculateMeanTemperature(markersInside);
          const content = `<strong>` + data.name + `</strong>` + `<br><br> ⌀ Temperatur: ${meanTemp.toFixed(2)}°C`;
          updateLegend(content);
        });

        polygon.on('mouseout', (e) => {
          resetStyle();
          updateLegend('');
          document.getElementById('info-legend')!.style.display = 'none';
        });

        polygon.on('click', (e) => {
          const bounds = polygon.getBounds();
          this.map.fitBounds(bounds);
        });

        polygon.on('contextmenu', (e) => {
          const clickLocation = e.latlng;
          const marker = L.marker([clickLocation.lat, clickLocation.lng], {icon: this.createIcon('assets/temperature_new.png')}).addTo(this.map);
  
          marker.on('contextmenu', () => {
            this.map.removeLayer(marker);
          });
        });

        polygon.on('contextmenu', (e) => {
          const clickLocation = e.latlng;
      
          let tempValueString: string | null = prompt("Please enter the temperature value:", "");
      
          if (tempValueString !== null && tempValueString.trim() !== "" && !isNaN(Number(tempValueString))) {
              let tempValue: number = Number(tempValueString);
      
              const marker = L.marker([clickLocation.lat, clickLocation.lng], {icon: this.createIcon('assets/temperature_new.png')}).addTo(this.map);
      
              this.markerData.push({
                  lat: clickLocation.lat,
                  lng: clickLocation.lng,
                  temp: tempValue
              });
      
              marker.bindPopup(`Temperatur: ${tempValue}°C`).openTooltip();
      
              marker.on('click', () => {
                  marker.openTooltip();
              });
      
              marker.on('contextmenu', () => {
                  this.map.removeLayer(marker);
                  this.markerData = this.markerData.filter(md => md.lat !== clickLocation.lat || md.lng !== clickLocation.lng);
              });
          } else {
              alert("Please enter a valid temperature value.");
          }
        });

        data.polygonLayer = polygon;
      }
    });
  }

  private getMarkersInsidePolygon(polygon: L.Polygon): any[] {
    return this.markerData.filter(markerData => {
      return this.isMarkerInsidePolygon(markerData, polygon);
    });
  }

  private isMarkerInsidePolygon(marker: MarkerData, polygon: L.Polygon): boolean {
    const x = marker.lat, y = marker.lng;
    let inside = false;
  
    const processVertices = (vertices: L.LatLng[]) => {
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].lat, yi = vertices[i].lng;
        const xj = vertices[j].lat, yj = vertices[j].lng;
  
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
  
        if (intersect) inside = !inside;
      }
    };
  
    const allVertices = polygon.getLatLngs();
  
    if (Array.isArray(allVertices)) {
      if (allVertices.length > 0 && Array.isArray(allVertices[0])) {
        allVertices.forEach(part => {
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
  
  private calculateMeanTemperature(markers: Array<any>): number {
    const total = markers.reduce((acc, marker) => acc + marker.temp, 0);
    return markers.length > 0 ? total / markers.length : 0;
  }

  private calculateOverallAverageTemperature() {
    if (this.markerData.length === 0) {
        return 0;
    }
    return this.markerData.reduce((sum, marker) => sum + marker.temp, 0) / this.markerData.length;
  }

  private updateTemperatureLegend(averageTemp: number) {
    this.map.removeControl(this.temperatureLegend);
    this.addTemperatureLegend(averageTemp);
  }

  private addLegend() {
    const legend = new L.Control({ position: 'bottomright' });
  
    legend.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'info legend');
      const temperatureRanges = [0, 5, 10, 15, 20, 25, 30, 35];
      const colors = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43'];
  
      for (let i = 0; i < temperatureRanges.length; i++) {
        div.innerHTML +=
          '<i style="background:' + colors[i] + '"></i> ' +
          temperatureRanges[i] + (temperatureRanges[i + 1] ? '&ndash;' + temperatureRanges[i + 1] + '°C<br>' : '°C+');
      }
  
      return div;
    };
  
    legend.addTo(this.map);
  }

  private addTemperatureLegend(averageTemp: number) {
    this.temperatureLegend = new L.Control({ position: 'topright' });
    this.temperatureLegend.onAdd = function (map) {
      const div = L.DomUtil.create('div', 'info legend');
      div.innerHTML = `<h4>⌀ Temperatur</h4>${averageTemp.toFixed(2)} °C`;
      return div;
    };
    this.temperatureLegend.addTo(this.map);
  }

  private addTemperatureWeatherReportLegend(temperature: number) {
    if (this.temperatureWeatherReportLegend) {
      this.map.removeControl(this.temperatureWeatherReportLegend);
    }
    this.temperatureWeatherReportLegend = new L.Control({ position: 'topright' });

    this.temperatureWeatherReportLegend.onAdd = function (map) {
      const div = L.DomUtil.create('div', 'info temperature-legend');
      div.innerHTML = `<h4>Wetterbericht</h4>${temperature.toFixed(2)} °C`;
      return div;
    };

    this.temperatureWeatherReportLegend.addTo(this.map);
  }

  private addDigitalShadowLegend() {
    const descriptionLegend = new L.Control({ position: 'bottomleft' });
  
    descriptionLegend.onAdd = function (map) {
      const div = L.DomUtil.create('div', 'info description-legend');
      div.innerHTML = `<h4>Digitaler Schatten</h4>
      <p>Der digitale Schatten bezeichnet die digitale Spur, <br>die wir durch unsere Interaktionen mit verschiedenen <br> Technologien hinterlassen. <br><br>Diese Spuren, die von Online-Aktivitäten, <br> Standortdaten bis hin zu Sensordaten reichen, <br>bieten Einblicke in Verhaltensmuster und Präferenzen, <br>sind aber auch eng mit Datenschutzfragen verknüpft.</p>`;
      return div;
    };
  
    descriptionLegend.addTo(this.map);
  }

  private createMarkers() {
    this.markers = [];
    this.temperatureData.forEach((data) => {
        const icon = this.createIcon('assets/temperature.png');

        const marker = L.marker([data.lat, data.lng], { icon: icon })
            .bindPopup(`Temperatur: ${data.temp}°C`);
        marker.addTo(this.map);
        this.markers.push(marker);
    });
  }

  private updateMarkers() {
    this.markers.forEach((marker, index) => {
      const temp = this.temperatureData[index].temp;
      marker.setPopupContent(`Temperatur: ${temp.toFixed(2)}°C`);
    });
  }

  private createIcon(path: string): L.Icon {
    const iconUrl = path;
  
    return L.icon({
      iconUrl: iconUrl,
      iconSize: [15, 30],
      iconAnchor: [0, 30],
      popupAnchor: [7, -30]
    });
  }

  private initializeWeatherReportLegend(temperature: number): void {
    this.addTemperatureWeatherReportLegend(temperature);
  }

  private fetchTemperatureData(): Observable<number> {
    const apiUrl = 'http://api.weatherstack.com/current?access_key=37e2da2c2917f40932030c5cbab0d188&query=Wuppertal&units=m'; 
    return this.http.get<WeatherApiResponse>(apiUrl).pipe(
        map(data => {
            if (data && data.current && typeof data.current.temperature === 'number') {
                return data.current.temperature;
            } else {
                throw new Error('Invalid data structure');
            }
        }),
        catchError(err => {
            console.error('Error fetching weather data:', err);
            return of(0);
        })
    );
}

  public getColor(d: number): string {
    return d >= 35 ? '#f46d43' :
           d >= 30  ? '#fdae61' :
           d >= 25  ? '#fee090' :
           d >= 20  ? '#e0f3f8' :
           d >= 15   ? '#abd9e9' :
           d >= 10   ? '#74add1' :
           d >= 5   ? '#4575b4' :
                      '#313695';
  }

  onResize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }
}