import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as axios from "axios";
import * as dotenv from "dotenv";
import { PubSub } from "@google-cloud/pubsub";
import { Maintenance } from "./maintenance";

dotenv.config();
admin.initializeApp();

const pubSubClient = new PubSub();
const usersCollection = `${process.env.USERS_COLLECTION}`;
const maintenanceCollection = `${process.env.MAINTENANCES_COLLECTION}`;
const logCollection = `${process.env.LOGS_COLLECTION}`;
const stravaClientId = `${process.env.CLIENT_ID}`;
const stravaClientSecret = `${process.env.CLIENT_SECRET}`;
const verifyStravaToken = `${process.env.VERIFY_STRAVA_TOKEN}`;
const activitiesTopic = `${
  process.env.ACTIVITIES_TOPIC || "activities-changes"
}`;

function publishMessage(message: String) {
  const dataBuffer = Buffer.from(message);
  pubSubClient
    .topic(activitiesTopic)
    .publish(dataBuffer)
    .catch((error) => console.log(error));
}

export const webhook = functions.https.onRequest(async (req, res) => {
  if (req.method === "POST") {
    const stravaActivity = req.body;
    if (stravaActivity.aspect_type === "create") {
      publishMessage(JSON.stringify({ ...req.body }));
    }
    res.status(200).send("EVENT_RECEIVED");
  }

  const VERIFY_TOKEN = verifyStravaToken;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.json({ "hub.challenge": challenge });
    } else {
      res.sendStatus(403);
    }
  }
});

export const activityTopic = functions.pubsub
  .topic(activitiesTopic)
  .onPublish(async (message, context) => {
    const stravaActivity = message.data
      ? JSON.parse(Buffer.from(message.data, "base64").toString())
      : null;

    if (stravaActivity && stravaActivity.aspect_type === "create") {
      const userId = stravaActivity.owner_id;
      const activityId = stravaActivity.object_id;

      const user: any = await admin
        .firestore()
        .collection(usersCollection)
        .doc(`${userId}`)
        .get()
        .then((doc) => (doc.exists ? doc.data() : null))
        .catch((err) => {
          return null;
        });

      if (user) {
        let authToken = user["ms-token"];
        const refToken = user["ms-ref-token"];

        let distance = 0;
        let movingTime = 0;
        let equipmentId = null;
        let equipmentName: string = "";
        let hasInvalidToken = false;

        try {
          if (authToken) {
            const config = {
              headers: { Authorization: `Bearer ${authToken}` },
            };

            await axios.default
              .get(
                `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`,
                config
              )
              .then(async (response) => {
                distance = response.data.distance;
                equipmentId = response.data.gear_id;
              });
          } else {
            hasInvalidToken = true;
          }
        } catch (e) {
          hasInvalidToken = true;
          authToken = null;
        }

        if (hasInvalidToken && refToken) {
          try {
            const clientId = `client_id=${stravaClientId}`;
            const clientSecret = `client_secret=${stravaClientSecret}`;
            const grantType = "grant_type=refresh_token";
            const refreshToken = `refresh_token=${refToken}`;

            await axios.default
              .post(
                `https://www.strava.com/api/v3/oauth/token?${clientId}&${clientSecret}&${grantType}&${refreshToken}`
              )
              .then(async (refresh) => {
                const data = refresh.data;
                await admin
                  .firestore()
                  .collection(usersCollection)
                  .doc(`${userId}`)
                  .update({
                    "ms-token": data.access_token,
                    "ms-ref-token": data.refresh_token,
                    "ms-exp-date": data.expires_at,
                  });
                authToken = data.access_token;
              })
              .catch(async (error) => {
                await admin
                  .firestore()
                  .collection(usersCollection)
                  .doc(`${userId}`)
                  .collection(logCollection)
                  .add({
                    error,
                  });
              });
          } catch (error) {
            await admin
              .firestore()
              .collection(usersCollection)
              .doc(`${userId}`)
              .collection(logCollection)
              .add({
                error,
              });
          }
        }

        if (authToken) {
          try {
            const config = {
              headers: { Authorization: `Bearer ${authToken}` },
            };

            await axios.default
              .get(
                `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`,
                config
              )
              .then(async (response) => {
                movingTime = response.data.moving_time || null;
                distance = response.data.distance || null;
                equipmentId = response.data.gear_id || null;
                equipmentName = response.data.gear.name || null;
              })
              .catch(async (error) => {
                await admin
                  .firestore()
                  .collection(usersCollection)
                  .doc(`${userId}`)
                  .collection(logCollection)
                  .add({
                    error,
                  });
              });

            const collection = admin
              .firestore()
              .collection(usersCollection)
              .doc(`${userId}`)
              .collection(maintenanceCollection);

            await collection
              .where("equipmentId", "==", `${equipmentId}`)
              .get()
              .then(async (response) => {
                const batch = admin.firestore().batch();
                for (const doc of response.docs) {
                  const docRef = admin
                    .firestore()
                    .collection(usersCollection)
                    .doc(`${userId}`)
                    .collection(maintenanceCollection)
                    .doc(doc.id);
                  let maintenanceData: Maintenance | any =  null;
                  await docRef
                    .get()
                    .then((maintenanceDoc) => {
                      if (maintenanceDoc.exists) {
                        const maintenance: Maintenance =
                          JSON.parse(JSON.stringify(maintenanceDoc.data())) ||
                          null;
                        if (maintenance) {
                          if (!equipmentName.length) {
                            equipmentName = maintenance.equipmentName;
                          }
                          if (maintenance.type === "distance") {
                            maintenance.value += distance;
                            maintenance.isValid =
                              maintenance.value < maintenance.goal;
                          } else if (maintenance.type === "date") {
                            maintenance.isValid =
                              Date.now() < new Date(maintenance.goal).getTime();
                          } else if (maintenance.type === "hours") {
                            maintenance.value += movingTime;
                            maintenance.isValid =
                              maintenance.value < maintenance.goal;
                          }
                          maintenanceData = maintenance;
                        }
                      }
                    })
                    .catch(
                      async (error) =>
                        await admin
                          .firestore()
                          .collection(usersCollection)
                          .doc(`${userId}`)
                          .collection(logCollection)
                          .add({
                            error,
                          })
                    );
                  if (maintenanceData) {
                    batch.update(docRef, {
                      value: maintenanceData.value,
                      equipmentName: maintenanceData.equipmentName,
                      isValid: maintenanceData.isValid,
                    });
                  }
                }
                batch.commit().catch(
                  async (error) =>
                    await admin
                      .firestore()
                      .collection(usersCollection)
                      .doc(`${userId}`)
                      .collection(logCollection)
                      .add({
                        error,
                      })
                );
              })
              .catch(
                async (error) =>
                  await admin
                    .firestore()
                    .collection(usersCollection)
                    .doc(`${userId}`)
                    .collection(logCollection)
                    .add({
                      error,
                    })
              );
          } catch (error) {
            await admin
              .firestore()
              .collection(usersCollection)
              .doc(`${userId}`)
              .collection(logCollection)
              .add({
                error,
              });
          }
        }
      }
    }
  });
