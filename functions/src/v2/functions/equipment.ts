import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
// import * as axios from "axios";

import { User } from "../types/user.type";
import { V2COLLECTION } from "./activity";

const fetchUserEquipments = () =>
  functions.https.onRequest(async (req, res) => {
    functions.logger.info(
      JSON.stringify({ method: req.method, body: req.body })
    );
    const { userId } = req.body;

    if (userId) {
      try {
        const user: User = await admin
          .firestore()
          .collection(V2COLLECTION)
          .doc(userId)
          .get()
          .then((doc) => (doc.data() as User) ?? null);

        functions.logger.info(JSON.stringify({ user }));
        res.status(200).send({ user });
      } catch (error) {
        functions.logger.error(JSON.stringify(error));
        res.status(404).send({ error });
      }
    }
    res.status(200).send("Hello World");
  });

export { fetchUserEquipments };
