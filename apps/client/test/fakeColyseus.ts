// The online connection is not exercised by the headless tests; this only satisfies the import.
export class Client {
  constructor(readonly endpoint: string) {}
  joinOrCreate(): Promise<never> {
    return Promise.reject(new Error('not available in tests'));
  }
}
export type Room = unknown;
