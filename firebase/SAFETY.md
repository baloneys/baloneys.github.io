# /chat setup and safety

## One-time setup (Firebase console, project `status-chat-12343`)

1. **Authentication → Sign-in method**: switch on **Email/Password**. Accounts use
   `<username>@chat.kanaris-beans.com` behind the scenes; nobody sees or needs an email.
   Passwords can't be reset, because there's no real inbox.
2. **Realtime Database rules**: deploy `database.rules.json`:
   `cd firebase && firebase deploy --only database`
3. **Cloud Functions** (Blaze plan): `cd firebase/functions && npm install && cd .. && firebase deploy --only functions`
4. **Cloud Vision API**: enable it for the project in Google Cloud console
   (APIs & Services → Library → "Cloud Vision API"). The scanning functions use it.
   The first 1,000 images a month are free.
5. **Moderators**: in the Realtime Database console add `mods/<uid>: true` for each moderator.
   You can find a uid under Authentication → Users. Moderators get a shield button in chat.
6. Optional: set `VAPID_KEY` in `chat.js` to your Web Push certificate key
   (Project settings → Cloud Messaging). Without it Firebase's default key is used.

If you can't deploy the functions yet, set `SERVER_SCAN = false` in `chat.js`. Otherwise images,
avatars and custom emoji stay "being checked" for other people, because nothing marks them as scanned.

## What protects the chat

| Layer | What it does |
| --- | --- |
| Sign-up | Username + password only, 13+ and rules checkbox. |
| In-browser image filter | NSFW.js (model hosted in `/chat-model`) checks every image **before it's sent** and refuses explicit ones. It checks again on the **recipient's** device before showing an image that hasn't been scanned by the server yet. |
| Server image scan | `scanDmImage`, `scanRoomImage`, `scanCustom` and `scanAvatar` run Google Cloud Vision SafeSearch on every uploaded image, emoji, sticker and avatar. Explicit images are deleted, a flag is filed for moderators and the uploader gets a strike. **3 strikes = automatic suspension.** |
| Held until scanned | Uploaded images stay hidden for everyone else until the server marks them `ok`. If the server hasn't answered within 45 seconds, the in-browser result is used. The database rules stop clients from marking their own images as scanned. |
| GIFs | Only `*.giphy.com` URLs are accepted (enforced by the rules), and search results are rated `pg-13`. Arbitrary image links are rejected. |
| Reports | Every message has ⚑ Report, and profiles have Report. `onReport` copies the real message into the report so moderators see what was actually sent. **Child-safety reports hide the message immediately**, but only when the reporter was actually in that conversation. |
| Blocking | Blocks are enforced by the database rules: a blocked person can't DM or call you. Their room messages are collapsed for you. |
| Rooms | Hosts can mute, kick (and later allow back) and transfer host. Kicked users are removed from voice too. |
| Moderator panel | Reports (urgent first), auto-flags, user lookup (strikes, suspend, remove avatar/custom emoji), suspensions and an action log. Mods can delete any message they can reach through a report, and delete rooms. Suspended accounts can read but not post, upload, create rooms or join voice. |

Limits worth knowing:
- Image classifiers catch nudity and sexual content, but **they do not identify child sexual abuse
  material (CSAM) specifically.** Dedicated hash-matching tools do that: Google's Content Safety API
  and Microsoft PhotoDNA. Both need an application; apply if the chat grows.
- DMs are private. Moderators only see a DM message when someone in that DM reports it.
- Voice is peer-to-peer, so people in a call can see each other's IP address (chat tells people this
  before their first call). Calls aren't recorded, so voice can't be moderated after the fact. Use block, kick or suspend.

## If someone reports child sexual abuse material

1. Don't download, screenshot, forward or re-share it. Reveal the image in the mod panel only if
   you must, to confirm.
2. Suspend the account from the report (**Suspend user**) and mark the report resolved.
   The report keeps the evidence.
3. Report it to the authorities:
   - Australia: ACCCE, <https://www.accce.gov.au/report>, and/or eSafety, <https://www.esafety.gov.au/report>
   - US / international: NCMEC CyberTipline, <https://report.cybertip.org>
4. Keep the report and don't delete the account data until the authorities have what they need.
