import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { internalDstAcl } from "./haproxy-internal-dst.ts";

const ADDRS = ["127.0.0.0/8", "169.254.0.0/16", "198.19.255.1"];

describe("the internal-destination acl", () => {
  it("tests the same thing for both stages, differing only in the acl name", () => {
    // The passthrough path rejects the connection and the inspected path denies
    // the request with 403, but what counts as internal cannot differ between
    // them: a destination one refuses and the other allows is a hole.
    const [pass] = internalDstAcl("pass_dst_internal", { internalAddrs: ADDRS });
    const [inspected] = internalDstAcl("dst_internal", { internalAddrs: ADDRS });
    expect(pass.replace("pass_dst_internal", "dst_internal")).toBe(inspected);
  });

  it("lists every address inline, as one acl", () => {
    expect(internalDstAcl("dst_internal", { internalAddrs: ADDRS })).toStrictEqual([
      "    acl dst_internal var(txn.dst) -m ip 127.0.0.0/8 169.254.0.0/16 198.19.255.1",
    ]);
  });

  it("adds the host-address file as a second acl of the same name", () => {
    expect(
      internalDstAcl("dst_internal", { internalAddrs: ADDRS, hostAddressFile: "/run/hosts.lst" }),
    ).toStrictEqual([
      "    acl dst_internal var(txn.dst) -m ip 127.0.0.0/8 169.254.0.0/16 198.19.255.1",
      "    acl dst_internal var(txn.dst) -m ip -f /run/hosts.lst",
    ]);
  });

  it("reads another fetch when given one", () => {
    expect(
      internalDstAcl(
        "ip_dst_internal",
        { internalAddrs: ADDRS, hostAddressFile: "/run/h.lst" },
        "dst",
      ),
    ).toStrictEqual([
      "    acl ip_dst_internal dst -m ip 127.0.0.0/8 169.254.0.0/16 198.19.255.1",
      "    acl ip_dst_internal dst -m ip -f /run/h.lst",
    ]);
  });
});

reportResults();
