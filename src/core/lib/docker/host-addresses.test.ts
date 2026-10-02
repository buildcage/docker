import type { networkInterfaces } from "node:os";

import { describe, it, expect } from "vitest";

import { listHostIpv4Addresses } from "./host-addresses.ts";

type Interfaces = ReturnType<typeof networkInterfaces>;
type Info = NonNullable<Interfaces[string]>[number];

function info(overrides: Partial<Info>): Info {
  return {
    address: "10.0.0.1",
    netmask: "255.255.0.0",
    family: "IPv4",
    mac: "02:42:ac:11:00:02",
    internal: false,
    cidr: "10.0.0.1/16",
    ...overrides,
  } as Info;
}

function fake(interfaces: Interfaces): typeof networkInterfaces {
  return (() => interfaces) as typeof networkInterfaces;
}

describe("listHostIpv4Addresses", () => {
  it("collects every bridge and the runner's own LAN address", () => {
    // Blocking the compose network's own gateway alone would leave docker0 as an
    // equivalent route to the same published ports.
    const addresses = listHostIpv4Addresses({
      networkInterfaces: fake({
        eth0: [info({ address: "192.168.65.3" })],
        docker0: [info({ address: "172.17.0.1" })],
        "br-7d94037897eb": [info({ address: "172.18.0.1" })],
      }),
    });
    expect(addresses).toStrictEqual(["172.17.0.1", "172.18.0.1", "192.168.65.3"]);
  });

  it("skips IPv6, which do-resolve cannot produce today", () => {
    const addresses = listHostIpv4Addresses({
      networkInterfaces: fake({
        eth0: [info({ address: "192.168.65.3" }), info({ address: "fd00::1", family: "IPv6" })],
      }),
    });
    expect(addresses).toStrictEqual(["192.168.65.3"]);
  });

  it("skips loopback, already covered by 127.0.0.0/8", () => {
    const addresses = listHostIpv4Addresses({
      networkInterfaces: fake({
        lo: [info({ address: "127.0.0.1", internal: true })],
        eth0: [info({ address: "192.168.65.3" })],
      }),
    });
    expect(addresses).toStrictEqual(["192.168.65.3"]);
  });

  it("reads the pre-v18 numeric family spelling", () => {
    const addresses = listHostIpv4Addresses({
      networkInterfaces: fake({
        eth0: [info({ address: "192.168.65.3", family: 4 as unknown as "IPv4" })],
      }),
    });
    expect(addresses).toStrictEqual(["192.168.65.3"]);
  });

  it("deduplicates an address held on more than one interface", () => {
    const addresses = listHostIpv4Addresses({
      networkInterfaces: fake({
        eth0: [info({ address: "192.168.65.3" })],
        eth1: [info({ address: "192.168.65.3" })],
      }),
    });
    expect(addresses).toStrictEqual(["192.168.65.3"]);
  });

  it("tolerates an interface with no addresses", () => {
    // networkInterfaces() types every entry as possibly undefined.
    const addresses = listHostIpv4Addresses({
      networkInterfaces: fake({ eth0: undefined, docker0: [info({ address: "172.17.0.1" })] }),
    });
    expect(addresses).toStrictEqual(["172.17.0.1"]);
  });

  it("returns nothing rather than throwing when there is no interface at all", () => {
    expect(listHostIpv4Addresses({ networkInterfaces: fake({}) })).toStrictEqual([]);
  });
});
