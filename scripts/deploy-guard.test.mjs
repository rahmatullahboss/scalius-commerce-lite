import { describe, expect, it } from "vitest";
import { assertRemoteMutationAllowed } from "./deploy-guard.mjs";

const provisionedConfig = {
  name: "rahmat-marketplace-api",
  d1_databases: [{
    database_name: "rahmat-marketplace-db",
    database_id: "11111111-1111-4111-8111-111111111111",
  }],
};

const placeholderConfig = {
  name: "marketplace-api-local",
  d1_databases: [{
    database_name: "marketplace-local-db",
    database_id: "00000000-0000-0000-0000-000000000001",
  }],
};

describe("remote deployment guard", () => {
  it("allows dry runs and local migrations without remote approval", () => {
    expect(() => assertRemoteMutationAllowed({
      dryRun: true,
      migrateOnly: false,
      local: false,
      env: {},
      config: placeholderConfig,
    })).not.toThrow();

    expect(() => assertRemoteMutationAllowed({
      dryRun: false,
      migrateOnly: true,
      local: true,
      env: {},
      config: placeholderConfig,
    })).not.toThrow();
  });

  it("blocks remote deploy and migration without explicit approval", () => {
    for (const options of [
      { dryRun: false, migrateOnly: false, local: false },
      { dryRun: false, migrateOnly: true, local: false },
    ]) {
      expect(() => assertRemoteMutationAllowed({
        ...options,
        env: {},
        config: provisionedConfig,
      })).toThrow(/MARKETPLACE_REMOTE_DEPLOY_APPROVED=YES/);
    }
  });

  it("blocks placeholder resource configuration even with approval", () => {
    expect(() => assertRemoteMutationAllowed({
      dryRun: false,
      migrateOnly: false,
      local: false,
      env: { MARKETPLACE_REMOTE_DEPLOY_APPROVED: "YES" },
      config: placeholderConfig,
    })).toThrow(/local placeholder/);
  });

  it("allows an explicitly approved, newly provisioned remote configuration", () => {
    expect(() => assertRemoteMutationAllowed({
      dryRun: false,
      migrateOnly: false,
      local: false,
      env: { MARKETPLACE_REMOTE_DEPLOY_APPROVED: "YES" },
      config: provisionedConfig,
    })).not.toThrow();
  });
});
