import { Equipment } from "./equipment.type";

export interface ReceivedActivity {
  aspect_type: string;
  event_time: number;
  object_id: number;
  object_type: string;
  owner_id: number;
  subscription_id: number;
}

export interface ProcessedActivity {
  athlete_id: string;
  moving_time: number;
  equipment: Equipment;
}
