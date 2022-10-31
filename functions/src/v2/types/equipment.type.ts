import { EquipmentType } from "../enum/equipment.enum";
import { Maintenance } from "./maintenance.type";

export interface Equipment {
  distance?: number;
  equipment_id?: string; // same id on strava,
  maintenances?: Maintenance[];
  name?: string;
  primary?: boolean;
  resource_state?: number;
  type?: EquipmentType;
}
