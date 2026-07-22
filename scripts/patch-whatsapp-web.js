// Postinstall patch for whatsapp-web.js.
//
// WhatsApp Web renamed the `_serialized` key on message identifiers to `$1` in a
// mid-July 2026 web app update. `getChatModel()` (used by getChat/getChats/getChatById)
// reads `chat.lastReceivedKey._serialized` unconditionally, which now resolves to
// `undefined` and crashes `IDBObjectStore.get(undefined)` with a minified error whose
// `.message` is a single letter (e.g. "r"). That crash happens inside `msg.getChat()`
// for every incoming message, so nothing gets processed even though the client stays
// connected and the cron job reports success.
//
// Upstream fix not yet released (https://github.com/wwebjs/whatsapp-web.js — issues
// #201840, #201848, #201850, #201851, open as of 2026-07-21). This patches the
// installed copy directly; safe to delete once a release contains the real fix.
//
// Idempotent: running it again after a fresh `npm ci` re-applies cleanly, and it's a
// no-op if the target file no longer contains the broken pattern (e.g. after upgrading
// past the real fix).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'whatsapp-web.js',
  'src',
  'util',
  'Injected',
  'Utils.js',
);

const MARKER = '// [patch-whatsapp-web] lastReceivedKey $1-tolerant';

const BROKEN = `        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastMessage = chat.lastReceivedKey
                ? window
                      .require('WAWebCollections')
                      .Msg.get(chat.lastReceivedKey._serialized) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([
                              chat.lastReceivedKey._serialized,
                          ])
                  )?.messages?.[0]
                : null;
            lastMessage &&
                (model.lastMessage =
                    window.WWebJS.getMessageModel(lastMessage));
        }`;

const FIXED = `        ${MARKER}
        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastReceivedKeyId =
                chat.lastReceivedKey?._serialized ??
                chat.lastReceivedKey?.$1 ??
                null;
            let lastMessage = null;
            if (lastReceivedKeyId) {
                try {
                    lastMessage =
                        window.require('WAWebCollections').Msg.get(lastReceivedKeyId) ||
                        (
                            await window
                                .require('WAWebCollections')
                                .Msg.getMessagesById([lastReceivedKeyId])
                        )?.messages?.[0];
                } catch {
                    lastMessage = null;
                }
            }
            lastMessage &&
                (model.lastMessage =
                    window.WWebJS.getMessageModel(lastMessage));
        }`;

let src;
try {
  src = readFileSync(target, 'utf8');
} catch {
  console.warn('[patch-whatsapp-web] target file not found, skipping:', target);
  process.exit(0);
}

if (src.includes(MARKER)) {
  console.log('[patch-whatsapp-web] already applied, skipping.');
  process.exit(0);
}

if (!src.includes(BROKEN)) {
  console.warn(
    '[patch-whatsapp-web] expected pattern not found (package may have updated past the bug) — skipping.',
  );
  process.exit(0);
}

writeFileSync(target, src.replace(BROKEN, FIXED));
console.log('[patch-whatsapp-web] applied getChatModel $1-tolerance patch.');
