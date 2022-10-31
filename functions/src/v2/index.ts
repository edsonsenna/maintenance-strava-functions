import { processedActivity, receivedActivity } from "./functions/activity";
import { fetchUserEquipments } from "./functions/equipment";

export default {
  ProcessedActivityFunction: processedActivity,
  ReceivedActivityFunction: receivedActivity,
  FetchUserEquipments: fetchUserEquipments,
};
