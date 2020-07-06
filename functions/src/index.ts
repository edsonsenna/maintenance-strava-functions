import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
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
    const messageBody = message.data ? Buffer.from(message.data, 'base64').toString() : null;
    await admin.database().ref('/messages').push({original: messageBody});
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
