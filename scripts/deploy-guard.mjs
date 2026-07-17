const APPROVAL_VARIABLE = "MARKETPLACE_REMOTE_DEPLOY_APPROVED";
const APPROVAL_VALUE = "YES";

function isPlaceholderConfig(config) {
  const d1 = config?.d1_databases?.[0];
  const values = [config?.name, d1?.database_name, d1?.database_id]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return values.some((value) => value.includes("local"))
    || values.some((value) => /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value))
    || values.some((value) => value === "00000000-0000-0000-0000-000000000001");
}

export function assertRemoteMutationAllowed({
  dryRun,
  migrateOnly,
  local,
  env = process.env,
  config,
}) {
  const isRemoteMutation = !dryRun && !local;
  if (!isRemoteMutation) return;

  if (env[APPROVAL_VARIABLE] !== APPROVAL_VALUE) {
    throw new Error(
      `Remote migration/deploy is disabled. Set ${APPROVAL_VARIABLE}=${APPROVAL_VALUE} only after the owner provisions and approves new Cloudflare resources.`,
    );
  }

  if (isPlaceholderConfig(config)) {
    throw new Error(
      "Remote migration/deploy is blocked because Wrangler still uses local placeholder resources.",
    );
  }
}
