import * as L from 'leaflet';
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MarkerData } from '../interface/MarkerData';
import { switchMap } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
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
  
  private weatherReportTemp: number = 18; // Assuming a default temperature
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

        this.initializeTemperatureData();
        this.addLegend();
        this.addDigitalShadowLegend();

        // Initialize the Wetterbericht legend
        this.initializeWeatherReportLegend(this.weatherReportTemp);
      });
      
      // Update the average temperature legend periodically
      setInterval(() => {
        const averageTemp = this.calculateOverallAverageTemperature();
        this.updateTemperatureLegend(averageTemp);
      }, 5000);
    }
  }

  private initializeTemperatureData() {
    // Load the JSON file for polygons and map geometry
    this.http.get<any>('assets/modified_wuppertal_quartiere.json').subscribe(jsonData => {
      // Load sensor data from CSV
      this.fetchCsvData().subscribe(csvData => {
        this.temperatureData = [];

        jsonData.features.forEach((feature: any) => {
          const quartier = feature.properties.QUARTIER;

          // Find corresponding sensor data in CSV
          const sensorData = csvData.find(data => data.quartier == quartier);

          if (sensorData) {
            this.temperatureData.push({
              temp: sensorData.temp_with_noise,
              lat: sensorData.lat,
              lng: sensorData.lng,
              coordinates: feature.geometry.coordinates,
              name: feature.properties.NAME,
              activated: sensorData.activated
            });
          }
        });

        this.createMarkers();
        this.initializePolygonLayer();
      });
    });

    // Periodically update data from CSV
    setInterval(() => {
      this.fetchCsvData().subscribe(updatedData => {
        // Update temperatureData with new CSV data
        updatedData.forEach(sensorData => {
          const dataIndex = this.temperatureData.findIndex(
            td => td.lat == sensorData.lat && td.lng == sensorData.lng
          );

          if (dataIndex >= 0) {
            this.temperatureData[dataIndex].temp = sensorData.temp_with_noise;
            this.temperatureData[dataIndex].activated = sensorData.activated;
          }
        });

        this.updateMarkers(); // Update existing markers with new data
        const averageTemp = this.calculateOverallAverageTemperature();
        this.updateTemperatureLegend(averageTemp);
      });
    }, 5000); // Adjust interval as needed
  }

  private updateMarkers() {
    this.temperatureData.forEach((data, index) => {
      if (this.markers[index]) {
        const marker = this.markers[index];
        const popupContent = `Temperatur: ${data.temp}°C`;
        marker.setLatLng([data.lat, data.lng]);
        marker.getPopup()?.setContent(popupContent);

        // Update marker icon based on activation status
        const iconPath = data.activated ? 'assets/stationary_sensor.png' : 'assets/stationary_sensor_disabled.png';
        marker.setIcon(this.createIconStatic(iconPath));
      }
    });
  }  

  private fetchCsvData(): Observable<any[]> {
    const sensor1$ = this.http.get('assets/sensor_1.csv', { responseType: 'text' }).pipe(
      map(data => this.parseCsvData(data)),
      catchError(err => {
        console.error('Error reading sensor_1 CSV data:', err);
        return of([]);
      })
    );
  
    const sensor2$ = this.http.get('assets/sensor_2.csv', { responseType: 'text' }).pipe(
      map(data => this.parseCsvData(data)),
      catchError(err => {
        console.error('Error reading sensor_2 CSV data:', err);
        return of([]);
      })
    );
  
    // Combine both observables and merge the results
    return sensor1$.pipe(
      map(sensor1Data => {
        return sensor2$.pipe(
          map(sensor2Data => {
            // Concatenate the data from both CSV files
            return [...sensor1Data, ...sensor2Data];
          })
        );
      }),
      // Flatten the nested observables into a single observable stream
      switchMap(data => data)
    );
  }
  
  private parseCsvData(data: string): any[] {
    // Normalize line endings and parse CSV rows
    const rows = data.replace(/\r\n/g, '\n').split('\n').slice(1); // Skip header row
    return rows
      .filter(row => row.trim() !== '') // Remove empty rows
      .map(row => {
        const [quartier, lat, lng, temp, activated, temp_with_noise] = row.split(',').map(cell => cell.trim());
        return {
          quartier: quartier,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          temp: parseFloat(temp),
          activated: activated.toLowerCase() === 'true',
          temp_with_noise: parseFloat(temp_with_noise)
        };
      });
  }  

  private initializePolygonLayer(): void {
    this.temperatureData.forEach(data => {
      if (data.coordinates) {
        const polygon = L.polygon(data.coordinates, {
          fillColor: this.getColor(1), 
          fillOpacity: 0.4, 
          color: "white"
        }).addTo(this.map);

        // Bind an empty tooltip to the polygon
        polygon.bindTooltip('', { sticky: true, className: 'polygon-tooltip' });

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

        polygon.on('mouseover', (e) => {
          highlightPolygon();
          const markersInside = this.getMarkersInsidePolygon(polygon);
          const meanTemp = this.calculateMeanTemperature(markersInside);
          const countMarkersInside = this.countMarkersInsidePolygon(polygon);

          let content = '';
          if (countMarkersInside == 0) {
            content = 
              `<strong>${data.name}</strong>` +
              `<br><br><img src="assets/weather.png" alt="Description" style="width:14px; height:15px;"> Temperatur: ${this.weatherReportTemp}°C` +
              `<br><br> Anzahl Sensoren: ${countMarkersInside}`;
          } else {
            content = 
              `<strong>${data.name}</strong>` +
              `<br><br><img src="assets/sensor.png" alt="Description" style="width:14px; height:15px;"> ⌀ Temperatur: ${meanTemp.toFixed(2)}°C` +
              `<br><br> Anzahl Sensoren: ${countMarkersInside}`;
          }

          // Update the tooltip content and open it at the mouse position
          polygon.setTooltipContent(content);
          polygon.openTooltip(e.latlng);
        });

        polygon.on('mouseout', (e) => {
          resetStyle();
          polygon.closeTooltip();
        });

        polygon.on('click', (e) => {
          const bounds = polygon.getBounds();
          this.map.fitBounds(bounds);
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
    if (this.temperatureLegend) {
      this.map.removeControl(this.temperatureLegend);
    }
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
    this.temperatureLegend.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'info legend');
      div.innerHTML = `<h4>⌀ Temperatur</h4>${averageTemp.toFixed(2)} °C`;
      return div;
    };
    this.temperatureLegend.addTo(this.map);
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
      const iconPath = data.activated ? 'assets/stationary_sensor.png' : 'assets/stationary_sensor_disabled.png';
      const icon = this.createIconStatic(iconPath);

      const marker = L.marker([data.lat, data.lng], { icon: icon })
          .bindPopup(`Temperatur: ${data.temp}°C`);

      marker.on('contextmenu', () => {
        const markerData = this.temperatureData.find(md => md.lat === data.lat && md.lng === data.lng);
        if (markerData) {
          markerData.activated = !markerData.activated;

          const newIconPath = markerData.activated ? 'assets/stationary_sensor.png' : 'assets/stationary_sensor_disabled.png';
          const newIcon = this.createIconStatic(newIconPath);
          marker.setIcon(newIcon);
        }
      });

      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  private createIconStatic(path: string): L.Icon {
    return L.icon({
      iconUrl: path,
      iconSize: [25, 22],
      iconAnchor: [5, 30],
      popupAnchor: [7, -30]
    });
  }

  private initializeWeatherReportLegend(temperature: number): void {
    this.addTemperatureWeatherReportLegend(temperature);
  }

  private addTemperatureWeatherReportLegend(temperature: number) {
    if (this.temperatureWeatherReportLegend) {
      this.map.removeControl(this.temperatureWeatherReportLegend);
    }
    this.temperatureWeatherReportLegend = new L.Control({ position: 'topright' });

    this.temperatureWeatherReportLegend.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'info temperature-weather-legend');
      div.innerHTML = `<h4>Wetterbericht</h4>${temperature.toFixed(2)} °C`;
      return div;
    };

    this.temperatureWeatherReportLegend.addTo(this.map);
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
