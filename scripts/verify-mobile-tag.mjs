import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function runGit(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function successfulGitOutput(git, args, failureMessage) {
  const result = git(args);
  if (result.error || result.signal || result.status !== 0) throw new Error(failureMessage);
  return result.stdout.trim();
}

function successfulGitCommand(git, args, failureMessage) {
  const result = git(args);
  if (result.error || result.signal || result.status !== 0) throw new Error(failureMessage);
}

async function githubJson(path, { repository, token, fetchImpl }) {
  if (!repository || !token) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required to verify the release tag');
  }
  const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error('GitHub could not verify the release tag');
  return response.json();
}

export async function verifyGitHubTagSignature({
  tag,
  commit,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
}) {
  const reference = await githubJson(`/git/ref/tags/${encodeURIComponent(tag)}`, {
    repository,
    token,
    fetchImpl,
  });
  if (reference?.object?.type !== 'tag' || typeof reference.object.sha !== 'string') {
    throw new Error(`Release tag ${tag} must be an annotated tag`);
  }
  const tagObject = await githubJson(`/git/tags/${reference.object.sha}`, {
    repository,
    token,
    fetchImpl,
  });
  if (tagObject?.object?.type !== 'commit' || tagObject.object.sha !== commit) {
    throw new Error(`Release tag ${tag} must directly reference the release commit`);
  }
  if (tagObject?.verification?.verified !== true) {
    throw new Error(`Release tag ${tag} must have a signature verified by GitHub`);
  }
}

export async function verifyMobileTag({
  tag,
  expoVersion,
  packageVersion,
  git = runGit,
  verifySignature = verifyGitHubTagSignature,
}) {
  if (typeof expoVersion !== 'string' || !expoVersion) {
    throw new Error('apps/mobile/app.json has no version');
  }
  if (packageVersion !== expoVersion) {
    throw new Error(
      `Mobile package version ${packageVersion ?? '<missing>'} does not match Expo version ${expoVersion}`,
    );
  }

  const expectedTag = `mobile-v${expoVersion}`;
  if (tag !== expectedTag) throw new Error(`Release tag ${tag} must be ${expectedTag}`);

  const tagRef = `refs/tags/${tag}`;
  const objectType = successfulGitOutput(
    git,
    ['cat-file', '-t', tagRef],
    `Release tag ${tag} does not exist`,
  );
  if (objectType !== 'tag') throw new Error(`Release tag ${tag} must be an annotated tag`);

  const tagCommit = successfulGitOutput(
    git,
    ['rev-parse', `${tagRef}^{commit}`],
    `Release tag ${tag} does not resolve to a commit`,
  );
  const headCommit = successfulGitOutput(
    git,
    ['rev-parse', 'HEAD'],
    'Unable to resolve the release checkout HEAD',
  );
  if (tagCommit !== headCommit) throw new Error(`Release tag ${tag} must point to HEAD`);

  successfulGitCommand(
    git,
    ['merge-base', '--is-ancestor', tagCommit, 'origin/main'],
    `Release tag ${tag} must point to a commit contained in origin/main`,
  );

  await verifySignature({ tag, commit: tagCommit });

  return { tag, version: expoVersion, commit: tagCommit };
}

async function main() {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error('Provide the release tag as the first argument or GITHUB_REF_NAME');

  const app = JSON.parse(
    readFileSync(new URL('../apps/mobile/app.json', import.meta.url), { encoding: 'utf8' }),
  );
  const mobilePackage = JSON.parse(
    readFileSync(new URL('../apps/mobile/package.json', import.meta.url), { encoding: 'utf8' }),
  );
  const verified = await verifyMobileTag({
    tag,
    expoVersion: app.expo?.version,
    packageVersion: mobilePackage.version,
  });
  console.log(
    `Release tag ${verified.tag} is signed, matches mobile version ${verified.version}, and points to ${verified.commit}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
