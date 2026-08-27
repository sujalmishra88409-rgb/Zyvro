// ZYVRO — Open-Meteo weather + air quality (no API key needed, cached per spec §13)

export interface WeatherData {
  temperature: number;
  apparent: number;
  humidity: number;
  precipitation: number;
  weatherCode: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  sunrise: string | null;
  sunset: string | null;
  at: number;
}

export interface AirData {
  aqi: number | null; // European AQI
  pm25: number | null;
  pm10: number | null;
  ozone: number | null;
  at: number;
}

const WX_TTL = 10 * 60 * 1000;
const wxCache = new Map<string, WeatherData>();
const wxInflight = new Map<string, Promise<WeatherData>>();
const airCache = new Map<string, AirData>();
const airInflight = new Map<string, AirData | Promise<AirData>>();

function gridKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`; // ~1 km grid
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const key = gridKey(lat, lng);
  const hit = wxCache.get(key);
  if (hit && Date.now() - hit.at < WX_TTL) return hit;

  const inflight = wxInflight.get(key);
  if (inflight) return inflight;

  const task = (async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m` +
      `&daily=sunrise,sunset&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const j = (await res.json()) as {
      current?: Record<string, number>;
      daily?: { sunrise?: string[]; sunset?: string[] };
    };
    const c = j.current ?? {};
    const data: WeatherData = {
      temperature: Number(c.temperature_2m ?? 0),
      apparent: Number(c.apparent_temperature ?? 0),
      humidity: Number(c.relative_humidity_2m ?? 0),
      precipitation: Number(c.precipitation ?? 0),
      weatherCode: Number(c.weather_code ?? 0),
      cloudCover: Number(c.cloud_cover ?? 0),
      windSpeed: Number(c.wind_speed_10m ?? 0),
      windDirection: Number(c.wind_direction_10m ?? 0),
      sunrise: j.daily?.sunrise?.[0] ?? null,
      sunset: j.daily?.sunset?.[0] ?? null,
      at: Date.now(),
    };
    wxCache.set(key, data);
    return data;
  })();

  wxInflight.set(key, task);
  try {
    return await task;
  } finally {
    wxInflight.delete(key);
  }
}

export async function fetchAir(lat: number, lng: number): Promise<AirData> {
  const key = gridKey(lat, lng);
  const hit = airCache.get(key);
  if (hit && Date.now() - hit.at < WX_TTL) return hit;

  const existing = airInflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const url =
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
        `&current=european_aqi,pm10,pm2_5,ozone&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`air ${res.status}`);
      const j = (await res.json()) as { current?: Record<string, number> };
      const c = j.current ?? {};
      const data: AirData = {
        aqi: c.european_aqi != null ? Number(c.european_aqi) : null,
        pm25: c.pm2_5 != null ? Number(c.pm2_5) : null,
        pm10: c.pm10 != null ? Number(c.pm10) : null,
        ozone: c.ozone != null ? Number(c.ozone) : null,
        at: Date.now(),
      };
      airCache.set(key, data);
      return data;
    } catch {
      const empty: AirData = { aqi: null, pm25: null, pm10: null, ozone: null, at: Date.now() };
      return empty;
    }
  })();

  airInflight.set(key, task);
  const data = await task;
  airInflight.delete(key);
  return data;
}

// ---------------------------------------------------------------------------
// WMO weather code → label
// ---------------------------------------------------------------------------

export function wmoLabel(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm + hail";
  return "—";
}

export function aqiInfo(aqi: number | null): { label: string; color: string } {
  if (aqi === null) return { label: "AQI —", color: "#5A615C" };
  if (aqi <= 20) return { label: "Good", color: "#3ECF8E" };
  if (aqi <= 40) return { label: "Fair", color: "#93C464" };
  if (aqi <= 60) return { label: "Moderate", color: "#E2C159" };
  if (aqi <= 80) return { label: "Poor", color: "#E28B59" };
  if (aqi <= 100) return { label: "Very poor", color: "#E25959" };
  return { label: "Extremely poor", color: "#C74D4D" };
}
