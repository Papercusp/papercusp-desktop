export interface DesktopInterfaceIdentity {
  kind: 'legacy' | 'portal-candidate' | 'unknown';
  spaIndexSha256: string | null;
  entryBundle: string | null;
}

export function desktopInterfaceIdentity(html: string | null): DesktopInterfaceIdentity;
export function desktopInterfaceChoice(env?: NodeJS.ProcessEnv): 'legacy' | 'portal-candidate';
export function assertPublicDesktopInterface(provenance?: unknown, env?: NodeJS.ProcessEnv): void;
export function assertPublicDesktopArtifacts(artifacts: string[], env?: NodeJS.ProcessEnv): DesktopInterfaceIdentity[];
export function assertPublicDesktopReleaseSite(directory: string, env?: NodeJS.ProcessEnv): void;
