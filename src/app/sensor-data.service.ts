import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as Papa from 'papaparse';

@Injectable({ providedIn: 'root' })
export class SensorDataService {
  constructor(private http: HttpClient) {}

  async loadAllSensors(): Promise<any[]> {
    const [csv1, json2, csv3] = await Promise.all([
      this.loadCSV('https://testpod1.solidcommunity.net/public/hma-temp-1.csv'),
      this.http.get<any[]>('https://testpodfu.solidcommunity.net/public/hma-temp-2.json').toPromise(),
      this.loadCSV('https://testpodfh.solidcommunity.net/public/hma-temp-3.csv'),
    ]);

    const normalized1 = csv1.map((r: any) => ({
      city: r.city,
      district: r.QUARTIER,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lng),
      temp: parseFloat(r.temp),
      activated: r.activated,
    }));

    const normalized2 = (json2 ?? []).map((r: any) => ({
      city: r.location,
      district: r.district,
      lat: parseFloat(r.latitude),
      lng: parseFloat(r.longitude),
      temp: parseFloat(r.t),
      activated: r.activated,
    }));

    const normalized3 = csv3.map((r: any) => ({
      city: r.c,
      district: r.q,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lng),
      temp: parseFloat(r.t),
      activated: r.activation,
    }));

    return [...normalized1, ...normalized2, ...normalized3];
  }

  private async loadCSV(url: string): Promise<any[]> {
    const res = await fetch(url);
    const text = await res.text();
    return new Promise((resolve) => {
      Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        complete: (results: Papa.ParseResult<any>) => resolve(results.data),
      });
    });
  }
}
