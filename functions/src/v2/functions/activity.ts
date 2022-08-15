import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as axios from "axios";

import { ProcessedActivity, ReceivedActivity } from "../types/activity.type";
import { User } from "../types/user.type";
import isTokenValid from "../utils/validateToken";
import publishMessage from "../utils/publishMessage";

const V2COLLECTION = "maintenance-v2";
const V2RECEIVED_ACTIVITY_TOPIC = "v2-receive-activity";
const V2PROCESSED_ACTIVITY_TOPIC = "v2-processed-activity";

const stravaClientId = `${process.env.CLIENT_ID}`;
const stravaClientSecret = `${process.env.CLIENT_SECRET}`;

const receivedActivity = () =>
  functions.pubsub
    .topic(V2RECEIVED_ACTIVITY_TOPIC)
    .onPublish(async (message) => {
      const activityHookInfo = message.data
        ? (JSON.parse(
            Buffer.from(message.data, "base64").toString()
          ) as ReceivedActivity)
        : null;

      functions.logger.info(
        `V2ReceivedActivity`,
        JSON.stringify(activityHookInfo)
      );

      const hasNotAValidActivityInfo =
        activityHookInfo === null ||
        !activityHookInfo.owner_id ||
        !activityHookInfo.object_id;
      const isNotAnActivityCreation =
        activityHookInfo?.aspect_type !== "create";

      if (hasNotAValidActivityInfo || isNotAnActivityCreation) {
        functions.logger.error(
          "V2ReceivedInvalidActivity",
          JSON.stringify(activityHookInfo)
        );

        return;
      }

      const userId = String(activityHookInfo?.owner_id);
      const activityId = activityHookInfo?.object_id;

      const user: User = await admin
        .firestore()
        .collection(V2COLLECTION)
        .doc(userId)
        .get()
        .then((doc) => (doc.data() as User) ?? null);

      functions.logger.info(
        `V2ReceivedActivityUserToken`,
        JSON.stringify(user)
      );

      const hasAnInvalidUser =
        !user?.user_id ||
        user.access_token?.length <= 0 ||
        !isTokenValid(user?.expires_at);

      if (hasAnInvalidUser) {
        functions.logger.info(
          `V2ReceivedActivityInvalidUserOrToken`,
          JSON.stringify(user)
        );

        return;
      }

      const hasAnInvalidToken = !isTokenValid(user?.expires_at);
      const hasAValidRefreshToken = user?.refresh_token?.length > 0;

      if (hasAnInvalidToken && !hasAValidRefreshToken) {
        functions.logger.error(
          `V2ReceivedActivityInvalidTokenAndRef`,
          `{ user: ${user.email}, expiresAt: ${user.expires_at}}`
        );

        return;
      }

      if (hasAnInvalidToken && hasAValidRefreshToken) {
        user.access_token = "";

        try {
          const clientId = `client_id=${stravaClientId}`;
          const clientSecret = `client_secret=${stravaClientSecret}`;
          const grantType = "grant_type=refresh_token";
          const refreshToken = `refresh_token=${user.refresh_token}`;

          await axios.default
            .post(
              `https://www.strava.com/api/v3/oauth/token?${clientId}&${clientSecret}&${grantType}&${refreshToken}`
            )
            .then(async (refresh) => {
              const data = refresh.data;
              const updatedUser: User = {
                ...user,
                access_token: data.access_token ?? "",
                refresh_token: data.refresh_token ?? "",
                expires_at: data.expires_at ?? "",
              };
              functions.logger.log(
                "V2ReceivedActivityUpdatedToken",
                JSON.stringify(updatedUser)
              );
              await admin
                .firestore()
                .collection(V2COLLECTION)
                .doc(`${userId}`)
                .update({ ...updatedUser });
              user.access_token = updatedUser.access_token;
            });
        } catch (error) {
          functions.logger.error(
            `V2ReceivedActivityUpdateTokenError`,
            JSON.stringify(error)
          );

          return;
        }
      }

      try {
        const config = {
          headers: { Authorization: `Bearer ${user.access_token}` },
        };

        await axios.default
          .get(
            `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`,
            config
          )
          .then(async (response) => {
            const processedActivityPayload: ProcessedActivity = {
              athlete_id: response.data.athlete.id,
              moving_time: response.data.moving_time,
              equipment: {
                distance: response.data.gear.distance,
                equipment_id: response.data.gear.id,
                resource_state: response.data.gear.resource_state,
              },
            };
            publishMessage(
              JSON.stringify(processedActivityPayload),
              V2PROCESSED_ACTIVITY_TOPIC
            );
          })
          .catch(async (error) => {
            functions.logger.error(
              `ErrorFetchAtivityInfo-${activityId}`,
              error
            );
          });
      } catch (error) {
        functions.logger.error(`ErrorFetchAtivityInfo-${activityId}`, error);
      }
    });

const processedActivity = () =>
  functions.pubsub
    .topic(V2PROCESSED_ACTIVITY_TOPIC)
    .onPublish(async (message) => {
      const processedActivityInfo = message.data
        ? (JSON.parse(
            Buffer.from(message.data, "base64").toString()
          ) as ReceivedActivity)
        : null;

      functions.logger.info(
        `V2ProcessedActivity`,
        JSON.stringify(processedActivityInfo)
      );
    });

export { receivedActivity, processedActivity };
