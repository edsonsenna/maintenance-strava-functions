import { MaintenaceType, MaintenanceGoal } from "../enum/maintenance.enum";

export interface Maintenance {
  goal_type: MaintenanceGoal;
  goal: number;
  is_resolved: boolean;
  is_valid: boolean;
  maintenance_id: string;
  name: string;
  type: MaintenaceType;
  value: number;
}
