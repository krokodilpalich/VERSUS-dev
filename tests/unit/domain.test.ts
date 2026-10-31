import { describe, it, expect } from "vitest";
import { commission } from "../../src/modules/commerce/service";
import { sniffImage } from "../../src/modules/catalog/media";
import {
  hasRole,
  staff,
  signed,
  type Actor,
} from "../../src/modules/auth/policy";
import { artworkInput } from "../../src/modules/catalog/service";
const actor: Actor = {
  id: crypto.randomUUID(),
  email: "demo@versus.local",
  name: "DEMO",
  verified: true,
  mfa: false,
  roles: ["COLLECTOR"],
};
describe("money and policies", () => {
  it("rounds once in integer kopecks and preserves totals", () => {
    for (const amount of [1, 5, 99, 10001, 9000000000000]) {
      const c = commission(amount, 333);
      expect(Number.isSafeInteger(c.feeMinor)).toBe(true);
      expect(c.feeMinor + c.sellerNetMinor).toBe(amount);
    }
  });
  it("rejects float, negative money and invalid rates", () => {
    for (const amount of [-1, 0, 1.5, NaN])
      expect(() => commission(amount, 1000)).toThrow();
    expect(() => commission(100, 10001)).toThrow();
  });
  it("denies anonymous, unverified and non-staff access", () => {
    expect(() => signed(null)).toThrow();
    expect(() => signed({ ...actor, verified: false })).toThrow();
    expect(() => staff(actor, "MODERATOR")).toThrow();
    expect(() => staff({ ...actor, roles: ["ADMIN"] })).toThrow();
    expect(() =>
      staff({ ...actor, roles: ["ADMIN"], mfa: true }),
    ).not.toThrow();
    expect(hasRole(actor, "ADMIN")).toBe(false);
  });
  it("sniffs image bytes, not filename", () => {
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(Buffer.from([255, 216, 255, 0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("MZ.exe"))).toBeNull();
  });
  it("strictly rejects client price injection in artwork DTO", () => {
    expect(artworkInput.safeParse({ title: "x", priceMinor: 1 }).success).toBe(
      false,
    );
  });
});
