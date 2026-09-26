// Browsers manage their own storage and have no native device backup directory.
export async function mutationStorageDirectory(): Promise<undefined> {
  return undefined;
}
