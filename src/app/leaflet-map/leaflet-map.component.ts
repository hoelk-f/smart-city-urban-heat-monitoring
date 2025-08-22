import * as L from 'leaflet';
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MarkerData } from '../interface/MarkerData';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { SensorDataService } from '../sensor-data.service';

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
  
  private weatherReportTemp: number = 18;
  private temperatureData: any[] = [];

  constructor(private http: HttpClient, private sensorDataService: SensorDataService) {}

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
        this.addAvgTemperatureLegend();
        this.addLogoLegend();

        this.map.on('contextmenu', (e: L.LeafletMouseEvent) => {
          e.originalEvent.preventDefault();
          this.addSensorAtLocation(e.latlng);
        });

        this.fetchWeatherReportTemperature();
      });
      
      setInterval(() => {
        const averageTemp = this.calculateOverallAverageTemperature();
        this.updateTemperatureLegend(averageTemp);
      }, 5000);
    }
  }

  private addSensorAtLocation(latlng: L.LatLng): void {
    let tempValueString: string | null = prompt("Please enter the temperature value:", "");

    if (tempValueString !== null && tempValueString.trim() !== "" && !isNaN(Number(tempValueString))) {
      const tempValue: number = Number(tempValueString);
      const marker = L.marker(latlng, {icon: this.createIconStatic('assets/temperature.png')}).addTo(this.map);
      
      this.temperatureData.push({
        lat: latlng.lat,
        lng: latlng.lng,
        temp: tempValue,
        activated: true
      });

      marker.bindPopup(`Temperature: ${tempValue}°C`).openTooltip();

      marker.on('contextmenu', () => {
        this.map.removeLayer(marker);
        this.temperatureData = this.temperatureData.filter(md => md.lat !== latlng.lat || md.lng !== latlng.lng);
      });
    } else {
      alert("Please enter a valid temperature value.");
    }
  }

  private fetchWeatherReportTemperature(): void {
    this.http.get('assets/weatherreportapi.csv', { responseType: 'text' }).subscribe(
      (data) => {
        const rows = data.split('\n');
        if (rows.length > 1) {
          const [timestamp, temperature] = rows[1].split(',');
          this.weatherReportTemp = parseFloat(temperature);
        } else {
          console.error('No data found in weatherreportapi.csv');
        }
        this.updateWeatherReportLegend();
      },
      (error) => {
        console.error('Error loading weather report CSV:', error);
      }
    );
  }

  private updateWeatherReportLegend(): void {
    if (this.temperatureWeatherReportLegend) {
      this.map.removeControl(this.temperatureWeatherReportLegend);
    }
    this.addTemperatureWeatherReportLegend(this.weatherReportTemp);
  }

  private addTemperatureWeatherReportLegend(temperature: number) {
    this.temperatureWeatherReportLegend = new L.Control({ position: 'topright' });

    this.temperatureWeatherReportLegend.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'info legend');
      div.innerHTML = `<h6>Weather Report</h6>${temperature.toFixed(2)} °C`;
      return div;
    };

    this.temperatureWeatherReportLegend.addTo(this.map);
  }

  private initializeTemperatureData() {
    this.http.get<any>('https://testpod1.solidcommunity.net/public/hma-wuppertal-quartiere.json')
      .subscribe({
        next: async (geoJson) => {
          try {
            const solidSensorData = await this.sensorDataService.loadAllSensors();
            this.temperatureData = [];

            geoJson.features.forEach((feature: any) => {
              const quartier = parseInt(feature.properties.QUARTIER, 10);
              const sensorData = solidSensorData.find(s =>
                parseInt(s.district?.toString() ?? '', 10) === quartier
              );

              if (sensorData) {
                this.temperatureData.push({
                  temp: sensorData.temp,
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
          } catch (err) {
            console.error('Error loading Solid Pod sensor data:', err);
          }
        },
        error: (jsonError) => {
          console.error('Error loading GeoJSON from Solid Pod:', jsonError);
        }
      });

    setInterval(async () => {
      try {
        const updatedData = await this.sensorDataService.loadAllSensors();

        updatedData.forEach(sensor => {
          const dataIndex = this.temperatureData.findIndex(
            td => td.lat === sensor.lat && td.lng === sensor.lng
          );

          if (dataIndex >= 0) {
            this.temperatureData[dataIndex].temp = sensor.temp;
            this.temperatureData[dataIndex].activated = sensor.activated;
          }
        });

        this.updateMarkers();
        const averageTemp = this.calculateOverallAverageTemperature();
        this.updateTemperatureLegend(averageTemp);
      } catch (err) {
        console.error('Failed to update sensor data:', err);
      }
    }, 5000);
  }

  private updateMarkers() {
    this.temperatureData.forEach((data, index) => {
      if (this.markers[index]) {
        const marker = this.markers[index];
        const popupContent = `Temperature: ${data.temp}°C`;
        marker.setLatLng([data.lat, data.lng]);
        marker.getPopup()?.setContent(popupContent);

        const iconPath = data.activated ? 'assets/stationary_sensor.png' : 'assets/stationary_sensor_disabled.png';
        marker.setIcon(this.createIconStatic(iconPath));
      }
    });
  }  

  private initializePolygonLayer(): void {
    this.temperatureData.forEach(data => {
      if (data.coordinates) {
        
        const polygon = L.polygon(data.coordinates, {
          fillColor: this.getColorByAvgTemp(0),
          fillOpacity: 0.4,
          color: this.getColor(1),
          weight: 2
        }).addTo(this.map);
  
        const updatePolygonStyle = () => {
          const markersInside = this.getMarkersInsidePolygon(polygon);
          const meanTemp = this.calculateMeanTemperature(markersInside);
          const tempDiff = Math.abs(meanTemp - this.weatherReportTemp);
          polygon.setStyle({
            fillColor: this.getColorByAvgTemp(meanTemp),
            color: this.getColor(tempDiff),
            fillOpacity: 0.4
          });
        };
  
        const highlightPolygon = () => {
          polygon.setStyle({
            fillOpacity: 0.7
          });
        };
  
        const resetPolygonStyle = () => {
          polygon.setStyle({
            fillOpacity: 0.4
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
          const countMarkersInside = this.countMarkersInsidePolygon(polygon);
  
          let content = '';
          if (countMarkersInside === 0) {
            content = 
              `<strong>${data.name}</strong>` +
              `<br><br><img src="assets/weather.png" alt="Description" style="width:14px; height:15px;"> Temperature: ${this.weatherReportTemp}°C` +
              `<br><br> Count Sensors: ${countMarkersInside}`;
          } else {
            content = 
              `<strong>${data.name}</strong>` +
              `<br><br><img src="assets/sensor.png" alt="Description" style="width:14px; height:15px;"> ⌀ Temperature: ${meanTemp.toFixed(2)}°C` +
              `<br><br> Count Sensors: ${countMarkersInside}`;
          }
  
          updateLegend(content);
        });
  
        polygon.on('mouseout', (e) => {
          resetPolygonStyle();
          updateLegend('');
          const legendDiv = document.getElementById('info-legend');
          if (legendDiv) {
            legendDiv.style.display = 'none';
          }
        });
  
        polygon.on('click', (e) => {
          const bounds = polygon.getBounds();
          this.map.fitBounds(bounds);
        });
  
        data.polygonLayer = polygon;
  
        updatePolygonStyle();
      }
    });
  
    setInterval(() => {
      this.temperatureData.forEach(data => {
        if (data.polygonLayer) {
          const markersInside = this.getMarkersInsidePolygon(data.polygonLayer);
          const meanTemp = this.calculateMeanTemperature(markersInside);
          const tempDiff = Math.abs(meanTemp - this.weatherReportTemp);
          data.polygonLayer.setStyle({
            fillColor: this.getColorByAvgTemp(meanTemp),
            color: this.getColor(tempDiff)
          });
        }
      });
    }, 5000);
  }

  private getColorByAvgTemp(avgTemp: number): string {
    return avgTemp < 0    ? '#00008B' :   // Dark blue for < 0°C
           avgTemp < 11   ? '#1E90FF' :   // Light blue for 0-10°C
           avgTemp < 20   ? '#00CED1' :   // Turquoise blue for 10-20°C
           avgTemp < 30   ? '#ADFF2F' :   // Yellow-green for 20-30°C
           avgTemp < 40   ? '#FFA500' :   // Orange for 30-40°C
                            '#8B0000';    // Dark red for > 40°C
  }

  private addAvgTemperatureLegend() {
    const legend = new L.Control({ position: 'bottomright' });
  
    legend.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'info legend');
      div.innerHTML = `
        <h6>Temperature (Area)</h6>
        <i style="background:#00008B"></i> < 0°C<br>
        <i style="background:#1E90FF"></i> 0-11°C<br>
        <i style="background:#00CED1"></i> 11-20°C<br>
        <i style="background:#ADFF2F"></i> 20-30°C<br>
        <i style="background:#FFA500"></i> 30-40°C<br>
        <i style="background:#8B0000"></i> > 40°C
      `;
      return div;
    };
  
    legend.addTo(this.map);
  }

  private calculateTemperatureDifference(data: any): number {
    return Math.abs(data.temp - this.weatherReportTemp);
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
      div.innerHTML = '<h6>Temperature Deviation (Border)</h6>';
      const tempDiffs = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
      const colors = ['#008000', '#246e00', '#495b00', '#6d4900', '#db1200', '#ff0000'];
  
      for (let i = 0; i < tempDiffs.length; i++) {
        if (i < tempDiffs.length - 1) {
          div.innerHTML += `<i style="background:${colors[i]}"></i> ${tempDiffs[i]}°C<br>`;
        } else {
          div.innerHTML += `<i style="background:${colors[i]}"></i> >${tempDiffs[i]}°C<br>`;
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
      div.innerHTML = `<h6>⌀ Temperature</h6>${averageTemp.toFixed(2)} °C`;
      return div;
    };
    this.temperatureLegend.addTo(this.map);
  }

  private addDigitalShadowLegend() {
    const descriptionLegend = new L.Control({ position: 'bottomleft' });

    descriptionLegend.onAdd = (map) => {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <h6>Integrated GeoJSON file from Solid Pod</h6>
            <div style="padding-left: 20px;">
                <div>
                    <span style="display: inline-block; width: 10px; height: 10px; background-color: green; border-radius: 50%; margin-right: 5px;"></span>
                    hma-wuppertal-quartiere.json
                </div>
            </div>
            <h6 style="margin-top: 10px;">Integrated Data Sources from Solid Pods</h6>
            <div style="padding-left: 20px;">
                <div>
                    <span style="display: inline-block; width: 10px; height: 10px; background-color: green; border-radius: 50%; margin-right: 5px;"></span>
                    hma-temp-1.csv
                </div>
                <div style="margin-top: 5px;">
                    <span style="display: inline-block; width: 10px; height: 10px; background-color: green; border-radius: 50%; margin-right: 5px;"></span>
                    hma-temp-2.json
                </div>
                <div style="margin-top: 5px;">
                    <span style="display: inline-block; width: 10px; height: 10px; background-color: green; border-radius: 50%; margin-right: 5px;"></span>
                    hma-temp-3.csv
                </div>
            </div>
        `;
        return div;
    };

    descriptionLegend.addTo(this.map);

    setTimeout(() => {
        const sensor3Switch = document.getElementById('flexSwitchCheckSensor3') as HTMLInputElement;
        if (sensor3Switch) {
            sensor3Switch.addEventListener('change', (event) => {
                if (sensor3Switch.checked) {
                    this.addSensor3Marker();
                } else {
                    this.removeSensor3Marker();
                }
            });
        }
    }, 0);
  }

  private sensor3Marker: L.Marker | null = null;

  private addSensor3Marker(): void {
      if (!this.sensor3Marker) {
          this.sensor3Marker = L.marker([51.30034498589104, 7.144262435658878], { 
              icon: this.createIconStatic('assets/temperature.png') 
          }).addTo(this.map);
          this.sensor3Marker.bindPopup(`Temperature: 8°C`).openTooltip();
      }
  }

  private removeSensor3Marker(): void {
      if (this.sensor3Marker) {
          this.map.removeLayer(this.sensor3Marker);
          this.sensor3Marker = null;
      }
  }

  private addLogoLegend() {
    const logoLegend = new L.Control({ position: 'topright' });

    logoLegend.onAdd = (map) => {
        const div = L.DomUtil.create('div', 'info logo-legend');
        div.innerHTML = `
            <img src="assets/images/Icon_GesundesTal.png" alt="Smart City Urban Heat Monitoring Logo" style="width:50px; height:auto; margin-bottom:8px; margin-right:10px;">
            <img src="assets/images/KFW.svg" alt="KFW Logo" style="width:50px; height:auto; margin-right:10px;">
            <img src="assets/images/BMWSB.png" alt="BMWSB Logo" style="width:150px; height:auto; margin-bottom:8px; ">
        `;
        return div;
    };

    logoLegend.addTo(this.map);
}

  private createMarkers() {
    this.markers = [];
    this.temperatureData.forEach((data) => {
      const iconPath = data.activated ? 'assets/stationary_sensor.png' : 'assets/stationary_sensor_disabled.png';
      const icon = this.createIconStatic(iconPath);

      const marker = L.marker([data.lat, data.lng], { icon: icon })
          .bindPopup(`Temperature: ${data.temp}°C`);

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
      iconSize: [25, 26],
      iconAnchor: [5, 30],
      popupAnchor: [7, -30]
    });
  }

  public getColor(difference: number): string {
    return difference > 1.2 ? '#ff0000' :
           difference > 1.0 ? '#db1200' :
           difference > 0.8 ? '#6d4900' :
           difference > 0.6 ? '#495b00' :
           difference > 0.4 ? '#246e00' :
           '#008000';
  }

  onResize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }
}
