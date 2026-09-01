import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";

function encodeLength(length) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("DER length must be a non-negative safe integer.");
  }
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let remaining = length; remaining > 0; remaining >>>= 8) {
    bytes.unshift(remaining & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([Buffer.from([tag]), encodeLength(bytes.length), bytes]);
}

function sequence(...values) {
  return der(0x30, Buffer.concat(values));
}

function set(...values) {
  return der(0x31, Buffer.concat(values));
}

function encodeOid(...arcs) {
  if (
    arcs.length < 2 ||
    arcs[0] < 0 ||
    arcs[0] > 2 ||
    arcs[1] < 0 ||
    (arcs[0] < 2 && arcs[1] > 39)
  ) {
    throw new TypeError("Invalid object identifier.");
  }
  const bytes = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    if (!Number.isSafeInteger(arc) || arc < 0) {
      throw new TypeError("Invalid object identifier arc.");
    }
    const encoded = [arc & 0x7f];
    for (
      let remaining = Math.floor(arc / 128);
      remaining > 0;
      remaining = Math.floor(remaining / 128)
    ) {
      encoded.unshift(0x80 | (remaining & 0x7f));
    }
    bytes.push(...encoded);
  }
  return der(0x06, bytes);
}

function utcTime(value) {
  const year = value.getUTCFullYear();
  if (year < 1950 || year > 2049) {
    throw new RangeError("Harness certificate dates must fit ASN.1 UTCTime.");
  }
  const part = (number) => String(number).padStart(2, "0");
  return der(
    0x17,
    `${part(year % 100)}${part(value.getUTCMonth() + 1)}${part(value.getUTCDate())}${part(value.getUTCHours())}${part(value.getUTCMinutes())}${part(value.getUTCSeconds())}Z`,
  );
}

function extension(identifier, value, critical = false) {
  return sequence(
    identifier,
    ...(critical ? [der(0x01, [0xff])] : []),
    der(0x04, value),
  );
}

function pem(label, bytes) {
  const lines = bytes.toString("base64").match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

const sha256WithRsaEncryption = sequence(
  encodeOid(1, 2, 840, 113549, 1, 1, 11),
  der(0x05, []),
);

export function generateLocalhostCertificate(
  now = new Date(),
  serialSeed = randomBytes(16),
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Certificate clock must be a valid Date.");
  }
  if (!Buffer.isBuffer(serialSeed) || serialSeed.length !== 16) {
    throw new TypeError("Certificate serial seed must be a 16-byte Buffer.");
  }
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const name = sequence(
    set(sequence(encodeOid(2, 5, 4, 3), der(0x0c, "localhost"))),
  );
  const serial = Buffer.from(serialSeed);
  serial[0] &= 0x7f;
  if (serial[0] === 0) serial[0] = 1;
  const extensions = sequence(
    extension(encodeOid(2, 5, 29, 19), sequence(der(0x01, [0xff])), true),
    extension(encodeOid(2, 5, 29, 15), der(0x03, [0x02, 0xa4]), true),
    extension(
      encodeOid(2, 5, 29, 37),
      sequence(encodeOid(1, 3, 6, 1, 5, 5, 7, 3, 1)),
    ),
    extension(
      encodeOid(2, 5, 29, 17),
      sequence(der(0x82, "localhost"), der(0x87, [127, 0, 0, 1])),
    ),
  );
  const tbsCertificate = sequence(
    der(0xa0, der(0x02, [0x02])),
    der(0x02, serial),
    sha256WithRsaEncryption,
    name,
    sequence(
      utcTime(new Date(now.getTime() - 60_000)),
      utcTime(new Date(now.getTime() + 24 * 60 * 60 * 1_000)),
    ),
    name,
    publicKey,
    der(0xa3, extensions),
  );
  const signature = createSign("RSA-SHA256")
    .update(tbsCertificate)
    .end()
    .sign(privateKey);
  const certificate = sequence(
    tbsCertificate,
    sha256WithRsaEncryption,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  return { private: privateKey, cert: pem("CERTIFICATE", certificate) };
}
