export interface Profile {
  id: string;
  full_name: string | null;
  role: 'rider' | 'admin';
}

export interface LatestLocation {
  rider_id: string;
  lat: number;
  lng: number;
  speed: number | null; // metres per second
  heading: number | null;
  accuracy: number | null;
  recorded_at: string; // ISO timestamp
}

export interface TrackPoint {
  lat: number;
  lng: number;
  recorded_at: string;
}

export type RiderStatus = 'moving' | 'stopped' | 'offline' | 'no-data';
