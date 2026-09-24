// Sends a push notification (Firebase Cloud Messaging) when someone receives a DM.
// Deploy with: firebase deploy --only functions   (needs the Blaze plan)
const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();

exports.notifyDirectMessage = onValueCreated(
  { ref: '/dms/{dmId}/messages/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.from || msg.deleted) return;

    const [a, b] = event.params.dmId.split('_');
    const to = msg.from === a ? b : a;
    if (!to || to === msg.from) return;

    const db = admin.database();
    const [senderSnap, tokensSnap] = await Promise.all([
      db.ref(`users/${msg.from}/username`).get(),
      db.ref(`fcmTokens/${to}`).get(),
    ]);
    const tokens = Object.keys(tokensSnap.val() || {});
    if (!tokens.length) return;

    const sender = senderSnap.val() || 'Someone';
    const body = msg.text ? String(msg.text).slice(0, 140) : msg.image ? 'Sent an image' : 'New message';

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: sender, body },
      webpush: {
        notification: { icon: 'https://kanaris-beans.com/public/pw64s5dmavz539gvjm065tw71xp1.png', tag: event.params.dmId },
        fcmOptions: { link: `https://kanaris-beans.com/chat#dm/${msg.from}` },
      },
    });

    // Drop tokens for devices that uninstalled or revoked permission.
    const stale = {};
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        stale[tokens[i]] = null;
      }
    });
    if (Object.keys(stale).length) await db.ref(`fcmTokens/${to}`).update(stale);
  }
);
