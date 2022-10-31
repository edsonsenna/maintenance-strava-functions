import { Equipment } from "./equipment.type";

export interface User {
  access_token: string;
  country: string;
  created_at: number;
  email: string;
  equipment: Equipment[];
  expires_at: number;
  firstname: string;
  lastname: string;
  profile: string;
  refresh_token: string;
  updated_at: number;
  user_id: number; // same id on strava
}
