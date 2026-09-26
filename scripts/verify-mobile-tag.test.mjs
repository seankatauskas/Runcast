import { describe, expect, it, vi } from 'vitest';
import { verifyGitHubTagSignature, verifyMobileTag } from './verify-mobile-tag.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';

function gitFixture(overrides = {}) {
  const results = new Map([
    ['cat-file -t refs/tags/mobile-v0.2.0', { status: 0, stdout: 'tag\n' }],
    ['verify-tag refs/tags/mobile-v0.2.0', { status: 0, stdout: '' }],
    ['rev-parse refs/tags/mobile-v0.2.0^{commit}', { status: 0, stdout: `${commit}\n` }],
    ['rev-parse HEAD', { status: 0, stdout: `${commit}\n` }],
    ['merge-base --is-ancestor ' + commit + ' origin/main', { status: 0, stdout: '' }],
    ...Object.entries(overrides),
  ]);
  return vi.fn((args) => results.get(args.join(' ')) ?? { status: 128, stdout: '' });
}

function candidate(git = gitFixture()) {
  return {
    tag: 'mobile-v0.2.0',
    expoVersion: '0.2.0',
    packageVersion: '0.2.0',
    git,
    verifySignature: vi.fn(async () => {}),
  };
}

describe('mobile release tag verification', () => {
  it('uses GitHub verification without requiring a local signer keyring', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ object: { type: 'tag', sha: 'tag-object' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { type: 'commit', sha: commit },
            verification: { verified: true },
          }),
          { status: 200 },
        ),
      );

    await expect(
      verifyGitHubTagSignature({
        tag: 'mobile-v0.2.0',
        commit,
        repository: 'owner/repository',
        token: 'token',
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('accepts a verified annotated tag at HEAD that is contained in origin/main', async () => {
    await expect(verifyMobileTag(candidate())).resolves.toEqual({
      tag: 'mobile-v0.2.0',
      version: '0.2.0',
      commit,
    });
  });

  it('rejects a lightweight tag', async () => {
    const git = gitFixture({
      'cat-file -t refs/tags/mobile-v0.2.0': { status: 0, stdout: 'commit\n' },
    });
    await expect(verifyMobileTag(candidate(git))).rejects.toThrow(/must be an annotated tag/);
  });

  it('rejects a tag whose signature is not verified', async () => {
    const input = candidate();
    input.verifySignature = vi.fn(async () => {
      throw new Error('Release tag mobile-v0.2.0 must have a signature verified by GitHub');
    });
    await expect(verifyMobileTag(input)).rejects.toThrow(/signature verified by GitHub/);
  });

  it('rejects a tag that does not point to HEAD', async () => {
    const git = gitFixture({
      'rev-parse HEAD': { status: 0, stdout: 'fedcba9876543210fedcba9876543210fedcba98\n' },
    });
    await expect(verifyMobileTag(candidate(git))).rejects.toThrow(/must point to HEAD/);
  });

  it('rejects a tag commit outside origin/main', async () => {
    const git = gitFixture({
      ['merge-base --is-ancestor ' + commit + ' origin/main']: { status: 1, stdout: '' },
    });
    await expect(verifyMobileTag(candidate(git))).rejects.toThrow(/contained in origin\/main/);
  });

  it('checks mobile versions before invoking Git', async () => {
    const git = gitFixture();
    await expect(verifyMobileTag({ ...candidate(git), packageVersion: '0.1.0' })).rejects.toThrow(
      /does not match Expo version/,
    );
    await expect(verifyMobileTag({ ...candidate(git), tag: 'mobile-v0.1.0' })).rejects.toThrow(
      /must be mobile-v0.2.0/,
    );
    expect(git).not.toHaveBeenCalled();
  });
});
