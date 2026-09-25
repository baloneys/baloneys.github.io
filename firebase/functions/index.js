// Cloud Functions for /chat. Deploy with: firebase deploy --only functions   (needs the Blaze plan)
//
// Chat data lives in Cloud Firestore; online status, typing and voice-call setup live in the
// Realtime Database. These functions:
//
//   notifyDirectMessage  push notification when someone receives a DM
//   notifyRoomMention    push notification when someone is @mentioned in a room
//   notifyDmCall         push notification when someone starts a voice call in a DM
//   scanDmImage / scanRoomImage / scanCustom / scanAvatar
//                        check uploaded images with Cloud Vision SafeSearch; remove anything
//                        explicit, file a flag for moderators and give the uploader a strike
//   onReport             copy the reported message into the report so moderators see the real
//                        thing, and hold child-safety reports out of view straight away
//   mirrorRoom / mirrorBlock / mirrorBan
//                        copy room membership, blocks and suspensions into the Realtime Database
//                        (mirror/...), because its rules for voice and typing can't read Firestore
//   cleanupRoom          delete a room's messages and live state when the room is deleted
//
// Image scanning needs the Cloud Vision API switched on for the project (see firebase/SAFETY.md).
const { onDocumentCreated, onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

admin.initializeApp();

const REGION = 'us-central1';
const SITE = 'https://kanaris-beans.com';
const ICON = `${SITE}/public/pw64s5dmavz539gvjm065tw71xp1.png`;
const STRIKES_TO_BAN = 3;

let visionClient;
const fs = () => admin.firestore();
const rtdb = () => admin.database();

// ---------- Push notifications ----------

async function pushTo(uid, { title, body, tag, link }) {
  const tokensSnap = await fs().collection(`fcmTokens/${uid}/tokens`).get();
  const tokens = tokensSnap.docs.map((d) => d.id);
  if (!tokens.length) return;

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: { notification: { icon: ICON, tag }, fcmOptions: { link } },
  });

  // Drop tokens for devices that uninstalled or revoked permission.
  const batch = fs().batch();
  let stale = 0;
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      batch.delete(fs().doc(`fcmTokens/${uid}/tokens/${tokens[i]}`));
      stale++;
    }
  });
  if (stale) await batch.commit();
}

function plain(text) {
  return String(text).replace(/\|\|[\s\S]+?\|\|/g, '▒▒▒').replace(/(\*\*|__|~~|`)/g, '').slice(0, 140);
}

function previewOf(msg) {
  if (msg.text) return plain(msg.text);
  if (msg.sticker) return 'Sent a sticker';
  if (msg.image) return msg.image.startsWith('https://') ? 'Sent a GIF' : 'Sent an image';
  return 'New message';
}

async function usernameOf(uid) {
  const snap = await fs().doc(`users/${uid}`).get();
  return (snap.exists && snap.get('username')) || 'Someone';
}

const isBlockedBy = async (owner, other) => (await fs().doc(`blocks/${owner}/users/${other}`).get()).exists;

exports.notifyDirectMessage = onDocumentCreated(
  { document: 'dms/{dmId}/messages/{msgId}', region: REGION },
  async (event) => {
    const msg = event.data && event.data.data();
    if (!msg || !msg.from || msg.deleted) return;

    const [a, b] = event.params.dmId.split('_');
    const to = msg.from === a ? b : a;
    if (!to || to === msg.from) return;
    if (await isBlockedBy(to, msg.from)) return;

    await pushTo(to, {
      title: await usernameOf(msg.from),
      body: previewOf(msg),
      tag: event.params.dmId,
      link: `${SITE}/chat#dm/${msg.from}`,
    });
  }
);

exports.notifyRoomMention = onDocumentCreated(
  { document: 'rooms/{roomId}/messages/{msgId}', region: REGION },
  async (event) => {
    const msg = event.data && event.data.data();
    if (!msg || !msg.from || !msg.text || msg.kind === 'system') return;

    const names = [...new Set((String(msg.text).match(/@([a-zA-Z0-9_]{3,20})/g) || []).map((m) => m.slice(1).toLowerCase()))];
    if (!names.length) return;

    const { roomId } = event.params;
    const room = (await fs().doc(`rooms/${roomId}`).get()).data();
    if (!room) return;
    const sender = await usernameOf(msg.from);

    await Promise.all(names.slice(0, 10).map(async (name) => {
      const claim = await fs().doc(`usernames/${name}`).get();
      const uid = claim.exists && claim.get('uid');
      if (!uid || uid === msg.from || !room.memberIds.includes(uid)) return;
      if (await isBlockedBy(uid, msg.from)) return;
      await pushTo(uid, {
        title: `${sender} in ${room.name || roomId}`,
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
    const inCall = await rtdb().ref(`voiceDm/${event.params.dmId}/participants/${to}`).get();
    if (inCall.exists() || await isBlockedBy(to, caller)) return;
    await pushTo(to, {
      title: await usernameOf(caller),
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
  const ref = fs().doc(`strikes/${uid}`);
  const count = await fs().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = ((snap.exists && snap.get('count')) || 0) + 1;
    tx.set(ref, { count: next });
    return next;
  });
  if (count >= STRIKES_TO_BAN) {
    const ban = fs().doc(`bans/${uid}`);
    if (!(await ban.get()).exists) {
      await ban.set({ by: 'auto', ts: FieldValue.serverTimestamp(), reason: `Automatic: ${count} images removed by the filter` });
    }
  }
  await fs().collection('flags').add({ uid, reason, where, strikes: count, ts: FieldValue.serverTimestamp(), status: 'open' });
}

async function scanMessage(event, where) {
  const msg = event.data && event.data.data();
  if (!msg || !msg.image || !msg.image.startsWith('data:')) return;
  const ref = event.data.ref;
  let bad;
  try {
    bad = await checkImage(msg.image);
  } catch (err) {
    // Leave the image pending (still hidden for everyone else) so a moderator can look.
    console.error('scan failed', where, err);
    await fs().collection('flags').add({ uid: msg.from, reason: `scan failed: ${err.message}`, where, ts: FieldValue.serverTimestamp(), status: 'open' });
    return;
  }
  if (!bad) {
    await ref.update({ scan: 'ok' });
    return;
  }
  await ref.update({ scan: 'blocked', image: FieldValue.delete() });
  await strike(msg.from, bad, where);
}

exports.scanDmImage = onDocumentCreated(
  { document: 'dms/{dmId}/messages/{msgId}', region: REGION, memory: '512MiB' },
  (event) => scanMessage(event, `dms/${event.params.dmId}/messages/${event.params.msgId}`)
);

exports.scanRoomImage = onDocumentCreated(
  { document: 'rooms/{roomId}/messages/{msgId}', region: REGION, memory: '512MiB' },
  (event) => scanMessage(event, `rooms/${event.params.roomId}/messages/${event.params.msgId}`)
);

exports.scanCustom = onDocumentCreated(
  { document: 'customs/{uid}/items/{id}', region: REGION },
  async (event) => {
    const item = event.data && event.data.data();
    if (!item || !item.data) return;
    const where = `customs/${event.params.uid}/items/${event.params.id}`;
    const bad = await checkImage(item.data);
    if (!bad) return event.data.ref.update({ scan: 'ok' });
    await event.data.ref.delete();
    await strike(event.params.uid, bad, where);
  }
);

exports.scanAvatar = onDocumentWritten(
  { document: 'users/{uid}', region: REGION },
  async (event) => {
    const after = event.data.after.exists ? event.data.after.data() : null;
    const before = event.data.before.exists ? event.data.before.data() : null;
    const avatar = after && after.avatar;
    if (!avatar || (before && before.avatar === avatar) || after.avatarScan !== 'pending') return;
    const { uid } = event.params;
    const bad = await checkImage(avatar);
    const userRef = fs().doc(`users/${uid}`);
    // Only settle the scan if the avatar hasn't been swapped again while we were checking.
    const current = (await userRef.get()).get('avatar');
    if (current !== avatar) return;
    if (!bad) return userRef.update({ avatarScan: 'ok' });
    await userRef.update({ avatar: FieldValue.delete(), avatarScan: FieldValue.delete() });
    await strike(uid, bad, `users/${uid}/avatar`);
  }
);

// ---------- Reports ----------

// A reporter must be in the conversation they're reporting from.
async function canSee(uid, path) {
  const [kind, id] = path.split('/');
  if (kind === 'dms') return id.split('_').includes(uid);
  if (kind === 'rooms') {
    const room = (await fs().doc(`rooms/${id}`).get()).data();
    return !!room && room.memberIds.includes(uid);
  }
  return false;
}

exports.onReport = onDocumentCreated(
  { document: 'reports/{id}', region: REGION },
  async (event) => {
    const report = event.data && event.data.data();
    if (!report) return;
    const updates = { priority: report.reason === 'child_safety' };

    if (report.type === 'message' && report.path && await canSee(report.by, report.path)) {
      const msgRef = fs().doc(report.path);
      const msg = (await msgRef.get()).data();
      if (msg) {
        updates.evidence = {
          from: msg.from || null,
          ts: msg.ts || null,
          text: msg.text || null,
          image: msg.image || null,
          sticker: msg.sticker || null,
          capturedAt: FieldValue.serverTimestamp(),
        };
        // The server's copy replaces the reporter's, keeping the report under Firestore's 1 MiB limit.
        updates.snapshot = FieldValue.delete();
        // Child-safety reports: take the message out of view until a moderator has looked.
        if (updates.priority) {
          await msgRef.update({
            held: true, deleted: true,
            text: FieldValue.delete(), image: FieldValue.delete(), sticker: FieldValue.delete(),
          });
        }
      } else {
        updates.evidence = { missing: true, capturedAt: FieldValue.serverTimestamp() };
      }
    }
    await event.data.ref.update(updates);
  }
);

// ---------- Mirrors for the Realtime Database rules ----------

exports.mirrorRoom = onDocumentWritten(
  { document: 'rooms/{code}', region: REGION },
  async (event) => {
    const { code } = event.params;
    const room = event.data.after.exists ? event.data.after.data() : null;
    if (!room) {
      await rtdb().ref(`mirror/rooms/${code}`).remove();
      return;
    }
    const roles = {};
    for (const uid of room.memberIds || []) roles[uid] = uid === room.owner ? 'owner' : (room.muted || []).includes(uid) ? 'muted' : 'member';
    await rtdb().ref(`mirror/rooms/${code}`).set(roles);

    // Anyone who left, was kicked or muted drops out of the room's voice call.
    const parts = (await rtdb().ref(`voiceRoom/${code}/participants`).get()).val() || {};
    const out = {};
    for (const uid of Object.keys(parts)) if (!roles[uid] || roles[uid] === 'muted') out[uid] = null;
    if (Object.keys(out).length) await rtdb().ref(`voiceRoom/${code}/participants`).update(out);
  }
);

exports.mirrorBlock = onDocumentWritten(
  { document: 'blocks/{uid}/users/{other}', region: REGION },
  async (event) => {
    const { uid, other } = event.params;
    const dmId = uid < other ? `${uid}_${other}` : `${other}_${uid}`;
    // A DM pair is blocked for voice if either person has blocked the other.
    const [mine, theirs] = await Promise.all([
      fs().doc(`blocks/${uid}/users/${other}`).get(),
      fs().doc(`blocks/${other}/users/${uid}`).get(),
    ]);
    const blocked = mine.exists || theirs.exists;
    await rtdb().ref(`mirror/dmBlocked/${dmId}`).set(blocked ? true : null);
    if (blocked) await rtdb().ref(`voiceDm/${dmId}/participants`).remove();
  }
);

exports.mirrorBan = onDocumentWritten(
  { document: 'bans/{uid}', region: REGION },
  async (event) => {
    const { uid } = event.params;
    await rtdb().ref(`mirror/bans/${uid}`).set(event.data.after.exists ? true : null);
  }
);

exports.cleanupRoom = onDocumentDeleted(
  { document: 'rooms/{code}', region: REGION },
  async (event) => {
    const { code } = event.params;
    await fs().recursiveDelete(fs().collection(`rooms/${code}/messages`));
    await rtdb().ref().update({ [`voiceRoom/${code}`]: null, [`typingRoom/${code}`]: null, [`mirror/rooms/${code}`]: null });
  }
);
