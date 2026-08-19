import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "fs/promises";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { join, relative, resolve } from "path";
import { tmpdir } from "os";

const packageDir = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = resolve(packageDir, "../..");
const outputRoot = await mkdtemp(join(tmpdir(), "api-codegen-check-"));

const generatedDirectories = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files.sort();
}

async function compareGeneratedDirectory(relativeDirectory) {
  const checkedInDirectory = join(workspaceRoot, relativeDirectory);
  const regeneratedDirectory = join(outputRoot, relativeDirectory);
  const [checkedInFiles, regeneratedFiles] = await Promise.all([
    listFiles(checkedInDirectory),
    listFiles(regeneratedDirectory),
  ]);
  const checkedInRelativeFiles = checkedInFiles.map((file) =>
    relative(checkedInDirectory, file),
  );
  const regeneratedRelativeFiles = regeneratedFiles.map((file) =>
    relative(regeneratedDirectory, file),
  );

  const differences = [];
  for (const file of new Set([...checkedInRelativeFiles, ...regeneratedRelativeFiles])) {
    const checkedInPath = join(checkedInDirectory, file);
    const regeneratedPath = join(regeneratedDirectory, file);
    const [checkedInExists, regeneratedExists] = await Promise.all([
      stat(checkedInPath).then(() => true).catch(() => false),
      stat(regeneratedPath).then(() => true).catch(() => false),
    ]);

    if (!checkedInExists || !regeneratedExists) {
      differences.push(`${relativeDirectory}/${file} is missing`);
      continue;
    }

    const [checkedInContents, regeneratedContents] = await Promise.all([
      readFile(checkedInPath),
      readFile(regeneratedPath),
    ]);
    if (!checkedInContents.equals(regeneratedContents)) {
      differences.push(`${relativeDirectory}/${file} differs`);
    }
  }

  return differences;
}

try {
  console.log("Generating API clients in a temporary directory...");
  const temporaryMutator = join(
    outputRoot,
    "lib/api-client-react/src/custom-fetch.ts",
  );
  await mkdir(join(outputRoot, "lib/api-client-react/src"), { recursive: true });
  await copyFile(
    join(workspaceRoot, "lib/api-client-react/src/custom-fetch.ts"),
    temporaryMutator,
  );

  execFileSync(
    "pnpm",
    ["exec", "orval", "--config", "./orval.config.ts"],
    {
      cwd: packageDir,
      env: { ...process.env, ORVAL_OUTPUT_ROOT: outputRoot },
      stdio: "inherit",
    },
  );
  execFileSync(process.execPath, ["./postprocess.mjs"], {
    cwd: packageDir,
    env: { ...process.env, ORVAL_OUTPUT_ROOT: outputRoot },
    stdio: "inherit",
  });

  const differences = (
    await Promise.all(generatedDirectories.map(compareGeneratedDirectory))
  ).flat();

  if (differences.length > 0) {
    console.error(
      [
        "Generated API files are out of date.",
        "Run `pnpm --filter @workspace/api-spec run codegen` and commit the regenerated files.",
        "",
        ...differences.map((difference) => `- ${difference}`),
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log("Generated API files are up to date.");
  }
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}