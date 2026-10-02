---
name: system-vm-testing
description: Author or review virtual-machine tests for this system's boot, reboot, storage, networking, authentication, and application lifecycle. Use for VM scenarios and harness changes; ordinary server unit tests do not require this skill.
---

# System VM Testing

Read `packages/backend/source/modules/test-utilities/create-test-umbreld.ts` and a nearby VM test before choosing harness methods. The harness owns VM startup, authenticated clients, SSH, device attachment, and cleanup.

- Use the default `umbrel-home` machine for general behavior. Choose a Pi machine only for Pi-specific boot or storage behavior. An emulated Pi is not physical Raspberry Pi validation.
- Exercise public APIs and realistic product operations. Use SSH for low-level OS assertions or setup that has no public API; do not manufacture internal database state to bypass the behavior being tested.
- Keep related steps in one stateful scenario when they share a boot. Use separate scenarios when fresh state is essential. Make hardware, boot disk, attached storage, and transport explicit.
- Cover meaningful permission and persistence boundaries: unauthenticated rejection, owner/member authorization, reboot recovery, data preservation during updates, and application-owned data removal on uninstall.
- Use bounded readiness conditions for boot, networking, storage discovery, and application health. Avoid arbitrary sleeps and assertions against incidental log text.
- Register cleanup before risky setup. Close clients and stop VMs even when a scenario fails. Add harness primitives only for reusable capabilities; keep scenario-specific helpers local.
- Use local test repositories with the original app-store manifest and Compose contract. Do not rely on upstream availability, production credentials, or retired system installation formats.
- Report the image, machine target, scenario, and actual result. Record unavailable accelerators, hardware, or credentials as unverified prerequisites rather than treating mocks as system acceptance.

Useful existing scenarios are `packages/backend/source/modules/system/static-ip.vm.test.ts` for network transitions and `packages/backend/source/modules/hardware/raid-storage.vm.test.ts` for storage persistence. Verify these paths and APIs against the current tree before copying a pattern.
