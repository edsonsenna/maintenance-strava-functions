import { Equipment } from "./equipment.type";

export interface User {
  country: string;
  created_at: number;
  equipment: Equipment[];
  firstname: string;
  lastname: string;
  profile: string;
  updated_at: number;
  user_id: string; // same id on strava
}
