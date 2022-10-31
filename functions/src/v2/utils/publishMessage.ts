import * as functions from "firebase-functions";

import { PubSub } from "@google-cloud/pubsub";

const pubSubClient = new PubSub();

const publishMessage = (message: string, topic: string) => {
  const dataBuffer = Buffer.from(message);
  functions.logger.log(`PublishMessageTopic${topic}`, message);
  pubSubClient
    .topic(topic)
    .publishMessage({ data: dataBuffer })
    .catch((error) =>
      functions.logger.log(`ErrorPublishMessageTopic${topic}`, error)
    );
};

export default publishMessage;
