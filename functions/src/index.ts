import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as axios from 'axios';
import { PubSub } from '@google-cloud/pubsub';

import { Maintenance } from './models/maintenance';

admin.initializeApp(functions.config().firebase);

const pubSubClient = new PubSub();

async function publishMessage(message: String) {
    /**
     * TODO(developer): Uncomment the following lines to run the sample.
     */
    // const topicName = 'my-topic';

    // Publishes the message as a string, e.g. "Hello, world!" or JSON.stringify(someObject)
    const dataBuffer = Buffer.from(message);

    const messageId = await pubSubClient.topic("activities-changes").publish(dataBuffer);
    console.log(`Message ${messageId} published.`);
}

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });  

export const webhook = functions.https.onRequest(async (req, res) => {

    if(req.method === 'POST') {
        console.log("webhook event received!", req.query, req.body);

        // const userId = req.body.owner_id;

        // admin.firestore()
        //     .collection('users')
        //     .doc(`${userId}`)
        //     .update({
        //         lastActivity: req.body
        //     }).then((response) => console.log(response))
        //     .catch((err) => console.log(err));

        // Creates a client; cache this for further use
        await publishMessage(JSON.stringify({...req.body})).catch(console.error);
        
        res.status(200).send('EVENT_RECEIVED');
    }

    // Your verify token. Should be a random string.
    const VERIFY_TOKEN = "STRAVA";
    // Parses the query params
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    // Checks if a token and mode is in the query string of the request
    if (mode && token) {
        // Verifies that the mode and token sent are valid
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {     
        // Responds with the challenge token from the request
        console.log('WEBHOOK_VERIFIED');
        res.json({"hub.challenge":challenge});  
        } else {
        // Responds with '403 Forbidden' if verify tokens do not match
        res.sendStatus(403);      
        }
    }

});

export const activityTopic = functions.pubsub.topic('activities-changes').onPublish(async (message, context) => {
    const stravaActivity = message.data ? JSON.parse(Buffer.from(message.data, 'base64').toString()) : null;
    
    if(stravaActivity) {

        const userId = stravaActivity.owner_id;
        const activityId = stravaActivity.object_id;

        const user:any = await admin.firestore()
            .collection('users')
            .doc(`${userId}`)
            .get()
            .then((doc) => 
                    doc.exists 
                        ? doc.data() 
                        : null)
            .catch(err => {
                console.log('Erro ao buscar usuario ', err);
                return null;
            });

        console.log(userId);
        console.log(user['ms-token']);

        if(user) {
            let authToken = user['ms-token'];
            const refToken = user['ms-ref-token'];

            let distance = 0;
            let equipmentId = null;
            let hasInvalidToken = false;

            try {

                if(authToken) {
                    const config = {
                        headers: { Authorization: `Bearer ${authToken}` }
                    };
    
                    console.log('On Try', authToken);
    
                    await axios.default
                        .get(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`, config)
                        .then(async (response) => {
                            distance = response.data.distance;
                            equipmentId = response.data.gear_id;
                            console.log(response.data.distance);
                            await admin.database().ref('/messages').push({activity: response.data});
                        });
                } else {
                    hasInvalidToken = true;
                }

            } catch (e){
                hasInvalidToken = true;
                authToken = null;
            }

            if(hasInvalidToken && refToken) {
                try {

                    const clientId = "client_id=33524";
                    const clientSecret = "client_secret=4417fb89842153873e3a17c8c474b39454ecd272";
                    const grantType = "grant_type=refresh_token";
                    const refreshToken = `refresh_token=${refToken}`;
    
                    await axios.default
                            .post(`https://www.strava.com/api/v3/oauth/token?${clientId}&${clientSecret}&${grantType}&${refreshToken}`)
                            .then(async (refresh) => {
                                const data = refresh.data;
                                await admin.firestore()
                                    .collection('users')
                                    .doc(`${userId}`)
                                    .update({
                                        "ms-token": data.access_token,
                                        "ms-ref-token": data.refresh_token,
                                        "ms-exp-data": data.expires_at
                                    });
                                authToken = data.access_token;
                            }).catch(async (error) => {
                                await admin.database().ref('/messages').push({refreshError: error});
                            })
                } catch (e) {
                    await admin.database().ref('/messages').push({refError: 'Error on get ref token'});
                }
            }

            if(authToken) {

                try {
                    const config = {
                        headers: { Authorization: `Bearer ${authToken}` }
                    };
    
                    console.log('On Try', authToken);
    
                    await axios.default
                        .get(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`, config)
                        .then(async (response) => {
                            distance = response.data.distance;
                            equipmentId = response.data.gear_id;
                            console.log(response.data.distance);
                            await admin.database().ref('/messages').push({activity: response.data});
                        });

                    const collection = admin.firestore().collection('users').doc(`${userId}`).collection('maintenances');

                    await collection.where('equipmentId', '==', `${equipmentId}`).get().then(async response => {
                        const batch = admin.firestore().batch();
                        for(let doc of response.docs) {
                            const docRef = admin.firestore().collection('users').doc(`${userId}`).collection('maintenances').doc(doc.id)
                            let docDistance = 0;
                            await docRef.get().then(docD => {
                                if(docD.exists) {
                                    const docData = docD.data() || null;
                                    if(docData) {
                                        console.log("Getting distance", docData['value'] + distance);
                                        docDistance = docData['value'] + distance;
                                    }
                                }
                            }).catch(error => console.log(error));
                            console.log("Batch update", docDistance);
                            batch.update(docRef, {value: docDistance});
                        }
                        batch.commit().then(() => {
                            console.log(`updated all documents inside users`)
                        }).catch(error => console.log(error));
                    }).catch(error => console.log(error))
                } catch (e) {
                    await admin.database().ref('/logs').push({refError: 'Error on get activity'});
                }
                 
                
            } 
        }
    
    }
})

export const findUserById = functions.https.onRequest(async (req, res) => {

    const userId: string = `${req.query.id}`;
    const bikes: any[] = req.body.bikes;

    if(!bikes.length) {
        res.status(400).send("Bikes array not provided");
        return Promise.resolve();
    }

    const user:any = await admin.firestore()
        .collection('users')
        .doc(userId)
        .get()
        .then((doc) => 
                doc.exists 
                    ? doc.data() 
                    : null)
        .catch(err => {
            console.log('Erro ao buscar usuario ', err);
            return null;
        });

    if(!user) {
        res.status(204).send("User not found");
        return Promise.resolve();
    }

    const maintenances = user.maintenances || null;

    if(maintenances.length) {

        while(bikes.length) {
            const bike = bikes.pop();

            maintenances.forEach((maintenance: Maintenance) => {
                if(maintenance.equip_id === bike.id) {
                    maintenance.value += (bike.distance - maintenance.value);
                }
            })
    
    
        }
    }

    await admin.firestore()
        .collection('users')
        .doc(userId)
        .set({
            maintenances
        });

    res.status(200).send({maintenances, bikes});
})
