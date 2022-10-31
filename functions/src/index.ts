import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as axios from "axios";
import * as dotenv from "dotenv";
import * as nodemailer from "nodemailer";

// import { PubSub } from "@google-cloud/pubsub";

import { Maintenance } from "./interfaces/maintenance";
import { ActivityInfo } from "./interfaces/activityInfo";
import { User } from "./interfaces/user";

import * as v2Functions from "./v2/index";
import publishMessage from "./v2/utils/publishMessage";
import isTokenValid from "./v2/utils/validateToken";
import { V2RECEIVED_ACTIVITY_TOPIC } from "./v2/functions/activity";

dotenv.config();
admin.initializeApp();

// v2 functions

export const V2ReceivedActivity =
  v2Functions.default.ReceivedActivityFunction();
export const V2ProcessedActivity =
  v2Functions.default.ProcessedActivityFunction();
export const V2FetchUserEquipments = v2Functions.default.FetchUserEquipments();

// end v2

// const pubSubClient = new PubSub();
const usersCollection = `${process.env.USERS_COLLECTION}`;
const maintenanceCollection = `${process.env.MAINTENANCES_COLLECTION}`;
const stravaClientId = `${process.env.CLIENT_ID}`;
const stravaClientSecret = `${process.env.CLIENT_SECRET}`;
const verifyStravaToken = `${process.env.VERIFY_STRAVA_TOKEN}`;
const activitiesTopic = `${
  process.env.ACTIVITIES_TOPIC || "activities-changes"
}`;
const processedActivityTopic = `${
  process.env.PROCESSED_ACTIVITY_TOPIC || "processed-activity"
}`;
const mailsTopic = `${process.env.MAILS_TOPIC || "mails-maintenances"}`;
const mailAccount = `${process.env.MAIL_ACCOUNT}`;
const mailPassowrd = `${process.env.MAIL_PASSWORD}`;

// function publishMessage(message: string, topic: string) {
//   const dataBuffer = Buffer.from(message);
//   functions.logger.log(`PublishMessageTopic${topic}`, message);
//   pubSubClient
//     .topic(topic)
//     .publishMessage({ data: dataBuffer })
//     .catch((error) =>
//       functions.logger.log(`ErrorPublishMessageTopic${topic}`, error)
//     );
// }

// function isTokenValid(expiresIn: number) {
//   const expDateMs = expiresIn || null;
//   if (expDateMs) {
//     const expDateString = Number(`${expDateMs}`.padEnd(13, "0"));
//     const expDate = new Date(expDateString);
//     return expDate.getTime() > Date.now();
//   }
//   return false;
// }

export const webhook = functions.https.onRequest(async (req, res) => {
  if (req.method === "POST") {
    const stravaActivity = req.body;
    if (stravaActivity.aspect_type === "create") {
      publishMessage(JSON.stringify({ ...req.body }), activitiesTopic);
      publishMessage(
        JSON.stringify({ ...req.body }),
        V2RECEIVED_ACTIVITY_TOPIC
      );
    } else {
      functions.logger.log("UpdatedAcitivity", JSON.stringify({ ...req.body }));
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

    functions.logger.log(`ActivityInfo`, JSON.stringify(stravaActivity));

    if (stravaActivity && stravaActivity.aspect_type === "create") {
      const userId = stravaActivity.owner_id;
      const activityId = stravaActivity.object_id;

      const user: User = await admin
        .firestore()
        .collection(usersCollection)
        .doc(`${userId}`)
        .get()
        .then((doc): User => doc.data() ?? {})
        .catch(() => {
          return {};
        });
      functions.logger.log(`ActivityTokenUser`, JSON.stringify(user));

      if (user) {
        let authToken = user.token;
        const refToken = user.refreshToken;
        const expiresIn = user.expirationDate;
        const userEmail = user.email;
        const userName = user.name;

        let distance = 0;
        let movingTime = 0;
        let equipmentId = null;
        let equipmentName: string = "";
        const hasInvalidToken = !isTokenValid(Number(expiresIn));

        if (hasInvalidToken && refToken) {
          functions.logger.error(
            `UserWithInvalidToken`,
            `{ user: ${user.email}, expiresAt: ${user.expirationDate}}`
          );
          authToken = undefined;
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
                const updatedUser: User = {
                  ...user,
                  token: data.access_token ?? "",
                  refreshToken: data.refresh_token ?? "",
                  expirationDate: data.expires_at ?? "",
                };
                functions.logger.log("UpdatingUserToken", updatedUser);
                await admin
                  .firestore()
                  .collection(usersCollection)
                  .doc(`${userId}`)
                  .update({ ...updatedUser });
                authToken = updatedUser.token;
              })
              .catch(async (error) => {
                functions.logger.error(
                  `RefreshTokenError`,
                  JSON.stringify(error)
                );
              });
          } catch (error) {
            functions.logger.error(`RefreshTokenError`, JSON.stringify(error));
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
                distance = response.data.gear.distance || null;
                equipmentId = response.data.gear_id || null;
                equipmentName = response.data.gear.name || null;
                const activityObject = {
                  userId,
                  userName,
                  userEmail,
                  movingTime,
                  distance,
                  equipmentId,
                  equipmentName,
                };
                publishMessage(
                  JSON.stringify(activityObject),
                  processedActivityTopic
                );
              })
              .catch(async (error) => {
                functions.logger.error(
                  `ErrorFetchAtivityInfo-${activityId}`,
                  error
                );
              });
          } catch (error) {
            functions.logger.error(
              `ErrorFetchAtivityInfo-${activityId}`,
              error
            );
          }
        } else {
          functions.logger.error(
            `UserWithInvalidToken`,
            `{ user: ${user.email}, authToken: ${authToken}}`
          );
        }
      }
    }
  });

export const processActivityTopic = functions.pubsub
  .topic(processedActivityTopic)
  .onPublish(async (message, context) => {
    const activityInfo: ActivityInfo = message.data
      ? JSON.parse(Buffer.from(message.data, "base64").toString())
      : null;

    if (activityInfo?.userId) {
      const collection = admin
        .firestore()
        .collection(usersCollection)
        .doc(`${activityInfo.userId}`)
        .collection(maintenanceCollection);

      await collection
        .where("equipmentId", "==", `${activityInfo.equipmentId}`)
        .get()
        .then(async (response) => {
          const batch = admin.firestore().batch();
          for (const doc of response.docs) {
            const docRef = admin
              .firestore()
              .collection(usersCollection)
              .doc(`${activityInfo.userId}`)
              .collection(maintenanceCollection)
              .doc(doc.id);
            let maintenanceData: Maintenance | any = null;
            await docRef
              .get()
              .then((maintenanceDoc) => {
                if (maintenanceDoc.exists) {
                  const maintenance: Maintenance =
                    JSON.parse(JSON.stringify(maintenanceDoc.data())) || null;
                  if (maintenance) {
                    if (!activityInfo.equipmentName.length) {
                      activityInfo.equipmentName = maintenance.equipmentName;
                    }
                    if (maintenance.type === "distance") {
                      maintenance.value = activityInfo.distance;
                      maintenance.isValid =
                        maintenance.value < maintenance.goal;
                    } else if (maintenance.type === "date") {
                      maintenance.isValid =
                        Date.now() < new Date(maintenance.goal).getTime();
                    } else if (maintenance.type === "hours") {
                      maintenance.value += activityInfo.movingTime;
                      maintenance.isValid =
                        maintenance.value < maintenance.goal;
                    }
                    if (!maintenance.isValid && !maintenance.isResolved) {
                      publishMessage(
                        JSON.stringify({
                          ...maintenance,
                          userName: activityInfo.userName,
                          userEmail: activityInfo.userEmail,
                        }),
                        mailsTopic
                      );
                    }
                    maintenanceData = maintenance;
                  }
                }
              })
              .catch((error) =>
                functions.logger.error(
                  `ErrorFetchUserEquipment`,
                  JSON.stringify(error)
                )
              );
            if (maintenanceData) {
              batch.update(docRef, {
                value: maintenanceData.value,
                equipmentName: maintenanceData.equipmentName,
                isValid: maintenanceData.isValid,
              });
            }
          }
          batch
            .commit()
            .catch((error) =>
              functions.logger.error(
                `ErrorUserEquipmentBatchUpdate`,
                JSON.stringify(error)
              )
            );
        })
        .catch((error) =>
          functions.logger.error(
            `ErrorUserEquipmentBatchUpdate`,
            JSON.stringify(error)
          )
        );
    }
  });

export const mailTopic = functions.pubsub
  .topic(mailsTopic)
  .onPublish(async (message, context) => {
    const mailInfo = message.data
      ? JSON.parse(Buffer.from(message.data, "base64").toString())
      : null;

    if (mailInfo?.userEmail) {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: mailAccount,
          pass: mailPassowrd,
        },
      });

      const emailObject = {
        from: '"Manutenções Strava" <esjtechdev@mail.com>',
        to: `${mailInfo.userEmail}`,
        subject: "Manutenção Vencida",
        html: `<p>Olá, ${mailInfo.userName}!</p>\n <p>A manutenção ${mailInfo?.name} - ${mailInfo?.equipmentName} atingiu o limite definido.</p>\n <p>Acesso a sua conta e verifique.</p>`,
      };

      try {
        await transporter.sendMail(emailObject);
        functions.logger.log("SentEmail", emailObject);
      } catch (error) {
        functions.logger.error("ErrorSendingEmail", JSON.stringify(error));
      }
    } else {
      functions.logger.error("ErrorSendingEmail", JSON.stringify(mailInfo));
    }
  });
