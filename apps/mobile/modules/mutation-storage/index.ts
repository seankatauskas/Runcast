import { requireNativeModule } from 'expo';

/** Native code sets backup exclusion before any mutation data is written. */
export async function mutationStorageDirectory(): Promise<string> {
  return requireNativeModule<{ directory(): Promise<string> }>('MutationStorage').directory();
}
