import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  generateInviteSecret,
  generateRecoveryCode,
  generateRoomId,
  normalizeRecoveryCode,
  sha256Hex,
} from "./ids.js";

describe("ids", () => {
  it("roomId is 22 chars of base64url", () => {
    assert.match(generateRoomId(), /^[A-Za-z0-9_-]{22}$/);
  });

  it("inviteSecret is 43 chars of base64url (256-bit)", () => {
    assert.match(generateInviteSecret(), /^[A-Za-z0-9_-]{43}$/);
  });

  it("recoveryCode is 4 dash-separated groups of 8 hex chars (128-bit)", () => {
    assert.match(
      generateRecoveryCode(),
      /^[\da-f]{8}-[\da-f]{8}-[\da-f]{8}-[\da-f]{8}$/,
    );
  });

  it("draws are unique across 1000 samples", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(generateRoomId());
      seen.add(generateInviteSecret());
    }
    assert.equal(seen.size, 2000);
  });

  it("recovery code normalization ignores dashes, spaces and case", () => {
    const code = generateRecoveryCode();
    const flat = code.replace(/-/g, "");
    assert.equal(normalizeRecoveryCode(code), flat);
    assert.equal(normalizeRecoveryCode(code.toUpperCase()), flat);
    assert.equal(normalizeRecoveryCode(` ${code.split("-").join(" ")} `), flat);
  });

  it("sha256 matches the standard test vector", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});