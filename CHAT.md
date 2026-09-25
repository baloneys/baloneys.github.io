# /chat: how it works

/chat is fully peer-to-peer. There is no database, account server or Firebase.
Everything runs in visitors' browsers.

## Pieces

| Piece | What it does |
| --- | --- |
| **Identity** | On first visit the browser makes an ECDSA P-256 key pair and keeps it in IndexedDB. The **friend code** (e.g. `ABCD-EFGH-JKLM-NPQR`) is a hash of the public key. Every connection starts with both sides signing a random challenge, so nobody can pretend to be someone else's friend code. |
| **Contacts & DMs** | Add someone by friend code (or their `#add/…` link). They have to accept before you can DM. Messages go directly between the two browsers over a WebRTC data channel. If they're offline, messages wait in an outbox and send automatically when you're both online. |
| **History** | Saved only on each person's device (IndexedDB). Clearing site data deletes it. |
| **Rooms** | One member's browser hosts the room (as `bchat-room-CODE`), relays messages, keeps the last 150 messages for people who join, and enforces mute, kick and bans. If the host leaves or closes the tab, another member takes over automatically. A room exists while at least one member has chat open. |
| **Voice** | Peer-to-peer WebRTC audio. DMs are 1-to-1 calls; rooms connect everyone in voice to everyone else (up to 8 people). |
| **Finding each other** | Browsers use [PeerJS](https://peerjs.com/)'s free public broker (`0.peerjs.com`) only to find each other and exchange connection details. Messages, images and audio never go through it. |
| **Customisation** | Settings (gear) and the palette button open a glass settings panel. Appearance options are backgrounds (gradients, solid colour, or your own image with blur and darkening), glass and panel opacity, message text colour (including *Blend*), accent colour and text size. They're saved in this browser only. Profile options are name colour or gradient-with-glow, avatar, banner and bio, and go to contacts and room members. Room hosts can set a room picture, description, background theme and accent colour; members see the room's look while they're in it (they can turn room themes off). |
| **Nicknames** | Anyone can set a nickname for themselves in a room, and the host can change or reset anyone's. Nicknames only show inside that room, and `@nickname` mentions work there. |
| **Backups** | Settings → *Back up* downloads a file with your identity (including the private key), contacts and rooms. *Restore a backup* on another device or after clearing data. Keep that file private: anyone with it can be you. |

## Safety without a server

- **Image filter on the receiver.** Every image, sticker, custom emoji and avatar from someone else is checked on *your* device with NSFW.js (the model is hosted in `/chat-model`) before it's shown, so a modified sender can't skip it. Explicit images are hidden. The sender's device also refuses to send explicit images.
- **Contact requests.** Strangers can't DM you until you accept them.
- **Blocking.** Blocks are saved on your device. Blocked people are disconnected, can't message or call you, and their room messages are collapsed.
- **Room hosts** can mute, kick (ban from that room), allow back, rename and hand over the room. Reports made in a room go to its host with a copy of the message.
- **Serious reports** (child safety, self-harm, violence) point people to the ACCCE, eSafety, NCMEC or Lifeline.
- **Site-wide blocklist.** `chat-blocklist.json` lists friend codes that everyone's browser refuses to connect to. To ban someone, add their code and commit:

  ```json
  {
    "blocked": {
      "ABCD-EFGH-JKLM-NPQR": "spam"
    }
  }
  ```

  It takes effect when people next load /chat. Someone can make a new identity, so it's a speed bump, not a wall.

## Limits

- **Both people must be online** for a message to arrive. There are no push notifications; desktop alerts only work while /chat is open.
- **IP addresses are visible** to the people you're connected to (contacts, room hosts, and people in voice with you). The app warns before the first call.
- **No central moderation.** Nobody can see or remove content across the whole chat, and there are no site-wide bans beyond the blocklist file. The image filter catches nudity but can't specifically identify child sexual abuse material.
- **Strict networks** (some schools, workplaces, mobile carriers) can block direct connections. Adding a TURN server to `ICE_SERVERS` in `chat.js` fixes that, but TURN relays traffic through that server.
- **The public PeerJS broker** is free and has no uptime guarantee. You can run your own ([peerjs-server](https://github.com/peers/peerjs-server)) and point `PEER_OPTS` at it.
- One browser tab at a time per identity (a second tab shows a message).

## If someone reports child sexual abuse material

Don't download, screenshot or share it. Add the account's friend code to `chat-blocklist.json`, and report it:
Australia: ACCCE <https://www.accce.gov.au/report> or eSafety <https://www.esafety.gov.au/report>;
elsewhere: NCMEC CyberTipline <https://report.cybertip.org>.
