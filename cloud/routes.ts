// IDs are opaque; backend validation and the route error boundary remain authoritative.
export function parseRoomRoute(path: string) {
  const match = /^\/rooms\/([a-zA-Z0-9_-]{1,128})(?:\/(?:(brief|results|timeline|people)|(proposals|requests)\/([a-zA-Z0-9_-]{1,128})))?\/?$/.exec(path);
  if (!match) return null;
  return { roomId: match[1]!, section: match[2] ?? match[3], id: match[4] };
}
