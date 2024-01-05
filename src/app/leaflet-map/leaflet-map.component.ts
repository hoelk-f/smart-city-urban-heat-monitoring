import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import wuppertalQuartierejsonData from '../../assets/wuppertal_quartiere.json';
import { GeoJsonObject } from 'geojson';
import { LeafletMouseEvent } from 'leaflet';
import { WeatherApiResponse } from '../interface/WeatherApiResponse'; 
import * as L from 'leaflet';

@Component({
  selector: 'app-leaflet-map',
  templateUrl: './leaflet-map.component.html',
  styleUrls: ['./leaflet-map.component.css'],
  standalone: true
})
export class LeafletMapComponent implements OnInit {
  private settingTemp: number = 5;
  private settingRange: number = 12;
  private settingInterval: number = 5000;
  private map!: L.Map;
  private temperatureLegend!: L.Control;
  private temperatureWeatherReportLegend!: L.Control;
  private markers: L.Marker[] = [];
  private temperatureData: any[] = [];
  private defaultStyle = {
    color: "#3388ff",
    weight: 3,
    opacity: 1,
    fillOpacity: 0.2,
    fillColor: "#3388ff"
  };

  constructor(private http: HttpClient) {
    this.highlightFeature = this.highlightFeature.bind(this);
    this.resetHighlight = this.resetHighlight.bind(this);
    this.zoomToFeature = this.zoomToFeature.bind(this);
   }
  
  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      import('leaflet').then(L => {
        this.map = L.map('map').setView([51.2562, 7.1508], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        L.geoJSON(wuppertalQuartierejsonData as GeoJsonObject, {
          onEachFeature: (feature, layer) => {
            layer.on({
              mouseover: this.highlightFeature,
              mouseout: this.resetHighlight,
              click: this.zoomToFeature
            });
          }
        }).addTo(this.map);
        this.loadTemperatureData();
        this.fetchTemperatureData();
        this.addLegend();
        this.addDigitalShadowLegend();
        this.createMarkers();
        const averageTemp = this.temperatureData.reduce((sum, data) => sum + data.temp, 0) / this.temperatureData.length;
        this.addTemperatureLegend(averageTemp);
      });
      
      setInterval(() => {
        this.updateTemperatureData();
        const averageTemp = this.calculateAverageTemperature();
        this.updateTemperatureLegend(averageTemp);
        this.updateMarkers();
      }, this.settingInterval);
    }
  }

  private highlightFeature(e: LeafletMouseEvent) {
    var layer = e.target as L.Path;
  
    layer.setStyle({
      weight: 5,
      color: '#3388ff',
      dashArray: '',
      fillOpacity: 0.7
    });
  
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
      layer.bringToFront();
    }
  }
  
  private resetHighlight(e: LeafletMouseEvent) {
    var layer = e.target as L.Path;
    layer.setStyle(this.defaultStyle);
  }
  
  private zoomToFeature(e: LeafletMouseEvent) {
    this.map.fitBounds(e.target.getBounds());
  }

  private loadTemperatureData() {
    this.http.get<any>('assets/wuppertal_quartiere.json').subscribe(data => {
        this.temperatureData = data.features.map((feature: any) => {
            return {
                temp: feature.properties.temp,
                lat: feature.properties.lat,
                lng: feature.properties.lng 
            };
        });
        this.createMarkers();
    });
}

  private updateTemperatureData() {
    this.temperatureData.forEach(data => {
      data.temp = this.settingTemp + Math.random() * this.settingRange;

      const color = this.getColor(data.temp);

      this.map 
    });
  }

  private calculateAverageTemperature() {
    return this.temperatureData.reduce((sum, data) => sum + data.temp, 0) / this.temperatureData.length;
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
      div.innerHTML = `<h4>⌀ Temperatur</h4>${averageTemp.toFixed(1)} °C`;
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
      div.innerHTML = `<h4>Wetterbericht</h4>${temperature.toFixed(1)} °C`;
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
    this.temperatureData.forEach((data, index) => {
      const icon = this.createSvgIcon();
  
      const marker = L.marker([data.lat, data.lng], { icon: icon }).bindPopup(`Temperatur: ${data.temp}°C`);
      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  private updateMarkers() {
    this.markers.forEach((marker, index) => {
      const temp = this.temperatureData[index].temp;
      marker.setPopupContent(`Temperatur: ${temp.toFixed(1)}°C`);
    });
  }

  private getColor(d: number) {
    return d > 35 ? '#f46d43' :
           d > 30  ? '#fdae61' :
           d > 25  ? '#fee090' :
           d > 20  ? '#e0f3f8' :
           d > 15   ? '#abd9e9' :
           d > 10   ? '#74add1' :
           d > 5   ? '#4575b4' :
                      '#313695';
  }

  private createSvgIcon(): L.Icon {
    const iconUrl = 'assets/temperature.svg';
  
    return L.icon({
      iconUrl: iconUrl,
      iconSize: [20, 40],
      iconAnchor: [0, 30],
      popupAnchor: [10, -25]
    });
  }

  private fetchTemperatureData() {
    const apiUrl = 'http://api.weatherstack.com/current?access_key=37e2da2c2917f40932030c5cbab0d188&query=Wuppertal&units=m'; 
    this.http.get<WeatherApiResponse>(apiUrl).subscribe(data => {
      this.addTemperatureWeatherReportLegend(data.current.temperature); 
    });
  }

  onResize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }
}