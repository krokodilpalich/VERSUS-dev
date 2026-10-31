import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { rootCertificates } from "node:tls";

// Compose needs a real file for its build secret on macOS as well as Linux.
// Managed cloud builds keep using the injected CODEX_PROXY_CERT instead.
mkdirSync(".local", { recursive: true, mode: 0o700 });
if (!existsSync(".local/build-ca.pem")) {
  writeFileSync(".local/build-ca.pem", rootCertificates.join("\n") + "\n", {
    mode: 0o600,
  });
}
if (!existsSync(".env.local")) {
  const password = randomBytes(24).toString("hex");
  const text = readFileSync(".env.example", "utf8")
    .replaceAll("replace-me", password)
    .replace(
      "replace-with-at-least-32-random-characters",
      randomBytes(40).toString("hex"),
    )
    .replace(
      "replace-with-random-local-password",
      randomBytes(32).toString("hex"),
    );
  writeFileSync(".env.local", text, { mode: 0o600 });
  console.log("Created private local configuration; no values logged.");
} else console.log("Preserved existing .env.local");
