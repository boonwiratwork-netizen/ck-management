// One-time: make the VAPID key pair for push alerts (Node 18+, no packages needed).
//   node scripts/generate-vapid-keys.mjs
// Paste the two lines into Supabase → Edge Functions → Secrets (VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY), plus VAPID_SUBJECT = mailto:<an address you read>. Never commit them.
// Changing the keys later switches every phone off (each person turns it on again).
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
// Uncompressed point 0x04 || X || Y, base64url — the form browsers and web-push expect
const b64u = (b) => Buffer.from(b).toString("base64url");
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${priv.d}`);
