#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_VERSION = "6.1.1";
const ALLOWED_INSTALL_TARGETS = new Set([
  ".ai-bridge/superpowers",
  ".ai-bridge/superpowers-version.json",
  "skills",
]);

export function compareSemver(left, right) {
  const parse = (value) => {
    const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
      throw new Error(`Invalid semantic version: ${value}`);
    }
    return match.slice(1).map(Number);
  };

  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function getSuperpowersInstallPlan(version = DEFAULT_VERSION) {
  const normalizedVersion = String(version).replace(/^v/, "");
  compareSemver(normalizedVersion, normalizedVersion);
  return {
    repository: "https://github.com/obra/superpowers.git",
    ref: `v${normalizedVersion}`,
    vendorDirectory: ".ai-bridge/superpowers",
    skillsLink: "skills",
    skillsTarget: ".ai-bridge/superpowers/skills",
    versionFile: ".ai-bridge/superpowers-version.json",
  };
}

export function assertSafeInstallTarget(target) {
  if (!ALLOWED_INSTALL_TARGETS.has(target)) {
    throw new Error(`Unsafe Superpowers install target: ${target}`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readInstalledVersion(root, plan) {
  const packagePath = resolve(root, plan.vendorDirectory, "package.json");
  if (!(await pathExists(packagePath))) return null;
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return typeof packageJson.version === "string" ? packageJson.version : null;
}

async function verifyInstalledLayout(root, plan, expectedVersion) {
  const installedVersion = await readInstalledVersion(root, plan);
  if (installedVersion !== expectedVersion) {
    throw new Error(
      `Superpowers version mismatch: expected ${expectedVersion}, found ${installedVersion ?? "none"}`,
    );
  }

  const skillsPath = resolve(root, plan.skillsLink);
  const skillsStat = await lstat(skillsPath);
  if (!skillsStat.isSymbolicLink()) {
    throw new Error("Project skills path must be a symbolic link to the vendored Superpowers skills");
  }

  const requiredSkills = [
    "using-superpowers/SKILL.md",
    "brainstorming/SKILL.md",
    "writing-plans/SKILL.md",
    "test-driven-development/SKILL.md",
    "systematic-debugging/SKILL.md",
    "verification-before-completion/SKILL.md",
  ];
  for (const requiredSkill of requiredSkills) {
    const skillPath = resolve(root, plan.skillsTarget, requiredSkill);
    if (!(await pathExists(skillPath))) {
      throw new Error(`Required Superpowers skill is missing: ${requiredSkill}`);
    }
  }

  return installedVersion;
}

async function installSuperpowers({ root, version, checkOnly }) {
  const plan = getSuperpowersInstallPlan(version);
  for (const target of [plan.vendorDirectory, plan.skillsLink, plan.versionFile]) {
    assertSafeInstallTarget(target);
  }

  const normalizedVersion = plan.ref.slice(1);
  const installedVersion = await readInstalledVersion(root, plan);

  if (checkOnly) {
    await verifyInstalledLayout(root, plan, normalizedVersion);
    console.log(`Superpowers ${normalizedVersion} is installed and linked correctly.`);
    return;
  }

  const bridgeDirectory = resolve(root, ".ai-bridge");
  const temporaryDirectory = resolve(
    bridgeDirectory,
    `.superpowers-install-${process.pid}`,
  );
  const backupDirectory = resolve(
    bridgeDirectory,
    `.superpowers-backup-${process.pid}`,
  );
  const vendorDirectory = resolve(root, plan.vendorDirectory);
  const skillsLink = resolve(root, plan.skillsLink);
  const versionFile = resolve(root, plan.versionFile);

  await mkdir(bridgeDirectory, { recursive: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
  await rm(backupDirectory, { recursive: true, force: true });

  console.log(
    `Installing Superpowers ${normalizedVersion}${
      installedVersion ? ` over ${installedVersion}` : ""
    }...`,
  );

  await execFileAsync("git", [
    "clone",
    "--depth=1",
    "--branch",
    plan.ref,
    "--single-branch",
    plan.repository,
    temporaryDirectory,
  ]);

  const clonedPackage = JSON.parse(
    await readFile(join(temporaryDirectory, "package.json"), "utf8"),
  );
  if (clonedPackage.version !== normalizedVersion) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error(
      `Downloaded Superpowers version ${clonedPackage.version} does not match ${normalizedVersion}`,
    );
  }

  await rm(join(temporaryDirectory, ".git"), { recursive: true, force: true });

  let vendorBackedUp = false;
  try {
    if (await pathExists(vendorDirectory)) {
      await rename(vendorDirectory, backupDirectory);
      vendorBackedUp = true;
    }
    await rename(temporaryDirectory, vendorDirectory);

    await rm(skillsLink, { recursive: true, force: true });
    const relativeTarget = relative(dirname(skillsLink), resolve(root, plan.skillsTarget));
    await symlink(relativeTarget, skillsLink, "dir");

    const metadata = {
      repository: plan.repository.replace(/\.git$/, ""),
      ref: plan.ref,
      version: normalizedVersion,
      installedAt: new Date().toISOString(),
      installation: "project-local-vendored-copy",
      skillsPath: plan.skillsLink,
      sourceSkillsPath: plan.skillsTarget,
    };
    await writeFile(versionFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    await verifyInstalledLayout(root, plan, normalizedVersion);
    await rm(backupDirectory, { recursive: true, force: true });
  } catch (error) {
    await rm(vendorDirectory, { recursive: true, force: true });
    if (vendorBackedUp && (await pathExists(backupDirectory))) {
      await rename(backupDirectory, vendorDirectory);
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(`Superpowers ${normalizedVersion} installed successfully.`);
}

function parseArguments(argv) {
  const checkOnly = argv.includes("--check");
  const versionArgument = argv.find((value) => /^v?\d+\.\d+\.\d+$/.test(value));
  return {
    checkOnly,
    version: (versionArgument ?? DEFAULT_VERSION).replace(/^v/, ""),
  };
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArguments(process.argv.slice(2));
  installSuperpowers({ root, ...options }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
