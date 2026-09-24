// Cloud Functions for /chat. Deploy with: firebase deploy --only functions   (needs the Blaze plan)
//
//   notifyDirectMessage  push notification when someone receives a DM
//   notifyRoomMention    push notification when someone is @mentioned in a room
//   notifyDmCall         push notification when someone starts a voice call in a DM
//   scanDmImage / scanRoomImage / scanCustom / scanAvatar
//                        check uploaded images with Cloud Vision SafeSearch; remove anything
//                        explicit, file a flag for moderators and give the uploader a strike
//   onReport             copy the reported message into the report so moderators see the real
//                        thing, and hold child-safety reports out of view straight away
//
// Image scanning needs the Cloud Vision API switched on for the project (see firebase/SAFETY.md).
const { onValueCreated, onValueWritten } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');
const vision = require('@google-cloud/vision');

admin.initializeApp();

const REGION = 'us-central1';
const SITE = 'https://kanaris-beans.com';
const ICON = `${SITE}/public/pw64s5dmavz539gvjm065tw71xp1.png`;
const STRIKES_TO_BAN = 3;

let visionClient;
const db = () => admin.database();

// ---------- Push notifications ----------

async function pushTo(uid, { title, body, tag, link }) {
  const tokensSnap = await db().ref(`fcmTokens/${uid}`).get();
  const tokens = Object.keys(tokensSnap.val() || {});
  if (!tokens.length) return;

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: { notification: { icon: ICON, tag }, fcmOptions: { link } },
  });

  // Drop tokens for devices that uninstalled or revoked permission.
  const stale = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      stale[tokens[i]] = null;
    }
  });
  if (Object.keys(stale).length) await db().ref(`fcmTokens/${uid}`).update(stale);
}

function previewOf(msg) {
  if (msg.text) return String(msg.text).slice(0, 140);
  if (msg.sticker) return 'Sent a sticker';
  if (msg.image) return msg.image.startsWith('https://') ? 'Sent a GIF' : 'Sent an image';
  return 'New message';
}

exports.notifyDirectMessage = onValueCreated(
  { ref: '/dms/{dmId}/messages/{msgId}', region: REGION },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.from || msg.deleted) return;

    const [a, b] = event.params.dmId.split('_');
    const to = msg.from === a ? b : a;
    if (!to || to === msg.from) return;

    const [senderSnap, blockedSnap] = await Promise.all([
      db().ref(`users/${msg.from}/username`).get(),
      db().ref(`blocks/${to}/${msg.from}`).get(),
    ]);
    if (blockedSnap.exists()) return;

    await pushTo(to, {
      title: senderSnap.val() || 'Someone',
      body: previewOf(msg),
      tag: event.params.dmId,
      link: `${SITE}/chat#dm/${msg.from}`,
    });
  }
);

exports.notifyRoomMention = onValueCreated(
  { ref: '/rooms/{roomId}/messages/{msgId}', region: REGION },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.from || !msg.text || msg.kind === 'system') return;

    const names = [...new Set((String(msg.text).match(/@([a-zA-Z0-9_]{3,20})/g) || []).map((m) => m.slice(1).toLowerCase()))];
    if (!names.length) return;

    const { roomId } = event.params;
    const [membersSnap, metaSnap, senderSnap] = await Promise.all([
      db().ref(`rooms/${roomId}/members`).get(),
      db().ref(`rooms/${roomId}/meta/name`).get(),
      db().ref(`users/${msg.from}/username`).get(),
    ]);
    const members = membersSnap.val() || {};

    await Promise.all(names.slice(0, 10).map(async (name) => {
      const uid = (await db().ref(`usernames/${name}`).get()).val();
      if (!uid || uid === msg.from || !members[uid]) return;
      if ((await db().ref(`blocks/${uid}/${msg.from}`).get()).exists()) return;
      await pushTo(uid, {
        title: `${senderSnap.val() || 'Someone'} in ${metaSnap.val() || roomId}`,
        body: previewOf(msg),
        tag: `room-${roomId}`,
        link: `${SITE}/chat#room/${roomId}`,
      });
    }));
  }
);

exports.notifyDmCall = onValueCreated(
  { ref: '/voiceDm/{dmId}/participants/{uid}', region: REGION },
  async (event) => {
    const caller = event.params.uid;
    const [a, b] = event.params.dmId.split('_');
    const to = caller === a ? b : a;
    if (!to || to === caller) return;
    const [inCall, blocked, senderSnap] = await Promise.all([
      db().ref(`voiceDm/${event.params.dmId}/participants/${to}`).get(),
      db().ref(`blocks/${to}/${caller}`).get(),
      db().ref(`users/${caller}/username`).get(),
    ]);
    if (inCall.exists() || blocked.exists()) return;
    await pushTo(to, {
      title: senderSnap.val() || 'Someone',
      body: 'is calling you',
      tag: `call-${event.params.dmId}`,
      link: `${SITE}/chat#dm/${caller}`,
    });
  }
);

// ---------- Image scanning ----------

const LIKELY = ['LIKELY', 'VERY_LIKELY'];

// Returns null when the image is fine, otherwise a short reason.
async function checkImage(dataUrl) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return 'unreadable image';
  visionClient = visionClient || new vision.ImageAnnotatorClient();
  const [result] = await visionClient.safeSearchDetection({ image: { content: Buffer.from(m[1], 'base64') } });
  const s = result.safeSearchAnnotation || {};
  if (LIKELY.includes(s.adult)) return `adult (${s.adult})`;
  if (s.racy === 'VERY_LIKELY') return 'racy (VERY_LIKELY)';
  if (s.violence === 'VERY_LIKELY') return 'violence (VERY_LIKELY)';
  return null;
}

async function strike(uid, reason, where) {
  const res = await db().ref(`strikes/${uid}`).transaction((n) => (n || 0) + 1);
  const count = res.snapshot.val();
  if (count >= STRIKES_TO_BAN) {
    const ban = await db().ref(`bans/${uid}`).get();
    if (!ban.exists()) {
      await db().ref(`bans/${uid}`).set({ by: 'auto', ts: Date.now(), reason: `Automatic: ${count} images removed by the filter` });
    }
  }
  await db().ref('flags').push({ uid, reason, where, strikes: count, ts: Date.now(), status: 'open' });
}

async function scanMessage(event, where) {
  const msg = event.data.val();
  if (!msg || !msg.image || !msg.image.startsWith('data:')) return;
  const ref = event.data.ref;
  let bad;
  try {
    bad = await checkImage(msg.image);
  } catch (err) {
    // Leave the image pending (still blurred for everyone) so a moderator can look.
    console.error('scan failed', where, err);
    await db().ref('flags').push({ uid: msg.from, reason: `scan failed: ${err.message}`, where, ts: Date.now(), status: 'open' });
    return;
  }
  if (!bad) {
    await ref.update({ scan: 'ok' });
    return;
  }
  await ref.update({ scan: 'blocked', image: null });
  await strike(msg.from, bad, where);
}

exports.scanDmImage = onValueCreated(
  { ref: '/dms/{dmId}/messages/{msgId}', region: REGION, memory: '512MiB' },
  (event) => scanMessage(event, `dms/${event.params.dmId}/messages/${event.params.msgId}`)
);

exports.scanRoomImage = onValueCreated(
  { ref: '/rooms/{roomId}/messages/{msgId}', region: REGION, memory: '512MiB' },
  (event) => scanMessage(event, `rooms/${event.params.roomId}/messages/${event.params.msgId}`)
);

exports.scanCustom = onValueCreated(
  { ref: '/customs/{uid}/{id}', region: REGION },
  async (event) => {
    const item = event.data.val();
    if (!item || !item.data) return;
    const where = `customs/${event.params.uid}/${event.params.id}`;
    const bad = await checkImage(item.data);
    if (!bad) return event.data.ref.update({ scan: 'ok' });
    await event.data.ref.remove();
    await strike(event.params.uid, bad, where);
  }
);

exports.scanAvatar = onValueWritten(
  { ref: '/users/{uid}/avatar', region: REGION },
  async (event) => {
    const avatar = event.data.after.val();
    if (!avatar) return;
    const { uid } = event.params;
    const bad = await checkImage(avatar);
    const userRef = db().ref(`users/${uid}`);
    // Only settle the scan if the avatar hasn't been swapped again while we were checking.
    const current = (await userRef.child('avatar').get()).val();
    if (current !== avatar) return;
    if (!bad) return userRef.update({ avatarScan: 'ok' });
    await userRef.update({ avatar: null, avatarScan: null });
    await strike(uid, bad, `users/${uid}/avatar`);
  }
);

// ---------- Reports ----------

// A reporter must be in the conversation they're reporting from.
async function canSee(uid, path) {
  const [kind, id] = path.split('/');
  if (kind === 'dms') return id.split('_').includes(uid);
  if (kind === 'rooms') return (await db().ref(`rooms/${id}/members/${uid}`).get()).exists();
  return false;
}

exports.onReport = onValueCreated(
  { ref: '/reports/{id}', region: REGION },
  async (event) => {
    const report = event.data.val();
    if (!report) return;
    const updates = { priority: report.reason === 'child_safety' };

    if (report.type === 'message' && report.path && await canSee(report.by, report.path)) {
      const msgRef = db().ref(report.path);
      const msg = (await msgRef.get()).val();
      if (msg) {
        updates.evidence = {
          from: msg.from || null,
          ts: msg.ts || null,
          text: msg.text || null,
          image: msg.image || null,
          sticker: msg.sticker || null,
          capturedAt: Date.now(),
        };
        // Child-safety reports: take the message out of view until a moderator has looked.
        if (updates.priority) await msgRef.update({ held: true, image: null, text: null, sticker: null, deleted: true });
      } else {
        updates.evidence = { missing: true, capturedAt: Date.now() };
      }
    }
    await event.data.ref.update(updates);
  }
);
