const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.sendToDrivers = functions.https.onRequest(async (req, res) => {
  const { title, body } = req.body;

  try {
    const response = await admin.messaging().send({
      topic: "drivers",
      notification: {
        title: title || "job",
        body: body || "be online",
      },
    });

    res.status(200).send({
      success: true,
      messageId: response,
    });
  } catch (error) {
    res.status(500).send(error.toString());
  }
});
