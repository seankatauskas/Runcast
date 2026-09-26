export async function acknowledgeOwnedNotification(input: {
  acknowledge: () => Promise<void>;
  cache: () => Promise<void>;
  isNotFound: (error: unknown) => boolean;
}): Promise<'opened' | 'discarded'> {
  await input.cache();
  try {
    await input.acknowledge();
  } catch (error) {
    if (input.isNotFound(error)) return 'discarded';
    throw error;
  }
  return 'opened';
}
