// Errors that are safe to show to the person who triggered them.
// Anything that is NOT an HttpError is treated as a bug and hidden (see route.ts).

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Same answer whether a thing does not exist or belongs to someone else, so ids cannot be probed.
export const notFound = () => new HttpError(404, 'Not found.');
