import * as L from 'leaflet';
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MarkerData } from '../interface/MarkerData';
import { Observable, of } from 'rxjs';
import { WeatherApiResponse } from '../interface/WeatherApiResponse'; 
import { catchError, map } from 'rxjs/operators';


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
  
  private weatherReportTemp: number = 0;
  private temperatureData: any[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      import('leaflet').then(L => {
        this.map = L.map('map').setView([51.2562, 7.1508], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        this.fetchTemperatureData().subscribe(data => {
          this.weatherReportTemp = data;
        });

        const averageTemp = this.temperatureData.reduce((sum, data) => sum + data.temp, 0) / this.temperatureData.length;
        this.addTemperatureLegend(averageTemp);
        this.initializeTemperatureData();
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
    
      this.initializeWeatherReportLegend(this.weatherReportTemp);

      this.http.get<any>('assets/modified_wuppertal_quartiere.json').subscribe(data => {
          this.temperatureData = [];

          data.features.forEach((feature: any) => {
              if (feature.properties.sensors && feature.properties.sensors.length > 0) {
                  let sensor = feature.properties.sensors[0];
                  let temp = this.randomizeTemperature(this.weatherReportTemp);

                  this.temperatureData.push({
                      temp: temp,
                      lat: sensor.lat,
                      lng: sensor.lng,
                      coordinates: feature.geometry.coordinates,
                      name: feature.properties.NAME,
                      activated: sensor.activated
                  });
              }
          });

          this.createMarkers();
          this.initializePolygonLayer();
      });
  }

  private randomizeTemperature(baseTemp: number): number {
    const variation = Math.random() * 4 - 1;
    const result = parseFloat((baseTemp + variation).toFixed(2));
    return result;
  }

  private initializePolygonLayer(): void {
    this.temperatureData.forEach(data => {
      if (data.coordinates) {
        
        const polygon = L.polygon(data.coordinates, {
          fillColor: this.getColor(1), 
          fillOpacity: 0.4, 
          color: "white"})
        .addTo(this.map);

        const resetStyle = () => {
          polygon.setStyle({
            fillColor: this.getColor(this.countMarkersInsidePolygon(polygon)),
            fillOpacity: 0.4
          });
        };

        const highlightPolygon = () => {
          polygon.setStyle({
            fillColor: this.getColor(this.countMarkersInsidePolygon(polygon)),
            fillOpacity: 0.7
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
          var countMarkersInside = this.countMarkersInsidePolygon(polygon);
          
          
          var content = '';
          if(countMarkersInside == 0)
          {
            content = 
            `<strong>${data.name}</strong>` +
            `<br><br><img src="assets/weather.png" alt="Description" style="width:14px; height:15px;"> Temperatur: ${this.weatherReportTemp}°C` +
            `<br><br> Anzahl Sensoren: ${countMarkersInside}`;
          }
          else {
            content = 
            `<strong>${data.name}</strong>` +
            `<br><br><img src="assets/sensor.png" alt="Description" style="width:14px; height:15px;"> ⌀ Temperatur: ${meanTemp.toFixed(2)}°C` +
            `<br><br> Anzahl Sensoren: ${countMarkersInside}`;
          }
          
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
          const marker = L.marker([clickLocation.lat, clickLocation.lng], {icon: this.createIcon('assets/temperature.png')}).addTo(this.map);
  
          marker.on('contextmenu', () => {
            this.map.removeLayer(marker);
          });
        });

        polygon.on('contextmenu', (e) => {
          const clickLocation = e.latlng;
      
          let tempValueString: string | null = prompt("Please enter the temperature value:", "");
      
          if (tempValueString !== null && tempValueString.trim() !== "" && !isNaN(Number(tempValueString))) {
              let tempValue: number = Number(tempValueString);
      
              const marker = L.marker([clickLocation.lat, clickLocation.lng], {icon: this.createIcon('assets/temperature.png')}).addTo(this.map);
      
              this.temperatureData.push({
                  lat: clickLocation.lat,
                  lng: clickLocation.lng,
                  temp: tempValue,
                  activated: true
              });
      
              marker.bindPopup(`Temperatur: ${tempValue}°C`).openTooltip();
      
              marker.on('click', () => {
                  marker.openTooltip();
              });
      
              marker.on('contextmenu', () => {
                  this.map.removeLayer(marker);
                  this.temperatureData = this.temperatureData.filter(md => md.lat !== clickLocation.lat || md.lng !== clickLocation.lng);
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
    return this.temperatureData.filter(markerData => {
      return this.isMarkerInsidePolygon(markerData, polygon) && markerData.activated;
    });
  }

  private countMarkersInsidePolygon(polygon: L.Polygon): number {
    return this.temperatureData.filter(markerData => {
      return this.isMarkerInsidePolygon(markerData, polygon) && markerData.activated;
    }).length;
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
    if (this.temperatureData.length === 0) {
        return 0;
    }
    return this.temperatureData.reduce((sum, marker) => sum + marker.temp, 0) / this.temperatureData.length;
  }

  private updateTemperatureLegend(averageTemp: number) {
    this.map.removeControl(this.temperatureLegend);
    this.addTemperatureLegend(averageTemp);
  }

  private addLegend() {
    const legend = new L.Control({ position: 'bottomright' });
  
    legend.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'info legend');
      div.innerHTML = '<h4>Anzahl der Sensoren</h4>';
      const sensorRanges = [0, 1, 2, 3, 4, 5];
      const colors = ['#ff0000', '#db1200', '#6d4900', '#495b00', '#246e00', '#008000'];
  
      for (let i = 0; i < sensorRanges.length; i++) {
        if (i < sensorRanges.length - 1) {
          div.innerHTML += '<i style="background:' + colors[i] + '"></i> ' + sensorRanges[i] + '<br>';
        } else {
          div.innerHTML += '<i style="background:' + colors[i] + '"></i> ' + sensorRanges[i] + '+';
        }
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
        <p>Der digitale Schatten ist die digitale Abbildung <br>
        der von virtuellen Sensoren erfassten Daten, <br>
        wie Temperaturwerte und Zeitstempel, die eine <br>
        genaue Überwachung und Analyse in der <br>
        physischen Welt ermöglicht.</p>`;
      return div;
    };
  
    descriptionLegend.addTo(this.map);
  }

  private createMarkers() {
    this.markers = [];
    this.temperatureData.forEach((data) => {
        const icon = this.createIcon('assets/stationary_sensor.png');

        const marker = L.marker([data.lat, data.lng], { icon: icon })
            .bindPopup(`Temperatur: ${data.temp}°C`);

        marker.on('contextmenu', () => {
            const markerData = this.temperatureData.find(md => md.lat === data.lat && md.lng === data.lng);
            if (markerData) {
                markerData.activated = !markerData.activated;

                const newIcon = this.createIcon(markerData.activated ? 'assets/stationary_sensor.png' : 'assets/stationary_sensor_disabled.png');
                marker.setIcon(newIcon);
            }
        });

        marker.addTo(this.map);
        this.markers.push(marker);
    });
  }

  private createIcon(path: string): L.Icon {
    const iconUrl = path;
  
    return L.icon({
      iconUrl: iconUrl,
      iconSize: [25, 28],
      iconAnchor: [5, 30],
      popupAnchor: [7, -30]
    });
  }

  private initializeWeatherReportLegend(temperature: number): void {
    this.addTemperatureWeatherReportLegend(temperature);
  }

  private fetchTemperatureData(): Observable<number> {
    const apiUrl = 'http://api.weatherstack.com/current?access_key=b46ba223dfe6adc962f8dc2c94ce7f2a&query=Wuppertal&units=m'; 
    return this.http.get<WeatherApiResponse>(apiUrl).pipe(
        map(data => {
          if (data && data.current && typeof data.current.temperature === 'number') {
            return Number(data.current.temperature.toFixed(2));
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
    return d >= 5  ? '#008000' :
           d >= 4  ? '#246e00' :
           d >= 3   ? '#495b00' :
           d >= 2   ? '#6d4900' :
           d >= 1   ? '#db1200' :
                      '#ff0000';
  }

  onResize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }
}